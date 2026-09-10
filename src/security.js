'use strict'
// 密钥存储安全审计与加固
// - audit():检查明文密钥、文件权限是否过宽
// - hardenFilePerms():断开继承并把权限收紧为 当前用户 / SYSTEM / Administrators
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { dshHome, configPath } = require('./paths')

const KEY_RE = /sk-[A-Za-z0-9_-]{16,}/g
const BROAD_SID_RE = /(BUILTIN\\Users|Everyone|Authenticated Users)/i

function credentialsFile() {
  return path.join(dshHome, '.credentials.yaml')
}

function listSecretFiles() {
  return [
    { key: 'dsh-credentials', label: 'DSH 凭据文件', file: credentialsFile() },
    { key: 'manager-config', label: '管理器配置', file: configPath },
  ]
}

function readAcl(file) {
  try {
    return execFileSync('icacls', [file], { encoding: 'utf8', windowsHide: true, timeout: 15000 })
  } catch { return null }
}

// 审计:返回逐项结果(不包含密钥本身)
function audit() {
  const results = []

  // 1) DSH 凭据文件是否明文存放密钥
  const cred = credentialsFile()
  if (fs.existsSync(cred)) {
    let count = 0
    try {
      const text = fs.readFileSync(cred, 'utf8')
      count = [...new Set(text.match(KEY_RE) || [])].length
    } catch { /* ignore */ }
    results.push({
      id: 'cred-plaintext',
      label: 'DSH 凭据文件内容',
      status: count ? 'warn' : 'ok',
      detail: count
        ? `${path.basename(cred)} 以明文存放 ${count} 个密钥(DSH 自身存储机制,非管理器写入)。建议收紧文件权限,或改用环境变量注入`
        : '未发现明文密钥',
    })
  } else {
    results.push({ id: 'cred-plaintext', label: 'DSH 凭据文件内容', status: 'ok', detail: `未使用(${cred} 不存在)` })
  }

  // 2) 管理器配置:存储形态
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    const v = cfg.apiKeyEnc
    const mode = v == null ? 'none' : v.startsWith('enc:') ? 'secure' : v.startsWith('plain:') ? 'plain' : 'unknown'
    results.push({
      id: 'manager-key-mode',
      label: '管理器密钥存储',
      status: mode === 'secure' ? 'ok' : mode === 'none' ? 'ok' : 'warn',
      detail: mode === 'secure' ? '系统加密(Windows DPAPI,仅本机本账户可解密)'
        : mode === 'none' ? '未保存密钥(余额功能需先配置)'
          : mode === 'plain' ? '⚠ 明文 base64 存储,存在泄露风险。请在余额页重新保存密钥以自动迁移为加密存储'
            : '未知存储形态',
    })
  } catch (e) {
    results.push({ id: 'manager-key-mode', label: '管理器密钥存储', status: 'warn', detail: `配置读取失败: ${e.message}` })
  }

  // 3) 文件权限是否过宽(普通用户可读)
  for (const s of listSecretFiles()) {
    if (!fs.existsSync(s.file)) continue
    const acl = readAcl(s.file)
    if (acl == null) {
      results.push({ id: `perms-${s.key}`, label: `${s.label}权限`, status: 'warn', detail: 'icacls 检查失败' })
      continue
    }
    const broad = BROAD_SID_RE.test(acl)
    const inherited = /\(I\)/.test(acl)
    results.push({
      id: `perms-${s.key}`,
      label: `${s.label}权限`,
      status: broad ? 'warn' : 'ok',
      detail: broad
        ? '对普通用户/Everyone 可读,建议点「收紧密钥文件权限」修复'
        : `仅当前用户 / SYSTEM / Administrators 可读${inherited ? '(仍为继承权限,建议锁定)' : '(已锁定,不随父目录变化)'}`,
    })
  }

  return results
}

// 加固:断开继承 + 显式授予 当前用户 / SYSTEM / Administrators
function hardenFilePerms() {
  const user = process.env.USERDOMAIN && process.env.USERNAME
    ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}`
    : process.env.USERNAME
  const out = []
  for (const s of listSecretFiles()) {
    if (!fs.existsSync(s.file)) { out.push({ file: s.file, status: 'skip', reason: '文件不存在' }); continue }
    try {
      execFileSync('icacls', [s.file, '/inheritance:r'], { encoding: 'utf8', windowsHide: true, timeout: 15000 })
      execFileSync('icacls', [s.file, '/grant:r', `${user}:(F)`, 'NT AUTHORITY\\SYSTEM:(F)', 'BUILTIN\\Administrators:(F)'], {
        encoding: 'utf8', windowsHide: true, timeout: 15000,
      })
      const acl = readAcl(s.file) || ''
      out.push({ file: s.file, status: BROAD_SID_RE.test(acl) ? 'still-broad' : 'hardened' })
    } catch (e) {
      out.push({ file: s.file, status: 'failed', error: e.message })
    }
  }
  return out
}

module.exports = { audit, hardenFilePerms, credentialsFile, listSecretFiles }
