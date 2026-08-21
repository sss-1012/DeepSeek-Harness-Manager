'use strict'
// 环境检测与一键安装(node / npm / dsh),面向新手使用
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execTool, execToolSync } = require('./tool')
const { version } = require('./dsh')

async function check() {
  const node = execToolSync('node', ['--version'])
  const npm = execToolSync('npm', ['--version'])
  const pnpm = execToolSync('pnpm', ['--version'])
  const dshV = await version()
  return {
    node: { ok: node.ok, version: node.ok ? node.stdout.trim() : null },
    // 现代 Node.js 自带 npm:node 存在且 npm 可用 → 视为随 Node 内置
    npm: {
      ok: npm.ok,
      version: npm.ok ? npm.stdout.trim() : null,
      bundled: node.ok && npm.ok,
      needed: node.ok && !npm.ok,
    },
    pnpm: { ok: pnpm.ok, version: pnpm.ok ? pnpm.stdout.trim() : null },
    dsh: { ok: Boolean(dshV), version: dshV },
    configured: node.ok && npm.ok && Boolean(dshV),
  }
}

// 单独安装 npm(当 Node 存在但未捆绑 npm 时):从 registry 下载 tarball 解压到 Node 目录并生成 shim
async function installNpm(onLog) {
  try {
    onLog?.('查询 npm 最新版本 …')
    const res = await fetch('https://registry.npmjs.org/npm/latest', { signal: AbortSignal.timeout(30000) })
    if (!res.ok) throw new Error(`获取 npm 版本失败(HTTP ${res.status})`)
    const meta = await res.json()
    const ver = meta.version
    const tgzUrl = `https://registry.npmjs.org/npm/-/npm-${ver}.tgz`
    const nodeDir = path.dirname(resolveNodeExe())
    if (!nodeDir) throw new Error('未找到 Node.js 安装目录')
    onLog?.(`下载 npm@${ver} …`)
    const dl = await fetch(tgzUrl, { signal: AbortSignal.timeout(600000) })
    if (!dl.ok) throw new Error(`下载失败(HTTP ${dl.status})`)
    const buf = Buffer.from(await dl.arrayBuffer())
    const tmpDir = path.join(os.tmpdir(), `dshm-npm-${Date.now()}`)
    const tgz = path.join(tmpDir, 'npm.tgz')
    fs.mkdirSync(tmpDir, { recursive: true })
    fs.writeFileSync(tgz, buf)
    onLog?.('解压到 Node 目录 …')
    const tar = await execTool('tar', ['-xzf', tgz, '-C', tmpDir], { timeout: 120000 })
    if (!tar.ok) throw new Error(`解压失败: ${tar.stderr || tar.error}`)
    const dest = path.join(nodeDir, 'node_modules', 'npm')
    const src = path.join(tmpDir, 'package')
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true })
    fs.renameSync(src, dest)
    // 生成 npm.cmd / npm shim(若不存在)
    const shim = `@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\npm\\bin\\npm-cli.js" %*\r\n`
    if (!fs.existsSync(path.join(nodeDir, 'npm.cmd'))) fs.writeFileSync(path.join(nodeDir, 'npm.cmd'), shim, 'utf8')
    if (!fs.existsSync(path.join(nodeDir, 'npm'))) {
      fs.writeFileSync(path.join(nodeDir, 'npm'), `#!/bin/sh\nbasedir=$(dirname "$(echo "$0" | sed -e 's,\\\\,/,g')")\nexec "$basedir/node" "$basedir/node_modules/npm/bin/npm-cli.js" "$@"\n`, 'utf8')
    }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
    const v = execToolSync('npm', ['--version'])
    onLog?.(v.ok ? `✔ npm ${v.stdout.trim()} 安装完成` : '✘ npm 安装后校验失败')
    return { ok: v.ok, version: v.ok ? v.stdout.trim() : null, error: v.ok ? null : 'npm 安装后校验失败' }
  } catch (e) {
    onLog?.(`✘ ${e.message}`)
    return { ok: false, error: e.message }
  }
}

function resolveNodeExe() {
  try {
    const { execFileSync } = require('node:child_process')
    const out = execFileSync('where.exe', ['node'], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
    const first = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0]
    return first || null
  } catch { return null }
}

async function installDsh(onLog) {
  onLog?.('正在安装 @deepseek-ai/dsh ...')
  const r = await execTool('npm', ['install', '-g', '@deepseek-ai/dsh@latest'], { timeout: 600000 })
  onLog?.(r.ok ? '✔ dsh 安装完成' : `✘ 安装失败: ${(r.stderr || r.error || '').slice(0, 400)}`)
  return { ok: r.ok, error: r.ok ? null : (r.stderr || r.error || '未知错误') }
}

async function updateDsh(onLog) {
  onLog?.('正在更新 @deepseek-ai/dsh ...')
  const r = await execTool('npm', ['install', '-g', '@deepseek-ai/dsh@latest'], { timeout: 600000 })
  const v = await version()
  onLog?.(r.ok ? `✔ dsh 更新完成,当前版本: ${v}` : `✘ 更新失败: ${(r.stderr || r.error || '').slice(0, 400)}`)
  return { ok: r.ok, version: v, error: r.ok ? null : (r.stderr || r.error || '未知错误') }
}

