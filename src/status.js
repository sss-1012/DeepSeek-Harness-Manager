'use strict'
// 进程管理:profile 启停、PID 跟踪、端口检测、状态轮询、运行历史
const net = require('node:net')
const { spawnProfile, killPid, pidAlive, findPidByPort } = require('./dsh')
const { profileInfo } = require('./profiles')
const { ensureOverrides, statePatchPath } = require('./overrides')
const { getProfileSetting } = require('./store')
const { record } = require('./history')
const log = require('./log')

const sessions = new Map() // profile -> { pid, startedAt, readyAt, port, stopRequested }

function portOpen(port, timeout = 900) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: '127.0.0.1', port })
    let done = false
    const finish = (v) => { if (!done) { done = true; try { sock.destroy() } catch { /* ignore */ } resolve(v) } }
    sock.setTimeout(timeout)
    sock.once('connect', () => finish(true))
    sock.once('timeout', () => finish(false))
    sock.once('error', () => finish(false))
  })
}

function effectivePort(profileName) {
  const info = profileInfo(profileName)
  if (info.type === 'web') return getProfileSetting(profileName).port || 3080
  return getProfileSetting(profileName).port || null
}

// 从启动输出里提炼可读的失败原因(插件解析失败 / 端口占用 / 其他)
function summarizeBootFailure(lines) {
  const text = lines.join('\n')
  if (/EADDRINUSE|address already in use/i.test(text)) {
    return '端口已被占用(可能有另一个 harness 实例在运行)。请先停止它,或在「配置启动项」里换一个检测端口。'
  }
  const missing = [...text.matchAll(/Cannot find package '([^']+)'/g)].map((m) => m[1])
  const failedImports = [...text.matchAll(/failed to import loader entry [^(]*\(([^)]+)\)/g)].map((m) => m[1])
  const pkgs = [...new Set(missing.length ? missing : failedImports)]
  if (pkgs.length) {
    return `插件加载失败,无法解析:${pkgs.join('、')}\n常见原因:dsh 版本更新后插件解析位置发生变化。可在更新面板点「插件兼容性修复」一键创建链接。(项目 ${pkgs.length} 个插件)`
  }
  if (/plugin tree failed to load/i.test(text)) return '插件树加载失败,详见下方日志'
  const errLine = [...lines].reverse().find((l) => /Error:|error:|✘|failed to/i.test(l))
  return errLine ? errLine.slice(0, 300) : (lines.slice(-2).join(' | ') || '启动后立即退出,无额外输出')
}

// 判定 profile 是否在运行:优先 PID,web 型叠加端口检测
async function isRunning(profileName) {
  const s = sessions.get(profileName)
  if (s && pidAlive(s.pid)) return true
  const port = effectivePort(profileName)
  if (port) {
    const pid = findPidByPort(port)
    if (pid) {
      if (!s || s.pid !== pid) sessions.set(profileName, { pid, startedAt: Date.now(), readyAt: Date.now(), port, external: true })
      return true
    }
  }
  return false
}

