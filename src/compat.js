'use strict'
// 插件解析兼容性(重做版)
//
// 背景:dsh 从「全局 loader 位置」解析 profile 的 bundle 插件。全局 dsh 被 npm 更新(或更新失败留下
// 半更新状态)时,我们此前在全局 node_modules 里建的目录联接会被删掉或变成断链,于是 profile 启动时报
//   failed to import loader entry <name>: Cannot find package '<name>' imported from …cordis-plugin-loader…
//
// 与旧版的区别(旧版只做一次 require.resolve,loader 不存在时还会谎报 OK):
//   1. 逐 bundle 分档:可解析 / 仅 profile 内 / 联接断链 / 包不存在,并给出各自结论
//   2. 真加载探测:在独立 node 子进程里 import 入口,抓"能解析但加载失败"(依赖缺失/原生模块损坏)
//   3. 修复后立即复验,并在结果里带上每次复验结论
//   4. 跳过官方桌面端独占的 profile(CLI 不得修改它)
//   5. 全局 dsh 安装完整性自检(半更新状态下,插件级修复救不了,必须重装 CLI)
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { execFile } = require('node:child_process')
const { dshBin } = require('./dsh')
const { profileInfo, listProfiles } = require('./profiles')
const { profilesDir } = require('./paths')
const log = require('./log')

// dshBin: <prefix>/node_modules/@deepseek-ai/dsh/lib/bin.js
// 注意:必须从 bin 文件向上找到 **package.json 里 name 为 @deepseek-ai/dsh 的那一层**,
// 不能简单地 '..','..'(那样会停在 @deepseek-ai 作用域目录,导致 loaderBase() 永远不存在 →
// 兼容性检查直接返回「未找到 loader,跳过检查」并谎报 ok:true,这正是历史上"检查没起作用"的原因)。
function dshPkgDir() {
  let dir
  try { dir = path.dirname(dshBin()) } catch { return null }
  for (let i = 0; i < 5 && dir && dir !== path.dirname(dir); i++) {
    const pj = path.join(dir, 'package.json')
    if (fs.existsSync(pj)) {
      try {
        if (JSON.parse(fs.readFileSync(pj, 'utf8')).name === '@deepseek-ai/dsh') return dir
      } catch { /* ignore */ }
    }
    dir = path.dirname(dir)
  }
  return null
}

function globalNodeModules() {
  const pkg = dshPkgDir()
  return pkg ? path.resolve(pkg, '..', '..') : null
}

function loaderBase() {
  const pkg = dshPkgDir()
  return pkg ? path.join(pkg, 'node_modules', '@deepseek-ai', 'cordis-plugin-loader', 'lib', 'index.js') : null
}

function isLink(p) {
  try { return fs.lstatSync(p).isSymbolicLink() } catch { return false }
}

function linkTarget(p) {
  try { return fs.readlinkSync(p) } catch { return null }
}

function hasPackageJson(dir) {
  try { return fs.existsSync(path.join(dir, 'package.json')) } catch { return false }
}

// 全局 node_modules 里该名字的状态:missing | link-ok | link-dangling | dir(真实目录)
function globalEntryState(name) {
  const globalNM = globalNodeModules()
  if (!globalNM) return { state: 'unknown' }
  const p = path.join(globalNM, name)
  if (!fs.existsSync(p) && !isLink(p)) return { state: 'missing', path: p }
  if (isLink(p)) {
    const target = linkTarget(p)
    const ok = target && fs.existsSync(target) && hasPackageJson(target)
    return { state: ok ? 'link-ok' : 'link-dangling', path: p, target }
  }
  return { state: hasPackageJson(p) ? 'dir' : 'dir-invalid', path: p }
}

// 真加载探测:独立 node 子进程 import 入口(cwd 取 loader 所在目录,与 loader 的解析链一致)
function probeImport(spec, { timeoutMs = 20000 } = {}) {
  const base = loaderBase()
  if (!base || !fs.existsSync(base)) return Promise.resolve({ ok: false, error: '未找到 loader,跳过加载探测' })
  const { realNodeExe } = require('./tool')
  const exe = realNodeExe() || process.execPath
  const code = `import(${JSON.stringify(spec)}).then(() => process.exit(0), (e) => { console.error(String((e && (e.stack || e.message)) || e)); process.exit(3) })`
  return new Promise((resolve) => {
    execFile(exe, ['--input-type=module', '-e', code], {
      cwd: path.dirname(base), windowsHide: true, timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024,
    }, (err, _stdout, stderr) => {
      if (!err) return resolve({ ok: true })
      const text = String(stderr || (err && err.message) || '').trim()
      resolve({ ok: false, error: text.split('\n').slice(0, 4).join(' ').slice(0, 400) })
    })
  })
}

