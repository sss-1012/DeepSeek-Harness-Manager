'use strict'
// 进程枚举:更新/回滚前的"谁在用 dsh"预检
//   - tasklist:任何环境都能拿到进程名(受限环境可能被拒 → 返回 null)
//   - CIM:能拿到命令行,用于区分"是 dsh 的 node 进程"与无关 node 进程
const { execFileSync } = require('node:child_process')

// tasklist CSV → [{ name, pid }];取不到返回 null(未知)
function listProcesses() {
  try {
    const out = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 20000, maxBuffer: 8 * 1024 * 1024 })
    const rows = []
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^"([^"]+)","(\d+)"/)
      if (m) rows.push({ name: m[1], pid: Number(m[2]) })
    }
    return rows
  } catch { return null }
}

// CIM 进程表(带命令行);失败返回 null
function cimProcesses() {
  const ps = 'Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress'
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024,
    })
    const text = out.trim()
    if (!text) return []
    const parsed = JSON.parse(text)
    const list = Array.isArray(parsed) ? parsed : [parsed]
    return list
      .filter((p) => p && p.ProcessId)
      .map((p) => ({ pid: Number(p.ProcessId), name: String(p.Name || ''), commandLine: String(p.CommandLine || '') }))
  } catch { return null }
}

// 把 dsh 相关工作负载归类:官方桌面端 / CLI 启动的 dsh(node)
function dshProcesses(desktopExeName) {
  const procs = cimProcesses()
  const result = { desktop: [], cli: [], unknown: false, scanned: procs ? 'cim' : 'none' }
  if (!procs) {
    result.unknown = true
    const all = listProcesses()
    if (all) {
      result.scanned = 'tasklist'
      if (desktopExeName) for (const p of all) if (p.name === desktopExeName) result.desktop.push({ pid: p.pid, name: p.name, commandLine: '' })
      // 只有进程名,无法区分 dsh 与普通 node:只报告数量,由调用方决定是否提示
      result.nodeCount = all.filter((p) => /^node\.exe$/i.test(p.name)).length
      result.unknown = result.nodeCount > 0
    }
    return result
  }
  for (const p of procs) {
    if (desktopExeName && p.name === desktopExeName) { result.desktop.push(p); continue }
    if (/^node(\.exe)?$/i.test(p.name) && /dsh/i.test(p.commandLine)) result.cli.push(p)
  }
  return result
}

module.exports = { listProcesses, cimProcesses, dshProcesses }
