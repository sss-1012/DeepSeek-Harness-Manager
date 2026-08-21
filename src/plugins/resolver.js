'use strict'
// 插件依赖解析器:解析目标包依赖中的插件类依赖(递归,最多 3 层)
const fs = require('node:fs')
const npm = require('./sources/npm')
const github = require('./sources/github')
const local = require('./sources/local')
const { isPluginLike } = require('./plugin-util')

const MAX_DEPTH = 3

async function resolveDeps(spec) {
  const visited = new Set()
  const out = []
  const seenNames = new Set()

  function push(dep, version, parent, from) {
    if (seenNames.has(dep)) return
    seenNames.add(dep)
    out.push({ name: dep, version, parent, from })
  }

  async function walk(specName, parent, level) {
    if (level > MAX_DEPTH) return
    let pkg = null
    try {
      if (specName.startsWith('link:') || specName.startsWith('file:') || specName.startsWith('./') || specName.startsWith('.\\')) {
        const p = specName.replace(/^(link:|file:)/, '')
        if (fs.existsSync(p)) pkg = local.getPackageJson(p)
      } else if (specName.startsWith('github:') || /^https?:\/\/github\.com\//.test(specName)) {
        pkg = await github.getPackageJson(specName)
      } else {
        const parsed = npm.parseSpec(specName.replace(/^(link:|file:)/, ''))
        if (parsed) pkg = await npm.getPackageJson(parsed.name)
      }
    } catch { pkg = null }
    if (!pkg || typeof pkg.dependencies !== 'object') return
    for (const [dep, ver] of Object.entries(pkg.dependencies)) {
      if (!isPluginLike(dep)) continue
      if (visited.has(dep)) { push(dep, ver, parent, specName); continue }
      visited.add(dep)
      push(dep, ver, parent, specName)
      await walk(dep, specName, level + 1)
    }
  }

  await walk(spec, null, 1)
  return out
}

module.exports = { resolveDeps }