// 解析一个 bundle:给出分档结论
async function checkBundle(profile, name, { deep = true, info = null } = {}) {
  const prof = info || profileInfo(profile)
  const base = loaderBase()
  const item = { name, state: 'unknown', detail: '', resolvedFrom: null, target: null, loadError: null }

  if (!base || !fs.existsSync(base)) {
    item.state = 'loader-missing'
    item.detail = '未找到 dsh 的 cordis-plugin-loader(全局 dsh 安装可能损坏)'
    return item
  }
  let req = null
  try { req = createRequire(base) } catch (e) {
    item.state = 'loader-missing'
    item.detail = `loader 无法加载: ${e.message}`
    return item
  }

  let entry = null
  try { entry = req.resolve(name) } catch { /* 下面分档 */ }
  if (entry) {
    item.state = 'ok'
    item.resolvedFrom = entry
    if (deep) {
      const probe = await probeImport(name)
      if (!probe.ok) {
        item.state = 'load-failed'
        item.loadError = probe.error
        item.detail = `可解析但加载失败:${probe.error}`
        return item
      }
    }
    item.detail = '从 loader 可解析'
    return item
  }

  const g = globalEntryState(name)
  if (g.state === 'link-dangling') {
    item.state = 'link-dangling'
    item.linkTarget = g.target || null
    item.detail = `全局 node_modules 里的联接已断链${g.target ? `(目标不存在:${g.target})` : ''}`
  }
  const candidates = [
    path.join(prof.dir, 'node_modules', name),
    path.join(profilesDir, 'node_modules', name),
  ]
  const src = candidates.find((c) => hasPackageJson(c))
  if (src) {
    // 修复目标是磁盘上真实存在的包目录;断链的旧目标只用于报告
    item.target = src
    if (item.state === 'unknown') {
      item.state = 'profile-only'
      item.detail = `只在 ${path.relative(prof.dir, src).startsWith('..') ? 'profiles 共享目录' : 'profile 内'}存在,需在全局 node_modules 建联接`
    } else {
      item.detail += `;可用的包体在 ${src}`
    }
    return item
  }
  if (item.state === 'unknown') {
    item.state = 'missing'
    item.detail = g.state === 'dir-invalid'
      ? `全局 node_modules 里有同名目录但缺少 package.json:${g.path}`
      : 'profile 与全局目录都找不到这个包,需要先安装该插件'
    item.target = g.path || null
  }
  return item
}

async function checkBundles(profile, { deep = true } = {}) {
  const info = profileInfo(profile)
  if (info.external) {
    return {
      profile, ok: true, skipped: true, external: true, reason: info.externalReason,
      items: [], bad: [], detail: '官方桌面端独占,跳过检查',
    }
  }
  const items = []
  for (const b of info.bundles || []) items.push(await checkBundle(profile, b, { deep, info }))
  // 分档结论:
  //   error = 真的会启动失败(联接断链 / 包不存在 / 加载失败 / loader 缺失)
  //   info  = 仅 profile 内 —— dsh 0.2.x 能直接解析(实测:web profile 有 4 个这样的插件且运行正常),
  //           所以不算失败;旧版 dsh 可能需要联接,修复按钮仍可手动建。
  const SEVERITY = { ok: 'ok', 'profile-only': 'info', 'link-dangling': 'error', missing: 'error', 'load-failed': 'error', 'loader-missing': 'error', unknown: 'error' }
  for (const i of items) i.severity = SEVERITY[i.state] || 'error'
  const bad = items.filter((i) => i.severity === 'error')
  const infoItems = items.filter((i) => i.severity === 'info')
  return {
    profile,
    ok: bad.length === 0,
    items,
    bad: bad.map((i) => i.name),
    badItems: bad,
    infoItems,
    needsReinstallDsh: items.some((i) => i.state === 'loader-missing'),
  }
}

// 全局 dsh 安装完整性:半更新状态下,插件级修复救不了
async function checkGlobalDsh() {
  const base = loaderBase()
  const pkg = dshPkgDir()
  const problems = []
  const warnings = []
  let version = null
  let cliError = null
  try {
    const { version: v } = require('./dsh')
    version = await v()
  } catch (e) { cliError = e.message }
  if (!pkg || !fs.existsSync(path.join(pkg, 'package.json'))) problems.push('未找到全局 @deepseek-ai/dsh 安装目录')
  if (!base || !fs.existsSync(base)) problems.push('缺少 cordis-plugin-loader(loader)')
  // 版本读不出来可能是“真损坏”,也可能只是子进程被拦/临时忙碌 —— 只在安装目录也缺失时才当错误
  if (!version) {
    const line = `dsh CLI 版本未能读取${cliError ? `:${cliError}` : ''}`
    if (problems.length) problems.push(line); else warnings.push(line)
  }
  // bin.js 与 loader 同处一个安装树:用它们的 mtime 粗判"更新是否被中途打断"
  let partial = false
  try {
    const binM = fs.statSync(dshBin()).mtimeMs
    const loaderM = fs.statSync(base).mtimeMs
    partial = Math.abs(binM - loaderM) > 24 * 60 * 60 * 1000
  } catch { /* ignore */ }
  if (partial) problems.push('安装树内文件时间差异常(上次更新可能被中途打断,建议重装 dsh CLI)')
  return {
    ok: problems.length === 0,
    version,
    dshDir: pkg,
    loader: base,
    globalNodeModules: globalNodeModules(),
    problems,
    warnings,
  }
}