async function start(profileName, { args, onLog, onEarlyExit } = {}) {
  if (await isRunning(profileName)) return { ok: false, error: `profile「${profileName}」已在运行` }
  const patch = ensureOverrides(profileName)
  const setting = getProfileSetting(profileName)
  const appArgs = (args && args.length ? args : (setting.args ? setting.args.split(/\s+/).filter(Boolean) : []))
  const port = effectivePort(profileName)

  const entry = { pid: null, startedAt: Date.now(), readyAt: null, port, external: false }
  sessions.set(profileName, entry)

  const recentLines = []
  const line = (text) => {
    for (const chunk of text.split('\n')) {
      const t = chunk.trim()
      if (t) {
        recentLines.push(t)
        if (recentLines.length > 400) recentLines.shift()
        onLog?.(`[${profileName}] ${t}`)
      }
    }
  }

  const child = spawnProfile(profileName, { patches: [patch], args: appArgs, onLine: line })
  entry.pid = child.pid
  entry.child = child

  child.on('exit', (code, signal) => {
    const wasReady = entry.readyAt
    const aliveMs = Date.now() - entry.startedAt
    // 未就绪就退出,或"就绪"后很短时间(30s)内崩溃 → 都视为启动失败
    const crashedSoonAfterReady = wasReady && (Date.now() - wasReady) < 30000
    const earlyFailure = (!wasReady || crashedSoonAfterReady) && code !== 0
    line(`进程退出 (code=${code}${signal ? `, signal=${signal}` : ''}, 存活 ${(aliveMs / 1000).toFixed(1)}s)`)
    record(profileName, {
      action: 'stop',
      exitCode: code,
      signal: signal || null,
      durationMs: wasReady ? Date.now() - wasReady : null,
      aliveMs,
      pid: child.pid,
    })
    sessions.delete(profileName)
    if (earlyFailure) {
      onEarlyExit?.({
        code,
        aliveMs,
        crashedAfterReady: crashedSoonAfterReady,
        summary: summarizeBootFailure(recentLines),
        lines: recentLines.slice(-6).join('\n'),
      })
    }
  })

  // 就绪判定:web 型等端口,其他型等 2.5 秒稳定运行
  if (port) {
    const deadline = Date.now() + 45000
    const poll = async () => {
      if (!sessions.has(profileName)) return
      if (await portOpen(port)) {
        // 端口通了但进程已死(或即将死)→ 不算就绪,交给 exit 处理逻辑报错
        if (!pidAlive(child.pid)) return
        entry.readyAt = Date.now()
        record(profileName, { action: 'start', pid: child.pid, port, plugins: profileInfo(profileName).bundles, durationMs: entry.readyAt - entry.startedAt, external: false })
        onLog?.(`[${profileName}] ✔ 服务就绪 http://127.0.0.1:${port} (耗时 ${entry.readyAt - entry.startedAt}ms)`)
        return
      }
      if (Date.now() < deadline) setTimeout(poll, 500)
    }
    setTimeout(poll, 600)
  } else {
    setTimeout(() => {
      if (sessions.has(profileName) && pidAlive(child.pid) && !entry.readyAt) {
        entry.readyAt = Date.now()
        record(profileName, { action: 'start', pid: child.pid, plugins: profileInfo(profileName).bundles, durationMs: entry.readyAt - entry.startedAt, external: false })
      }
    }, 2500)
  }

  return { ok: true, pid: child.pid, port }
}

async function stop(profileName, { force } = {}) {
  const s = sessions.get(profileName)
  let pid = s?.pid || null
  if (!pid) {
    const port = effectivePort(profileName)
    if (port) pid = findPidByPort(port)
  }
  if (!pid) return { ok: false, error: `未找到「${profileName}」的运行进程` }
  const killed = await killPid(pid, { gracefulMs: force ? 200 : 2500 })
  record(profileName, { action: 'stop-request', pid, force: Boolean(force), result: killed ? 'killed' : 'failed' })
  sessions.delete(profileName)
  return { ok: killed, error: killed ? null : '进程停止失败(可能无权限)' }
}

// 停止所有由管理器管理的 profile(退出前)
async function stopAll() {
  const names = [...sessions.keys()]
  for (const n of names) {
    try { await stop(n, { force: true }) } catch { /* ignore */ }
  }
}

function snapshot() {
  const out = []
  for (const info of listAll()) {
    const s = sessions.get(info.name)
    out.push({
      name: info.name,
      type: info.type,
      running: Boolean(s && pidAlive(s.pid)) || Boolean(info.type === 'web' && findPidByPort(effectivePort(info.name))),
      pid: s?.pid || (info.type === 'web' ? findPidByPort(effectivePort(info.name)) : null),
      port: effectivePort(info.name),
      startedAt: s?.startedAt || null,
      readyAt: s?.readyAt || null,
      external: s?.external || false,
    })
  }
  return out
}

function listAll() {
  const { listProfiles } = require('./profiles')
  return listProfiles()
}

module.exports = { start, stop, stopAll, isRunning, snapshot, portOpen, effectivePort }
