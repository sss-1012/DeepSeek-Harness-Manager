// 检查某个 profile 的 bundle 插件能否从 DSH 的 loader 位置解析
//   —— 与管理器「插件兼容性检查」(src/compat.js) 同一判据,但纯只读、不启动任何进程。
// 用法: node plugin/test/resolve-check.mjs [profile=web] [--deep]
//   --deep:再递归检查每个 bundle 自身依赖树(深度 3)是否完整,
//           用于确认 pnpm 清理(如 "Packages: -51")没有删掉插件需要的传递依赖。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const args = process.argv.slice(2)
const deep = args.includes('--deep')
const profile = args.find((a) => !a.startsWith('--')) || 'web'
const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const profileDir = path.join(dshHome, 'profiles', profile)
const pkgPath = path.join(profileDir, 'package.json')

if (!fs.existsSync(pkgPath)) {
  console.error(`找不到 profile:${pkgPath}`)
  process.exit(2)
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
const bundles = pkg.dsh?.profile?.bundles || []

// dsh 全局安装位置 → loader 入口(新版 dsh 就是从它的解析基准找 bundle)
const globalNM = path.join(process.env.APPDATA || '', 'npm', 'node_modules')
const loader = path.join(globalNM, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'cordis-plugin-loader', 'lib', 'index.js')

let req = null
try { req = createRequire(loader) } catch { /* 没有 loader 时只报告磁盘位置 */ }

console.log(`profile: ${profile}`)
console.log(`bundle 数: ${bundles.length}`)
console.log(`loader:   ${fs.existsSync(loader) ? loader : '(未找到,跳过解析基准检查)'}\n`)

let bad = 0
const dirs = new Map()
for (const b of bundles) {
  let state = '无法解析'
  let how = ''
  let resolvedDir = null
  if (req) {
    try { resolvedDir = path.dirname(req.resolve(path.join(b, 'package.json'))); state = 'loader 可解析'; how = 'ok' } catch { /* 继续看磁盘 */ }
  }
  if (state === '无法解析') {
    const local = path.join(profileDir, 'node_modules', b)
    const shared = path.join(dshHome, 'profiles', 'node_modules', b)
    if (fs.existsSync(path.join(local, 'package.json'))) { state = '仅在 profile 内'; how = local; resolvedDir = local }
    else if (fs.existsSync(path.join(shared, 'package.json'))) { state = '仅在共享目录'; how = shared; resolvedDir = shared }
  }
  if (resolvedDir) {
    try { resolvedDir = fs.realpathSync(resolvedDir) } catch { /* 保持原值 */ }
    dirs.set(b, resolvedDir)
  }
  if (state !== 'loader 可解析') bad++
  console.log(`${state === 'loader 可解析' ? '✔' : '✘'} ${b.padEnd(42)} ${state}${how && how !== 'ok' ? '  ' + how : ''}`)
}

// 深度检查:插件自身声明的依赖(含传递依赖)是否都还在
if (deep) {
  console.log('\n=== 依赖树完整度(深度 3)===')
  const seen = new Set()
  const missing = []
  const walk = (pkgDir, depth, chain) => {
    if (depth > 3) return
    let pkg
    try { pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')) } catch { return }
    const deps = Object.keys(pkg.dependencies || {})
    if (!deps.length) return
    let anchor
    try { anchor = createRequire(path.join(pkgDir, 'package.json')) } catch { return }
    for (const dep of deps) {
      const key = pkgDir + '>' + dep
      if (seen.has(key)) continue
      seen.add(key)
      let target = null
      try { target = path.dirname(anchor.resolve(path.join(dep, 'package.json'))) } catch { /* 缺失 */ }
      if (!target) { missing.push(`${pkg.name || chain} → ${dep}`); continue }
      try { target = fs.realpathSync(target) } catch { /* 保持 */ }
      walk(target, depth + 1, dep)
    }
  }
  for (const [name, dir] of dirs) walk(dir, 1, name)
  if (missing.length) {
    bad += missing.length
    console.log(`✘ 缺失 ${missing.length} 个依赖:`)
    for (const m of missing.slice(0, 25)) console.log('   ' + m)
    if (missing.length > 25) console.log(`   … 其余 ${missing.length - 25} 个省略`)
  } else {
    console.log(`✔ ${dirs.size} 个 bundle 的依赖树完整`)
  }
}

console.log(bad ? `\n共 ${bad} 处问题 —— 启动该 profile 可能失败;用管理器的「插件兼容性检查」一键修复。` : '\n全部可从 loader 解析 ✓')
process.exit(bad ? 1 : 0)
