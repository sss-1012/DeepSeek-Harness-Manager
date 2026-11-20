'use strict'
/**
 * 批量机翻:把清单里的中文条目翻成英文,写成 src/i18n-en.json(生成物)。
 * 手工词条(src/i18n.js 的 MESSAGES.en)优先级更高,运行时会覆盖这里的结果。
 *
 * 走 clients5.google.com 的 dict-chrome-ex 接口:一次请求可以带多个 q,返回数组,占位符 {0} 原样保留。
 * 结果缓存在 i18n-cache.json,重跑不会重复请求。
 */
const fs = require('node:fs')
const path = require('node:path')
const https = require('node:https')

const ROOT = path.resolve(__dirname, '..')
const BATCH = 18
const CACHE = path.join(ROOT, 'i18n-cache.json')
const OUT = path.join(ROOT, 'src/i18n-en.json')

function get(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => resolve({ status: res.statusCode, data }))
    })
    req.on('error', (e) => resolve({ status: 0, data: e.message }))
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, data: 'timeout' }) })
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function translateBatch(texts, attempt = 0) {
  const qs = texts.map((t) => 'q=' + encodeURIComponent(t)).join('&')
  const url = 'https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=zh-CN&tl=en&' + qs
  const r = await get(url)
  if (r.status !== 200) {
    if (attempt < 4) { await sleep(800 * (attempt + 1)); return translateBatch(texts, attempt + 1) }
    return null
  }
  try {
    const parsed = JSON.parse(r.data)
    // 单个 q 时返回 ["译文"];多个 q 时返回 ["译1","译2",…];偶尔是 [[...]]
    let arr = Array.isArray(parsed) ? parsed.flat(2) : [parsed]
    arr = arr.map((x) => (typeof x === 'string' ? x : String(x)))
    if (arr.length !== texts.length) {
      if (attempt < 4) { await sleep(800 * (attempt + 1)); return translateBatch(texts, attempt + 1) }
      return null
    }
    return arr
  } catch {
    if (attempt < 4) { await sleep(800 * (attempt + 1)); return translateBatch(texts, attempt + 1) }
    return null
  }
}

function tidy(src, dst) {
  if (!dst) return null
  let out = String(dst).trim()
  // 机翻常见的排版噪音
  out = out.replace(/\s+([,.;:!?])/g, '$1').replace(/\s{2,}/g, ' ')
  // 保住首尾空白(片段拼接时很关键)
  const lead = /^\s/.test(src) ? ' ' : ''
  const tail = /\s$/.test(src) ? ' ' : ''
  // 中文标点残留
  out = out.replace(/[「」]/g, '"').replace(/、/g, ', ')
  return lead + out + tail
}

async function main() {
  const inv = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n-inventory.json'), 'utf8'))
  const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {}
  const manual = require(path.join(ROOT, 'src/i18n')).MESSAGES.en

  const keys = [...new Set(inv.items.map((i) => i.text))]
  const todo = keys.filter((k) => !cache[k] && !(k in manual))
  console.log(`总条目 ${keys.length};已有释义(手写 ${Object.keys(manual).length} / 缓存 ${Object.keys(cache).length});待翻 ${todo.length}`)

  let done = 0
  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH)
    const res = await translateBatch(chunk)
    if (!res) { console.log(`  批次 ${i} 失败,跳过`); continue }
    chunk.forEach((k, idx) => { const v = tidy(k, res[idx]); if (v) cache[k] = v })
    done += chunk.length
    if (done % (BATCH * 5) === 0) console.log(`  进度 ${done}/${todo.length}`)
    fs.writeFileSync(CACHE, JSON.stringify(cache, null, 2))
    await sleep(220)
  }

  // 输出:清单里出现的键 → 缓存或手写译文
  const finalMap = {}
  for (const k of keys) {
    const v = manual[k] || cache[k]
    if (v) finalMap[k] = v
  }
  fs.writeFileSync(OUT, JSON.stringify(finalMap, null, 2))
  console.log(`写入 ${path.relative(ROOT, OUT)}:${Object.keys(finalMap).length} 条`)
  const missing = keys.filter((k) => !finalMap[k])
  if (missing.length) {
    console.log(`\n仍未翻译(${missing.length}):`)
    for (const m of missing.slice(0, 20)) console.log('  -', m.slice(0, 70))
  }
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1) })
