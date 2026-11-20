'use strict'
// 诊断中心:环境 / dsh / profile / 插件冲突 / 端口 / API Key
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { dshBin, version } = require('./dsh')
const { listProfiles } = require('./profiles')
const { disabledIds } = require('./overrides')
const { managerDirs, dshHome, profilesDir } = require('./paths')
const { hasApiKey, encryptionStatus } = require('./store')
const { execToolSync } = require('./tool')
const { createRequire } = require('node:module')

const statusMark = { ok: '✓', warn: '⚠', error: '✗' }

async function runDiagnostics() {
  const checks = []
  const add = (id, label, status, detail) => checks.push({ id, label, status, detail })

  for (const tool of ['node', 'npm', 'pnpm', 'git']) {
    const r = tool === 'node' || tool === 'git'
      ? (() => { try { return { ok: true, stdout: execFileSync(tool, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 10000 }) } } catch { return { ok: false } } })()
      : execToolSync(tool, ['--version'])
    if (r.ok) {
      add(tool, `${tool} 版本`, 'ok', r.stdout.trim().split('\n')[0])
    } else {
      add(tool, `${tool} 可用性`, 'warn', `未找到 ${tool}(不影响核心功能)` )
    }
  }

  const v = await version()
  if (v) add('dsh', 'dsh 版本', 'ok', v)
  else add('dsh', 'dsh 安装', 'error', 'dsh CLI 不可用')

  try {
    const bin = dshBin()
    add('dsh-bin', 'dsh 全局安装', fs.existsSync(bin) ? 'ok' : 'error', bin)
  } catch (e) {
    add('dsh-bin', 'dsh 全局安装', 'error', e.message)
  }

  const profiles = listProfiles()
  if (!profiles.length) {
    add('profiles', 'Profile', 'warn', '未检测到任何 profile($DSH_HOME/profiles 为空)')
  }
  for (const p of profiles) {
    // 旧版只看 profile / profiles 共享目录的 node_modules,于是所有官方 bundle
    // (它们住在全局 dsh 安装树的 node_modules 里)都被误报成「缺失」—— 实测 rc.5 下
    // dsh-experimental-auto-review / -plugin-market-bundle 明明能正常解析却报缺失。
    // 这里改成和 loader 同一解析链,实在解析不到才算缺失。
    let loaderReq = null
    try {
      const base = require('./compat').loaderBase()
      if (base && fs.existsSync(base)) loaderReq = createRequire(base)
    } catch { /* 全局 dsh 不完整时下面会单独报 */ }
    const resolves = (b) => {
      if (loaderReq) { try { loaderReq.resolve(b); return true } catch { /* 继续往下探 */ } }
      return false
    }
    const exists = (b) => resolves(b)
      || fs.existsSync(path.join(p.dir, 'node_modules', b, 'package.json'))
      || fs.existsSync(path.join(profilesDir, 'node_modules', b, 'package.json'))
    const missing = (p.bundles || []).filter((b) => !exists(b))
    add(`profile-${p.name}`, `Profile: ${p.name} (${p.type})`,
      missing.length ? 'warn' : 'ok',
      `${p.bundles.length} 个 bundle${missing.length ? `, ${missing.length} 个缺失: ${missing.join(', ')}` : ''}`)
    const dis = disabledIds(p.name).filter((id) => !(p.bundles || []).includes(id))
    if (dis.length) add(`conflict-${p.name}`, `禁用条目检查: ${p.name}`, 'warn', `以下禁用 id 不在 bundles 中: ${dis.join(', ')}`)
    // 插件解析兼容性(新版 dsh 从全局 loader 位置解析 bundle)
    try {
      // 旧写法漏了 await:checkBundles 是 async,拿到的是 Promise,c.ok 永远 undefined、
      // c.bad.join 直接抛错又被外层 catch 吃掉 —— 这条诊断实际上从来没生效过。
      const c = await require('./compat').checkBundles(p.name, { deep: false })
      if (!c.ok) {
        const retired = (c.badItems || []).filter((i) => i.state === 'retired-bundle').map((i) => i.name)
        const hint = retired.length
          ? `;其中 ${retired.join(', ')} 是上游已移除的 bundle,一键修复会从 bundles 删掉它`
          : ''
        add(`compat-${p.name}`, `插件解析: ${p.name}`, 'error',
          `以下插件在当前 dsh 版本下无法解析,启动会失败: ${c.bad.join(', ')}(可在更新面板点「插件兼容性检查」一键修复)${hint}`)
      }
    } catch { /* 忽略检查异常 */ }
  }

  try {
    const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
    const lines = out.split('\n').filter((l) => l.includes(':3080') && l.includes('LISTENING'))
    if (lines.length) {
      const pid = lines[0].trim().split(/\s+/).pop()
      add('port', '端口 3080', 'ok', `web 服务运行中 (PID ${pid})`)
    } else {
      add('port', '端口 3080', 'warn', 'web 服务未在运行(端口空闲)')
    }
  } catch {
    add('port', '端口 3080', 'error', '无法检查端口')
  }

  const enc = encryptionStatus()
  const keyUsable = hasApiKey()
  add('apikey', 'API Key', keyUsable || enc === 'secure' ? 'ok' : 'warn',
    keyUsable ? '已配置(余额功能可用)'
      : enc === 'secure' ? '已加密存储(需在管理器应用内运行才能解密验证)'
        : enc === 'plain' ? '⚠ 以明文存储(建议在余额页重新保存以迁移为加密存储)'
          : '未配置(余额功能不可用,可在设置中配置)')

  add('apikey-enc', '密钥存储加密', enc === 'secure' ? 'ok' : enc === 'plain' ? 'warn' : 'warn',
    enc === 'secure' ? '系统凭据加密(safeStorage/DPAPI)' : enc === 'plain' ? '⚠ 明文降级存储(仅测试模式),存在泄露风险' : '未保存密钥')

  // 密钥存储安全审计:明文凭据文件 / 文件权限
  try {
    for (const r of require('./security').audit()) add(r.id, r.label, r.status, r.detail)
  } catch (e) {
    add('security-audit', '密钥安全审计', 'warn', `审计失败: ${e.message}`)
  }

  const reportPath = writeReport(checks)
  return { checks, reportPath, dshHome }
}

function writeReport(checks) {
  try { fs.mkdirSync(managerDirs.reports, { recursive: true }) } catch { /* ignore */ }
  const file = path.join(managerDirs.reports, `diagnostic-report-${Date.now()}.md`)
  const lines = [
    '# DeepSeek Harness 诊断报告', '',
    `生成时间: ${new Date().toLocaleString()}`,
    `DSH_HOME: ${dshHome}`, '',
    '## 检查结果', '',
  ]
  for (const c of checks) {
    lines.push(`- [${statusMark[c.status] || '?'}] **${c.label}**: ${c.detail || ''}`)
  }
  lines.push('', '---', '报告由 deepseek-harness-manager 诊断中心生成')
  try { fs.writeFileSync(file, lines.join('\n')) } catch { /* ignore */ }
  return file
}

module.exports = { runDiagnostics }
