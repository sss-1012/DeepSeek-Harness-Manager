'use strict'
// README/docs 链接与图片路径检查:相对路径验证磁盘存在性,外链做 HTTP 探测
const fs = require('node:fs')
const path = require('node:path')
const https = require('node:https')

const ROOT = path.resolve(__dirname, '..')
const FILES = [
  'README.md',
  'README.zh-CN.md',
  'docs/DEVELOPMENT.md',
  'docs/TROUBLESHOOTING.md',
  'docs/zh-CN/DEVELOPMENT.md',
  'docs/zh-CN/TROUBLESHOOTING.md',
  'RELEASE_NOTES.md',
]

function probe(url) {
  return new Promise((resolve) => {
    const req = https.request(url, { method: 'HEAD', headers: { 'User-Agent': 'Mozilla/5.0' }, rejectUnauthorized: false, timeout: 20000 }, (res) => {
      resolve(res.statusCode)
      res.destroy()
    })
    req.on('error', (e) => resolve('ERR:' + (e.code || e.message).toString().slice(0, 24)))
    req.on('timeout', () => { req.destroy(); resolve('TIMEOUT') })
    req.end()
  })
}

const linkRe = /!?\[[^\]]*\]\(([^)\s]+)\)/g
const externals = new Set()
let problems = 0

;(async () => {
  for (const rel of FILES) {
    const file = path.join(ROOT, rel)
    if (!fs.existsSync(file)) { console.log(`✗ 文件缺失: ${rel}`); problems++; continue }
    const text = fs.readFileSync(file, 'utf8')
    const dir = path.dirname(file)
    const bad = []
    for (const m of text.matchAll(linkRe)) {
      const target = m[1]
      if (/^(https?:)?\/\//i.test(target) || target.startsWith('mailto:')) { externals.add(target.replace(/^\/\//, 'https://')); continue }
      if (target.startsWith('#')) continue
      const clean = target.split('#')[0]
      if (!clean) continue
      const abs = path.resolve(dir, clean)
      if (!fs.existsSync(abs)) bad.push(target)
    }
    console.log(`${bad.length ? '✗' : '✓'} ${rel} — 相对链接 ${bad.length ? '异常: ' + bad.join(', ') : '全部有效'}`)
    if (bad.length) problems++
  }

  console.log(`\n=== 外部链接探测(${externals.size} 个)===
`)
  for (const u of [...externals].sort()) {
    const code = await probe(u)
    const ok = code === 200 || code === 301 || code === 302 || code === 307 || code === 308
    if (!ok) problems++
    console.log(`${ok ? '✓' : '✗'} ${code}  ${u}`)
  }

  console.log(`\n结论: ${problems === 0 ? '全部通过 ✓' : problems + ' 处需要修复'}`)
})()
