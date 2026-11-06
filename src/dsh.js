'use strict'
// dsh CLI 封装:定位全局 dsh bin、执行命令、spawn profile 进程
const fs = require('node:fs')
const path = require('node:path')
const { execFile, spawn } = require('node:child_process')
const { dshHome, profileDir } = require('./paths')
const { execToolSync } = require('./tool')

let binCache = null

// 全局安装目录候选:先纯 fs 探测常见位置(<1ms),
// 都没命中才去 spawn 一次 `npm prefix -g`(Windows 上要 300~800ms)
function dshDirCandidates() {
  const dirs = []
  if (process.env.APPDATA) dirs.push(path.join(process.env.APPDATA, 'npm', 'node_modules', '@deepseek-ai', 'dsh'))
  if (process.env.LOCALAPPDATA) dirs.push(path.join(process.env.LOCALAPPDATA, 'npm', 'node_modules', '@deepseek-ai', 'dsh'))
  if (process.env.ProgramFiles) dirs.push(path.join(process.env.ProgramFiles, 'nodejs', 'node_modules', '@deepseek-ai', 'dsh'))
  return dirs
}

function dshBin() {
  if (binCache) return binCache
  if (process.env.DSH_CLI_BIN && fs.existsSync(process.env.DSH_CLI_BIN)) { binCache = process.env.DSH_CLI_BIN; return binCache }
  for (const dir of dshDirCandidates()) {
    const c = path.join(dir, 'lib', 'bin.js')
    if (fs.existsSync(c)) { binCache = c; return c }
  }
  const r = execToolSync('npm', ['prefix', '-g'])
  if (r.ok) {
    const c = path.join(r.stdout.trim(), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    if (fs.existsSync(c)) { binCache = c; return c }
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
  // 快路径:直接读全局安装目录里的 package.json(毫秒级、结果总是最新的)。
  // 之前每次都要 spawn `npm prefix -g` + `dsh --version` 两个进程,
  // 而 app:bootstrap 会 await 它 —— 首屏因此白白多等数百毫秒。
  try {
    const pkgFile = path.join(path.dirname(path.dirname(dshBin())), 'package.json')
    const v = JSON.parse(fs.readFileSync(pkgFile, 'utf8')).version
    if (v) return String(v).trim()
  } catch { /* 读不到就退回 spawn */ }
  const r = await execDsh(['--version'], { timeout: 20000 })
  return r.ok ? r.stdout.trim() : null
}

// 把子进程输出落盘而不是走管道:管理器退出时管道会断, dsh 写 stdout 就会 EPIPE 崩掉
// (这就是「关掉管理器 dsh 也跟着退」的根因)。改成文件 + detached + unref 后 dsh 可独立存活。
const tailers = new Map()
function tailFile(file, onLine, key, startAt = 0) {
  let offset = startAt
  let partial = ''
  const timer = setInterval(() => {
    let fd
    try {
      const st = fs.statSync(file)
      if (st.size <= offset) return
      fd = fs.openSync(file, 'r')
      const len = st.size - offset
      const buf = Buffer.alloc(len)
      fs.readSync(fd, buf, 0, len, offset)
      offset = st.size
      const lines = (partial + buf.toString('utf8')).split(/\r?\n/)
      partial = lines.pop() || ''
      for (const l of lines) if (l.trim()) onLine(l)
    } catch { /* 文件还没建好/已删,忽略 */ }
    finally { if (fd !== undefined) { try { fs.closeSync(fd) } catch { /* ignore */ } } }
  }, 400)
  if (key) tailers.set(key, timer)
  return () => { clearInterval(timer); if (key) tailers.delete(key) }
}

// 启动 profile:dsh --profile <name> [--patch <file>...] [args...]
function spawnProfile(name, { patches = [], args = [], onLine, extraEnv } = {}) {
  const argv = ['--profile', name]
  for (const p of patches || []) argv.push('--patch', p)
  argv.push(...(args || []))
  const runner = nodeForDsh()
  const logFile = path.join(profileDir(name), '.manager-run.log')
  let outFd = null
  try { outFd = fs.openSync(logFile, 'a') } catch { /* 退回到 ignore */ }
  let startAt = 0
  try { startAt = fs.statSync(logFile).size } catch { startAt = 0 }
  const child = spawn(runner.exe, [dshBin(), ...argv], {
    cwd: profileDir(name),
    env: { ...envFor(extraEnv), ...runner.env },
    windowsHide: true,
    // detached + 文件输出:管理器退出后 dsh 仍可独立运行
    detached: true,
    stdio: outFd !== null ? ['ignore', outFd, outFd] : ['ignore', 'ignore', 'ignore'],
  })
  if (outFd !== null) { try { fs.closeSync(outFd) } catch { /* 子进程已持有句柄 */ } }
  child.unref()
  child.__logFile = logFile
  if (onLine) child.__stopTail = tailFile(logFile, onLine, name, startAt)
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

// netstat -ano 是同步阻塞调用(Windows 上 100~300ms)。snapshot() 每 2 秒轮询一次、
// 每个 web profile 还会问两次,之前等于每 2 秒把主进程卡住几百毫秒(界面卡顿主因)。
// 现在把输出解析成 port -> pid 映射并缓存 1.5 秒:一次 netstat 服务所有查询。
let portMapCache = { at: 0, map: null }
function portPidMap() {
  const now = Date.now()
  if (portMapCache.map && now - portMapCache.at < 1500) return portMapCache.map
  const map = new Map()
  try {
    const out = require('node:child_process').execFileSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
    for (const line of out.split('\n')) {
      if (!line.includes('LISTENING')) continue
      const parts = line.trim().split(/\s+/)
      if (parts.length < 5) continue
      const local = parts[1] || ''
      const port = Number(local.slice(local.lastIndexOf(':') + 1))
      const pid = Number(parts[parts.length - 1])
      if (port > 0 && pid > 0 && !map.has(port)) map.set(port, pid)
    }
  } catch { /* ignore */ }
  portMapCache = { at: now, map }
  return map
}

function findPidByPort(port) {
  if (!port) return null
  return portPidMap().get(Number(port)) || null
}

module.exports = { dshBin, execDsh, version, spawnProfile, killPid, pidAlive, findPidByPort, envFor }
