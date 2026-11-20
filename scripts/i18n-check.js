'use strict'
// 界面语言覆盖率检查:哪些中文还没进英文字典。
//   node scripts/i18n-check.js          → 报告(总是 0 退出)
//   node scripts/i18n-check.js --strict → 有未覆盖条目则 1 退出(发布前用)
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const { MESSAGES } = require(path.join(ROOT, 'src/i18n'))
const strict = process.argv.includes('--strict')

const CJK = /[\u4e00-\u9fff]/
const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim()

const dict = new Map()
for (const k of Object.keys(MESSAGES.en)) dict.set(norm(k), MESSAGES.en[k])

const inventoryPath = path.join(ROOT, 'i18n-inventory.json')
if (!fs.existsSync(inventoryPath)) {
  console.error('missing i18n-inventory.json — run: node scripts/i18n-extract.js')
  process.exit(2)
}
const inv = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'))

// 1. HTML 里的 data-i18n* 必须 100% 有译文(这是我们自己写的标记,不能有缺口)
const html = fs.readFileSync(path.join(ROOT, 'renderer/index.html'), 'utf8')
const marked = []
for (const m of html.matchAll(/data-i18n(?:-html|-title|-placeholder)?="([^"]*)"/g)) marked.push(m[1])
const missingMarked = [...new Set(marked)].filter((k) => !dict.has(norm(k)))

// 1b. 两个历史事故的回归闸门:
//     (a) 渲染层是浏览器脚本,绝不能出现 require() —— 会让整个 app.js 在第 2 行就死掉;
//     (b) 非渲染层凡是用 t( 的文件,必须真的绑定了 t(只 require 了 i18n 不算)。
const rendererFiles = ['renderer/app.js', 'renderer/i18n.js']
const moduleFiles = ['main.js', 'src/compat.js', 'src/diagnose.js', 'src/status.js', 'src/update.js',
  'src/tray.js', 'src/env.js', 'src/security.js', 'src/store.js', 'src/balance.js', 'src/dsh.js',
  'src/profiles.js', 'src/overrides.js', 'src/selfupdate.js', 'src/plugins/index.js']
const wire = []
for (const f of rendererFiles) {
  const p = path.join(ROOT, f)
  if (!fs.existsSync(p)) continue
  if (/\brequire\s*\(/.test(fs.readFileSync(p, 'utf8'))) wire.push(`${f}: 渲染层里出现了 require()`)
}
for (const f of moduleFiles) {
  const p = path.join(ROOT, f)
  if (!fs.existsSync(p)) continue
  const src = fs.readFileSync(p, 'utf8')
  const usesT = /(?:^|[^\w$.])t\(/.test(src)
  const bindsT = /const\s*\{\s*t\s*(?:,[^}]*)?\}\s*=\s*require\(/.test(src)
  if (usesT && !bindsT) wire.push(`${f}: 用了 t() 但没有 const { t } = require(...)`)
}
if (wire.length) {
  console.log('接线错误:')
  for (const w of wire) console.log('  ✘ ' + w)
}

// 2. 字典里不能有"查无此句"的僵尸条目(容易因为改了源码而悄悄失效)
const allSource = inv.items.map((i) => norm(i.text)).concat(marked.map(norm))
const zw = [...dict.keys()].filter((k) => !allSource.includes(k))

// 3. 按文件统计覆盖
const byFile = {}
for (const it of inv.items) {
  const f = byFile[it.file] || (byFile[it.file] = { total: 0, done: 0, todo: [] })
  f.total++
  if (dict.has(norm(it.text))) f.done++
  else f.todo.push(it.text)
}
const total = inv.items.length
const done = inv.items.filter((i) => dict.has(norm(i.text))).length

console.log(`界面文案总条目: ${total}   已英译: ${done} (${((done / total) * 100).toFixed(1)}%)   待译: ${total - done}`)
console.log(`带 i18n 标记的 HTML 文案: ${marked.length} 条,缺译文: ${missingMarked.length}`)
for (const k of missingMarked) console.log(`  ✘ [html] ${k.slice(0, 90)}`)
if (zw.length) {
  console.log(`\n字典里查无出处的条目(可能源码已改): ${zw.length}`)
  for (const k of zw.slice(0, 10)) console.log(`  ? ${k.slice(0, 90)}`)
}
console.log('')
for (const [file, s] of Object.entries(byFile).sort((a, b) => b[1].total - a[1].total)) {
  const pct = ((s.done / s.total) * 100).toFixed(0)
  console.log(`${String(pct).padStart(3)}%  ${file.padEnd(24)} ${s.done}/${s.total}`)
}

const fail = wire.length > 0 || missingMarked.length > 0 || (strict && total !== done)
if (fail) {
  console.log('\n未通过:' + (missingMarked.length ? ' HTML 标记有缺译' : '') + (strict && total !== done ? ` 仍有 ${total - done} 条待译` : ''))
  process.exit(1)
}
console.log('\n通过 ✓')