// 修复:为"仅 profile 内/断链"的 bundle 在全局 node_modules 建/重建目录联接,并立即复验
async function fixBundles(profile, { deep = true, onLog } = {}) {
  const info = profileInfo(profile)
  if (info.external) return { profile, ok: true, skipped: true, results: [], reason: info.externalReason }
  const globalNM = globalNodeModules()
  if (!globalNM) return { profile, ok: false, results: [{ pkg: '*', status: 'failed', error: '未找到全局 node_modules' }] }
  const results = []
  for (const b of info.bundles || []) {
    const before = await checkBundle(profile, b, { deep: false, info })
    if (before.state === 'ok') { results.push({ pkg: b, status: 'ok', detail: '无需修复' }); continue }
    if (before.state === 'missing') {
      results.push({ pkg: b, status: 'missing', detail: before.detail })
      onLog?.(`[兼容性] ${b}: ${before.detail}`)
      continue
    }
    if (before.state === 'loader-missing' || !before.target) {
      // 全局 dsh 安装本身不完整:插件级修复无意义(需要重装 CLI)
      results.push({ pkg: b, status: before.state === 'loader-missing' ? 'loader-missing' : 'failed', detail: before.detail, error: before.target ? undefined : '没有可用的联接目标' })
      onLog?.(`[兼容性] ${b}: ${before.detail}`)
      continue
    }
    const linkPath = path.join(globalNM, b)
    try {
      if (fs.existsSync(linkPath) || isLink(linkPath)) {
        if (isLink(linkPath)) fs.rmdirSync(linkPath)
        else fs.rmSync(linkPath, { recursive: true, force: true })
      }
      fs.mkdirSync(path.dirname(linkPath), { recursive: true })
      fs.symlinkSync(before.target, linkPath, 'junction')
    } catch (e) {
      results.push({ pkg: b, status: 'failed', error: e.message, target: before.target })
      onLog?.(`[兼容性] ${b}: 建联接失败 ${e.message}`)
      continue
    }
    // 立即复验(旧版修完不复验,所以"点了没反应"也没人知道)
    const after = await checkBundle(profile, b, { deep, info })
    const status = after.state === 'ok' ? 'linked' : 'verify-failed'
    results.push({
      pkg: b, status, target: before.target,
      verify: after.state, detail: after.detail, loadError: after.loadError || null,
    })
    onLog?.(`[兼容性] ${b}: 已建联接 → 复验 ${after.state === 'ok' ? '通过' : `仍未通过(${after.state}:${after.detail})`}`)
  }
  const ok = results.every((r) => r.status === 'ok' || r.status === 'linked')
  return { profile, ok, results }
}

function summarizeCheck(all) {
  const failed = all.profiles.filter((p) => !p.ok && !p.skipped)
  const skipped = all.profiles.filter((p) => p.skipped)
  const parts = []
  parts.push(failed.length ? `${failed.length} 个 profile 有问题` : '所有 profile 插件解析正常')
  const infoCount = all.profiles.reduce((n, p) => n + ((p.infoItems || []).length), 0)
  if (infoCount) parts.push(`${infoCount} 个插件仅存在于 profile 内(dsh 0.2.x 可直接解析,无需处理)`)
  if (skipped.length) parts.push(`跳过 ${skipped.length} 个(官方桌面端独占)`)
  if (!all.global.ok) parts.push(`全局 dsh 安装异常:${all.global.problems.join(';')}`)
  else if ((all.global.warnings || []).length) parts.push(`提示:${all.global.warnings.join(';')}`)
  return parts.join(';')
}

async function checkAll({ deep = true } = {}) {
  const global = await checkGlobalDsh()
  const profiles = []
  for (const p of listProfiles()) profiles.push(await checkBundles(p.name, { deep }))
  return { global, profiles, summary: summarizeCheck({ global, profiles }) }
}

module.exports = {
  checkBundles, checkBundle, fixBundles, checkAll, checkGlobalDsh,
  globalNodeModules, loaderBase, dshPkgDir, probeImport,
}