async function uninstallDsh(onLog) {
  onLog?.('正在卸载 @deepseek-ai/dsh ...')
  const r = await execTool('npm', ['uninstall', '-g', '@deepseek-ai/dsh'], { timeout: 300000 })
  onLog?.(r.ok ? '✔ dsh 已卸载' : `✘ 卸载失败: ${(r.stderr || r.error || '').slice(0, 300)}`)
  return { ok: r.ok, error: r.ok ? null : (r.stderr || r.error || '未知错误') }
}

async function uninstallPnpm(onLog) {
  onLog?.('正在卸载 pnpm ...')
  const r = await execTool('npm', ['uninstall', '-g', 'pnpm'], { timeout: 300000 })
  onLog?.(r.ok ? '✔ pnpm 已卸载' : `✘ 卸载失败: ${(r.stderr || r.error || '').slice(0, 300)}`)
  return { ok: r.ok, error: r.ok ? null : (r.stderr || r.error || '未知错误') }
}

// 通过注册表找到 Node.js 的 MSI 卸载命令并静默执行(会弹 UAC)
async function uninstallNode(onLog) {
  const ps1 = [
    "$keys = @('HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*')",
    "$item = Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'Node.js*' -and $_.UninstallString } | Select-Object -First 1",
    "if ($item) { Write-Output $item.UninstallString } else { Write-Output '__NOT_FOUND__' }",
  ].join('\n')
  const tmp = path.join(os.tmpdir(), `dshm-uninstall-node-${Date.now()}.ps1`)
  try {
    fs.writeFileSync(tmp, ps1, 'utf8')
    onLog?.('正在查找 Node.js 卸载程序 …')
    const r = await execTool('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmp], { timeout: 60000 })
    const str = (r.stdout || '').trim()
    if (!str || str === '__NOT_FOUND__') return { ok: false, error: '未找到 Node.js 卸载信息(可能非 MSI 安装)' }
    // 卸载串可能为 MsiExec.exe /I{GUID}(修复入口),统一提取 GUID 后用 /x 卸载
    const m = str.match(/({[0-9A-Fa-f-]{36}})/i)
    if (m) {
      onLog?.(`执行卸载 ${m[1]} (请在 UAC 弹窗中允许)…`)
      const r2 = await execTool('msiexec', ['/x', m[1], '/qn', '/norestart'], { timeout: 600000 })
      const ok = r2.ok || r2.code === 3010
      onLog?.(ok ? '✔ Node.js 已卸载' : `✘ 卸载失败: ${(r2.stderr || r2.error || '').slice(0, 300)}`)
      return { ok, error: ok ? null : (r2.stderr || r2.error || '未知错误') }
    }
    onLog?.('未找到标准 MSI 卸载命令,跳过')
    return { ok: false, error: '未找到标准 MSI 卸载命令' }
  } catch (e) {
    onLog?.(`✘ ${e.message}`)
    return { ok: false, error: e.message }
  } finally {
    try { fs.rmSync(tmp, { force: true }) } catch { /* ignore */ }
  }
}

// 从 npmmirror 下载 Node MSI 并静默安装(会弹 UAC)
async function installNode(onLog) {
  const MIRROR = 'https://npmmirror.com/mirrors/node'
  try {
    onLog?.('查询最新 Node LTS 版本 ...')
    const res = await fetch(`${MIRROR}/index.json`, { signal: AbortSignal.timeout(30000) })
    if (!res.ok) throw new Error(`获取 Node 版本列表失败(HTTP ${res.status})`)
    const list = await res.json()
    const latest = list.find((v) => v.lts) || list[0]
    if (!latest) throw new Error('未找到可用版本')
    const ver = latest.version
    const file = `node-${ver}-x64.msi`
    const url = `${MIRROR}/${ver}/${file}`
    onLog?.(`下载 ${url} ...`)
    const dl = await fetch(url, { signal: AbortSignal.timeout(600000) })
    if (!dl.ok) throw new Error(`下载失败(HTTP ${dl.status})`)
    const buf = Buffer.from(await dl.arrayBuffer())
    const msi = path.join(os.tmpdir(), file)
    fs.writeFileSync(msi, buf)
    onLog?.(`已下载 ${(buf.length / 1024 / 1024).toFixed(1)} MB,开始安装(请在 UAC 弹窗中允许)…`)
    const r = await execTool('msiexec', ['/i', msi, '/qn', '/norestart'], { timeout: 600000 })
    try { fs.rmSync(msi, { force: true }) } catch { /* ignore */ }
    const ok = r.ok || r.code === 3010
    onLog?.(ok ? '✔ Node 安装完成,重启管理器后生效' : `✘ 安装失败: ${(r.stderr || r.error || '').slice(0, 400)}`)
    return { ok, error: ok ? null : (r.stderr || r.error || '未知错误') }
  } catch (e) {
    onLog?.(`✘ ${e.message}`)
    return { ok: false, error: e.message }
  }
}

module.exports = { check, installDsh, installNode, installNpm, updateDsh, uninstallDsh, uninstallPnpm, uninstallNode }
