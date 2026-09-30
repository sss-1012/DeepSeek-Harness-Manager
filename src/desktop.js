'use strict'
// 官方 DeepSeek Harness 桌面端(Electron)识别
//   依据:注册表卸载项(DisplayName / DisplayVersion / InstallLocation / DisplayIcon)
//        + 常见安装路径 + 内置运行时版本文件
// 说明:官方桌面端自带 dsh/Node/pnpm 运行时,并**独占** $DSH_HOME/profiles/desktop。
//      官方文档明确 CLI 不得启动或修改该 profile,因此管理器只允许查看它。
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { dshHome } = require('./paths')

const UNINSTALL_ROOTS = [
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
]

// 官方桌面端的保留 profile 名(见官方 apps/desktop 文档)
const DESKTOP_PROFILE = 'desktop'

// 只认官方桌面端:显示名形如 "DeepSeek Harness 0.2.0-rc.2";管理器自身含 "Manager"
function isDesktopDisplayName(name) {
  if (!name) return false
  if (/manager/i.test(name)) return false
  return /^deepseek[\s-]*harness(\s|$)/i.test(String(name).trim())
}

function isDesktopProfile(name) {
  return name === DESKTOP_PROFILE
}

function parseRegEntries(text) {
  const entries = []
  let current = null
  for (const raw of String(text || '').split(/\r?\n/)) {
    if (!raw.trim()) continue
    if (/^HKEY_/i.test(raw)) {
      current = { key: raw.trim(), values: {} }
      entries.push(current)
      continue
    }
    if (!current) continue
    const m = raw.match(/^\s+([^\s]+)\s+(REG_[A-Z_]+)\s+(.*)$/)
    if (m) current.values[m[1]] = m[3].trim()
  }
  return entries
}

function regQuery(root) {
  try {
    return execFileSync('reg', ['query', root, '/s'], {
      encoding: 'utf8', windowsHide: true, timeout: 20000, maxBuffer: 16 * 1024 * 1024,
    })
  } catch { return '' }
}

// 进程是否在运行:true/false,取不到(权限/沙箱)时返回 null 表示"未知"
function processRunning(imageName) {
  try {
    const out = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${imageName}`, '/FO', 'CSV', '/NH'], {
      encoding: 'utf8', windowsHide: true, timeout: 15000,
    })
    if (/No tasks are running|信息: 没有运行的任务/i.test(out)) return false
    return /"/.test(out)
  } catch { return null }
}

function exeFromIcon(icon) {
  if (!icon) return null
  const clean = String(icon).replace(/^"|"$/g, '').replace(/,\s*-?\d+$/, '').trim()
  return /\.exe$/i.test(clean) ? clean : null
}

function findExeIn(dir) {
  try {
    const hit = fs.readdirSync(dir)
      .filter((f) => /\.exe$/i.test(f) && !/^uninstall/i.test(f))
      .map((f) => path.join(dir, f))
    return hit[0] || null
  } catch { return null }
}

function readRuntimeVersions(location) {
  const file = location ? path.join(location, 'resources', 'runtime', 'versions.json') : null
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function detect() {
  const profileDir = path.join(dshHome, 'profiles', DESKTOP_PROFILE)
  const base = {
    installed: false,
    running: null,
    version: null,
    location: null,
    exe: null,
    source: null,
    runtime: null,
    profileDir,
    profileExists: fs.existsSync(profileDir),
    profileName: DESKTOP_PROFILE,
  }

  let hit = null
  let entry = null
  for (const root of UNINSTALL_ROOTS) {
    const entries = parseRegEntries(regQuery(root))
    hit = entries.find((e) => isDesktopDisplayName(e.values.DisplayName))
    if (hit) { entry = { root, ...hit }; break }
  }

  let version = null
  let location = null
  let exe = null
  if (entry) {
    const display = entry.values.DisplayName || ''
    const m = display.match(/(\d+\.\d+\.\d+(?:-[\w.]+)?)/)
    version = entry.values.DisplayVersion || (m ? m[1] : null)
    location = entry.values.InstallLocation || null
    exe = exeFromIcon(entry.values.DisplayIcon)
    if (!exe && location) exe = findExeIn(location)
  }
  return {
    ...base,
    installed: Boolean(entry),
    version,
    location,
    exe,
    source: entry ? 'registry' : null,
    runtime: readRuntimeVersions(location),
    running: exe ? processRunning(path.basename(exe)) : null,
  }
}

// 供更新预检使用:桌面端是否在运行(未知时返回 null)
function desktopRunning() {
  const info = detect()
  return info.running
}

module.exports = { detect, desktopRunning, isDesktopProfile, processRunning, DESKTOP_PROFILE }
