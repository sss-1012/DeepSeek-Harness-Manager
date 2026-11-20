'use strict'
/**
 * 校验「真正要给别人用的那一份」安装包,而不是仓库里的源码。
 *
 * 背景:0.4.6 之前连续两次把坏包发了出去 ——
 *   1. main.js 少了 t 绑定 → 启动即 ReferenceError;
 *   2. renderer/app.js 被插进 require() → 浏览器里第 2 行就抛错,界面空白、按钮全死。
 * 两次都是「源码看着对、装出来不对」,所以这里直接拆包看内容。
 *
 * 用法:
 *   node scripts/verify-artifact.js --release v0.4.6        # 从 GitHub Release 下载后校验
 *   node scripts/verify-artifact.js dist/win-unpacked/resources/app.asar
 *   node scripts/verify-artifact.js dist/DeepSeek-...-portable.exe
 *
 * 退出码:0 全通过;1 有检查项失败;2 用法/环境问题。
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const REPO = 'sss-1012/DeepSeek-Harness-Manager'
const WORK = path.join(ROOT, '.tmp-verify')

function find7za() {
  if (process.env.DSHM_7ZA && fs.existsSync(process.env.DSHM_7ZA)) return process.env.DSHM_7ZA
  // electron-builder 会把 7za 下载到自己的缓存里,优先级最高(不依赖 PATH)
  const cacheRoots = [
    path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache'),
    path.join(os.homedir(), 'AppData', 'Local', 'electron-builder', 'Cache'),
  ]
  for (const root of cacheRoots) {
    if (!root || !fs.existsSync(root)) continue
    const hit = findFile(root, (n) => /^7za\.exe$/i.test(n), 4)
    if (hit) return hit
  }
  for (const p of ['7za', '7z']) {
    const r = spawnSync(p, ['i'], { stdio: 'ignore' })
    if (r.status === 0) return p
  }
  return null
}

function findFile(dir, match, maxDepth, depth = 0) {
  if (depth > maxDepth) return null
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return null }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isFile() && match(e.name)) return p
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const hit = findFile(path.join(dir, e.name), match, maxDepth, depth + 1)
    if (hit) return hit
  }
  return null
}

function untar(file, dest) {
  const za = find7za()
  if (!za) return { ok: false, error: '找不到 7za(electron-builder 缓存里也没有);可设 DSHM_7ZA 指向 7za.exe' }
  fs.mkdirSync(dest, { recursive: true })
  const r = spawnSync(za, ['e', file, `-o${dest}`, 'resources\\app.asar', '-y'], {
    stdio: 'ignore', windowsHide: true, timeout: 180000,
  })
  if (r.status !== 0) return { ok: false, error: `7za 解包失败(exit ${r.status})` }
  const asar = path.join(dest, 'app.asar')
  if (!fs.existsSync(asar)) return { ok: false, error: '解包后没有 resources/app.asar' }
  return { ok: true, asar }
}

function downloadPortable(tag) {
  const dir = path.join(WORK, tag)
  fs.mkdirSync(dir, { recursive: true })
  const existing = fs.readdirSync(dir).find((f) => /portable\.exe$/i.test(f))
  if (existing) return { ok: true, file: path.join(dir, existing), cached: true }
  const r = spawnSync('gh', [
    'release', 'download', tag, '--repo', REPO,
    '--pattern', '*portable.exe', '--dir', dir, '--clobber',
  ], { stdio: 'ignore', windowsHide: true, timeout: 900000 })
  if (r.status !== 0) return { ok: false, error: `gh release download 失败(exit ${r.status})` }
  const got = fs.readdirSync(dir).find((f) => /portable\.exe$/i.test(f))
  if (!got) return { ok: false, error: '下载后找不到 portable.exe' }
  return { ok: true, file: path.join(dir, got) }
}

function parseAsar(buf) {
  const headerSize = buf.readUInt32LE(12)
  const header = JSON.parse(buf.subarray(16, 16 + headerSize).toString('utf8'))
  const base = 8 + buf.readUInt32LE(4)
  const files = {}
  const walk = (node, prefix) => {
    for (const [name, child] of Object.entries(node.files || {})) {
      const p = prefix ? `${prefix}/${name}` : name
      if (child.files) walk(child, p)
      else files[p] = child
    }
  }
  walk(header, '')
  const read = (node) => {
    if (!node || node.offset === undefined) return null
    const off = base + Number(node.offset)
    return buf.subarray(off, off + Number(node.size))
  }
  return { files, read }
}

function verify(asarPath) {
  const { files, read } = parseAsar(fs.readFileSync(asarPath))
  const results = []
  const check = (name, pass, detail = '') => results.push({ name, pass, detail })
  const text = (p) => {
    const b = read(files[p])
    return b ? b.toString('utf8') : ''
  }

  // 关键文件
  const must = ['main.js', 'preload.js', 'renderer/app.js', 'renderer/i18n.js',
    'renderer/index.html', 'src/i18n.js', 'src/i18n-en.json']
  for (const f of must) check(`包含 ${f}`, !!files[f], files[f] ? `${files[f].size} B` : '缺失')

  // main.js 的 t 绑定恰好 1 处
  const mainText = text('main.js')
  const tCount = mainText.split(`const { t } = require('./src/i18n')`).length - 1
  check('main.js 的 t 绑定 = 1 处', tCount === 1, `实际 ${tCount} 处`)
  if (/\bt\(/.test(mainText) && tCount === 0) {
    check('main.js 用了 t() 但没绑定', false, '启动会 ReferenceError')
  }

  // 渲染层不许出现 require(
  for (const f of ['renderer/app.js', 'renderer/i18n.js']) {
    const hits = (text(f).match(/\brequire\s*\(/g) || []).length
    check(`${f} 不含 require(`, hits === 0, hits ? `实际 ${hits} 处,浏览器里必然 ReferenceError` : 'ok')
  }

  // 英文词典
  let dictCount = -1
  try {
    dictCount = Object.keys(JSON.parse(text('src/i18n-en.json'))).length
  } catch { dictCount = -1 }
  check('英文词典可解析且条目 > 300', dictCount > 300, `条目 ${dictCount}`)

  // 语言选择器(设置弹窗是 app.js 里拼的 HTML)+ 两个脚本都被加载
  const appJs = text('renderer/app.js')
  check('设置弹窗含语言选择器', appJs.includes('set-language'), '')
  check('保存设置时提交 language 字段', /language\s*:\s*\$\('#set-language'\)/.test(appJs), '')
  const html = text('renderer/index.html')
  check('index.html 加载 i18n.js', /<script[^>]+i18n\.js/.test(html), '')
  check('index.html 加载 app.js', /<script[^>]+app\.js/.test(html), '')

  return results
}

function main() {
  const args = process.argv.slice(2)
  const relIdx = args.indexOf('--release')
  let target = null
  let tempDir = null

  if (relIdx > -1) {
    const tag = args[relIdx + 1]
    if (!tag) { console.error('✘ --release 需要 tag,例如 --release v0.4.6'); process.exit(2) }
    const dl = downloadPortable(tag)
    if (!dl.ok) { console.error(`✘ ${dl.error}`); process.exit(2) }
    console.log(`· 发布包:${dl.file}${dl.cached ? '(已下载)' : ''}`)
    tempDir = path.join(WORK, `${tag}-asar`)
    const ex = untar(dl.file, tempDir)
    if (!ex.ok) { console.error(`✘ ${ex.error}`); process.exit(2) }
    target = ex.asar
  } else if (args[0]) {
    target = path.resolve(args[0])
    if (!fs.existsSync(target)) { console.error(`✘ 找不到 ${target}`); process.exit(2) }
    if (/\.exe$/i.test(target)) {
      tempDir = path.join(WORK, 'local-asar')
      const ex = untar(target, tempDir)
      if (!ex.ok) { console.error(`✘ ${ex.error}`); process.exit(2) }
      target = ex.asar
    }
  } else {
    console.error('usage: node scripts/verify-artifact.js --release <tag> | <app.asar|.exe>')
    process.exit(2)
  }

  console.log(`\n校验:${target}\n`)
  const results = verify(target)
  let bad = 0
  for (const r of results) {
    if (!r.pass) bad++
    console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`)
  }
  console.log(`\n${bad === 0 ? `✔ ${results.length} 项全部通过` : `✘ ${bad}/${results.length} 项失败`}`)
  process.exit(bad === 0 ? 0 : 1)
}

main()
