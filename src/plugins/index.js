'use strict'
// 插件服务:列表 / 启停(overrides)/ 卸载 / 安装
const fs = require('node:fs')
const path = require('node:path')
const { execDsh } = require('../dsh')
const { profileInfo } = require('../profiles')
const { disabledIds, setEnabled } = require('../overrides')
const { isPluginLike } = require('./plugin-util')
const resolver = require('./resolver')
const npmSource = require('./sources/npm')
const { profilesDir } = require('../paths')

// pnpm workspace 会把依赖提升到 profiles 根 node_modules,查找时两个位置都要看
function resolvePkgDir(profileDirPath, name) {
  const local = path.join(profileDirPath, 'node_modules', name)
  if (fs.existsSync(path.join(local, 'package.json'))) return local
  const shared = path.join(profilesDir, 'node_modules', name)
  if (fs.existsSync(path.join(shared, 'package.json'))) return shared
  return null
}

function pkgMeta(profileDirPath, name) {
  const dir = resolvePkgDir(profileDirPath, name)
  if (!dir) return { version: '?', description: '', hasDshBundle: false }
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    return { version: j.version || '?', description: j.description || '', hasDshBundle: Boolean(j.dsh?.bundle) }
  } catch {
    return { version: '?', description: '', hasDshBundle: false }
  }
}

// 列出 profile 的插件:bundles(可启停)+ 其他已安装的插件类依赖(信息展示)
function listPlugins(profile) {
  const info = profileInfo(profile)
  const disabled = disabledIds(profile)
  const bundles = (info.bundles || []).map((b) => {
    const meta = pkgMeta(info.dir, b)
    return {
      id: b,
      name: b,
      version: meta.version,
      description: meta.description,
      enabled: !disabled.includes(b),
      kind: 'bundle',
      installState: meta.version === '?' ? 'missing' : 'installed',
      hasDshBundle: meta.hasDshBundle,
    }
  })
  const extraDeps = Object.entries(info.dependencies || {})
    .filter(([name]) => !(info.bundles || []).includes(name) && isPluginLike(name))
    .map(([name, ver]) => {
      const meta = pkgMeta(info.dir, name)
      return {
        id: name,
        name,
        version: ver,
        description: meta.description,
        enabled: false,
        kind: 'dependency',
        installState: 'installed',
        hasDshBundle: meta.hasDshBundle,
      }
    })
  return { profile, plugins: [...bundles, ...extraDeps], disabledIds: disabled }
}

async function uninstall(profile, pkg) {
  return execDsh(['plugin', '--profile', profile, 'remove', pkg], { cwd: profileInfo(profile).dir, timeout: 180000 })
}

async function installSpec(profile, spec) {
  return execDsh(['plugin', '--profile', profile, 'add', spec], { cwd: profileInfo(profile).dir, timeout: 300000 })
}

// 更新插件到最新版本(pnpm update --latest)
async function update(profile, pkg) {
  return execDsh(['plugin', '--profile', profile, 'update', pkg, '--latest'], { cwd: profileInfo(profile).dir, timeout: 300000 })
}

// 解析插件详情页(优先 GitHub 仓库地址)
async function resolveDetailUrl(pkg) {
  try {
    const j = await npmSource.getPackageJson(pkg)
    const repo = j.repository?.url || ''
    if (/github\.com/.test(repo)) return repo.replace(/^git\+/, '').replace(/\.git$/, '')
    if (/^https?:\/\//.test(repo)) return repo
    if (j.homepage && /^https?:\/\//.test(j.homepage)) return j.homepage
    return null
  } catch { return null }
}

async function installWithDeps(profile, spec, { withDeps = true, onLog } = {}) {
  const logs = []
  const run = async (label, fn) => {
    const r = await fn()
    const text = `[${label}] ${r.stdout || ''}${r.stderr ? '\n[stderr] ' + r.stderr : ''}`.trim()
    if (text) { logs.push(text); onLog?.(text) }
    if (!r.ok) throw new Error(`${label} 失败:${r.stderr || r.error || r.stdout || ''}`.slice(0, 800))
    return r
  }
  let deps = []
  if (withDeps) {
    try { deps = await resolver.resolveDeps(spec) } catch { deps = [] }
  }
  await run(`安装 ${spec}`, () => installSpec(profile, spec))
  for (const d of deps) {
    try { await run(`依赖 ${d.name}`, () => installSpec(profile, d.name)) } catch (e) { logs.push(`依赖 ${d.name} 安装失败(已跳过): ${e.message}`) }
  }
  return { ok: true, logs, deps }
}

module.exports = { listPlugins, uninstall, installSpec, installWithDeps, update, resolveDetailUrl, setEnabled, pkgMeta }
