'use strict'
// dsh CLI 封装:定位全局 dsh bin、执行命令、spawn profile 进程
const fs = require('node:fs')
const path = require('node:path')
const { execFile, spawn } = require('node:child_process')
const { dshHome, profileDir } = require('./paths')
const { execToolSync } = require('./tool')

let binCache = null

function dshBin() {
  if (binCache) return binCache
  const candidates = []
  if (process.env.DSH_CLI_BIN) candidates.push(process.env.DSH_CLI_BIN)
  const r = execToolSync('npm', ['prefix', '-g'])
  if (r.ok) {
    const prefix = r.stdout.trim()
    candidates.push(path.join(prefix, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
  }
  // 常见全局路径兜底
  candidates.push(path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
  for (const c of candidates) {
    if (c && fs.existsSync(c)) { binCache = c; return c }
  }
  throw new Error('未找到 dsh CLI:请确认已全局安装 @deepseek-ai/dsh')
}

function envFor(extra) {
  const { realNodeExe } = require('./tool')
  const base = { ...process.env, DSH_HOME: dshHome }
  // 仅在没有真实 node.exe、退化为 electron-as-node 时才需要该变量
  if (!realNodeExe() && process.versions && process.versions.electron) base.ELECTRON_RUN_AS_NODE = '1'
  return { ...base, ...(extra || {}) }
}

// dsh 必须用真实 node.exe 启动:用 electron-as-node 会触发
// "hmr: --expose-internals is required" 并导致 profile 启动失败(实测)
function nodeForDsh() {
  const { nodeRunner } = require('./tool')
  return nodeRunner()
}

function execDsh(args, opts = {}) {
  return new Promise((resolve) => {
    let bin
    try { bin = dshBin() } catch (e) { return resolve({ ok: false, code: -1, stdout: '', stderr: e.message, error: e.message }) }
    const runner = nodeForDsh()
    execFile(runner.exe, [bin, ...args], {
      cwd: opts.cwd,
      env: { ...envFor(opts.env), ...runner.env },
      windowsHide: true,
      timeout: opts.timeout || 120000,
      maxBuffer: 8 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        code: err ? (err.code || 1) : 0,
        stdout: stdout || '',
        stderr: stderr || '',
        error: err ? err.message : null,
      })
    })
  })
}

async function version() {
  const r = await execDsh(['--version'], { timeout: 20000 })
  return r.ok ? r.stdout.trim() : null
}

// 启动 profile:dsh --profile <name> [--patch <file>...] [args...]
function spawnProfile(name, { patches = [], args = [], onLine, extraEnv } = {}) {
  const argv = ['--profile', name]
  for (const p of patches || []) argv.push('--patch', p)
  argv.push(...(args || []))
  const runner = nodeForDsh()
  const child = spawn(runner.exe, [dshBin(), ...argv], {
    cwd: profileDir(name),
    env: { ...envFor(extraEnv), ...runner.env },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (onLine) {
    child.stdout.on('data', (d) => onLine(String(d)))
    child.stderr.on('data', (d) => onLine(String(d)))
  }
  return child
}

// 停止进程:先优雅(无 /F),超时后强制
function killPid(pid, { gracefulMs = 2500 } = {}) {
  return new Promise((resolve) => {
    if (!pid || pid <= 0) return resolve(false)
    if (!pidAlive(pid)) return resolve(true)
    try { require('node:child_process').execFileSync('taskkill', ['/PID', String(pid), '/T'], { windowsHide: true }) } catch { /* 可能无权限 */ }
    setTimeout(() => {
      if (!pidAlive(pid)) return resolve(true)
      try { require('node:child_process').execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }) } catch { /* ignore */ }
      setTimeout(() => resolve(!pidAlive(pid)), 800)
    }, gracefulMs)
  })
}

function pidAlive(pid) {
  if (!pid || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch { return false }
}

function findPidByPort(port) {
  try {
    const out = require('node:child_process').execFileSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
    for (const line of out.split('\n')) {
      if (line.includes(`:${port}`) && line.includes('LISTENING')) {
        const parts = line.trim().split(/\s+/)
        const pid = Number(parts[parts.length - 1])
        if (pid > 0) return pid
      }
    }
  } catch { /* ignore */ }
  return null
}

module.exports = { dshBin, execDsh, version, spawnProfile, killPid, pidAlive, findPidByPort, envFor }
