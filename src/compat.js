'use strict'
// 插件解析兼容性:新版 dsh 从「全局 loader 位置」解析 profile 的 bundle 插件。
// - checkBundles(profile):检测各 bundle 能否从 loader 基准解析
// - fixBundles(profile):在全局 node_modules 里为无法解析的插件创建目录联接(junction,不复制文件)
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { dshBin } = require('./dsh')
const { profileInfo } = require('./profiles')
const { profilesDir } = require('./paths')

// dshBin: <globalRoot>/node_modules/@deepseek-ai/dsh/lib/bin.js
function dshPkgDir() {
  try { return path.resolve(path.dirname(dshBin()), '..', '..') } catch { return null }
}

function globalNodeModules() {
  const pkg = dshPkgDir()
  return pkg ? path.resolve(pkg, '..', '..') : null
}

function loaderBase() {
  const pkg = dshPkgDir()
  return pkg ? path.join(pkg, 'node_modules', '@deepseek-ai', 'cordis-plugin-loader', 'lib', 'index.js') : null
}

function checkBundles(profile) {
  const info = profileInfo(profile)
  const base = loaderBase()
  if (!base || !fs.existsSync(base)) return { profile, ok: true, bad: [], error: '未找到 loader,跳过检查' }
  let req
  try { req = createRequire(base) } catch (e) { return { profile, ok: true, bad: [], error: e.message } }
  const bad = []
  for (const b of info.bundles || []) {
    try { req.resolve(b) } catch { bad.push(b) }
  }
  return { profile, ok: bad.length === 0, bad }
}

function fixBundles(profile) {
  const info = profileInfo(profile)
  const globalNM = globalNodeModules()
  const results = []
  if (!globalNM) return { profile, results: [{ pkg: '*', status: 'failed', error: '未找到全局 node_modules' }] }
  let req = null
  try { req = createRequire(loaderBase()) } catch { /* 无 loader 时全部走联接 */ }
  for (const b of info.bundles || []) {
    if (req) {
      try { req.resolve(b); results.push({ pkg: b, status: 'ok' }); continue } catch { /* 需要修复 */ }
    }
    const candidates = [
      path.join(info.dir, 'node_modules', b),
      path.join(profilesDir, 'node_modules', b),
    ]
    const src = candidates.find((c) => fs.existsSync(path.join(c, 'package.json')))
    if (!src) { results.push({ pkg: b, status: 'missing' }); continue }
    const linkPath = path.join(globalNM, b)
    try {
      fs.mkdirSync(path.dirname(linkPath), { recursive: true })
      if (fs.existsSync(linkPath)) fs.rmSync(linkPath, { recursive: true, force: true })
      fs.symlinkSync(src, linkPath, 'junction')
      results.push({ pkg: b, status: 'linked', target: src })
    } catch (e) {
      results.push({ pkg: b, status: 'failed', error: e.message })
    }
  }
  return { profile, results }
}

module.exports = { checkBundles, fixBundles, globalNodeModules, loaderBase }
