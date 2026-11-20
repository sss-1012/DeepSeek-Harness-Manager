'use strict'
// 抽取界面文案清单(中文原文作 key)。
// 输出 i18n-inventory.json:{items:[{file,line,kind,text,placeholders}], stats:{...}}
// kind: literal | template | html-text | html-attr
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const FILES = [
  'renderer/app.js',
  'renderer/index.html',
  'main.js',
  'src/compat.js',
  'src/diagnose.js',
  'src/status.js',
  'src/update.js',
  'src/tray.js',
  'src/env.js',
  'src/security.js',
  'src/store.js',
  'src/balance.js',
  'src/desktop.js',
  'src/dsh.js',
  'src/profiles.js',
  'src/overrides.js',
  'src/selfupdate.js',
  'src/plugins/index.js',
]

const CJK = /[\u4e00-\u9fff]/

// 极简 JS 词法扫描:只识别字符串字面量与模板字符串,跳过注释。
// 目标不是完美解析,而是"够用来定位 UI 文案";误判由 node --check 兜底。
function scanJs(text) {
  const out = []
  let i = 0
  let line = 1
  const n = text.length
  while (i < n) {
    const c = text[i]
    if (c === '\n') { line++; i++; continue }
    if (c === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i++; continue }
    if (c === '/' && text[i + 1] === '*') {
      i += 2
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) { if (text[i] === '\n') line++; i++ }
      i += 2
      continue
    }
    if (c === '\'' || c === '"') {
      const quote = c
      const startLine = line
      let j = i + 1
      let raw = ''
      while (j < n && text[j] !== quote) {
        if (text[j] === '\\') { raw += text[j] + text[j + 1]; j += 2; continue }
        if (text[j] === '\n') { line++; break }
        raw += text[j]
        j++
      }
      const value = raw.replace(/\\(['"\\])/g, '$1')
      if (CJK.test(value)) out.push({ line: startLine, kind: 'literal', text: value })
      i = j + 1
      continue
    }
    if (c === '`') {
      const startLine = line
      let j = i + 1
      let raw = ''
      let placeholders = 0
      let depth = 0
      let simple = true
      while (j < n) {
        const ch = text[j]
        if (ch === '\\') { raw += ch + (text[j + 1] || ''); j += 2; continue }
        if (depth === 0 && ch === '`') break
        if (ch === '$' && text[j + 1] === '{') {
          placeholders++
          let k = j + 2
          let expr = ''
          let d = 1
          while (k < n && d > 0) {
            if (text[k] === '{') d++
            else if (text[k] === '}') { d--; if (d === 0) break }
            expr += text[k]
            k++
          }
          if (expr.includes('`') || /\{[\s\S]*\}/.test(expr.replace(/\{[^{}]*\}/g, ''))) simple = false
          raw += `{p${placeholders - 1}}`
          j = k + 1
          continue
        }
        if (ch === '\n') line++
        raw += ch
        j++
      }
      if (CJK.test(raw)) out.push({ line: startLine, kind: 'template', text: raw, placeholders, simple })
      i = j + 1
      continue
    }
    i++
  }
  return out
}

// HTML:文本节点 + 常见属性
function scanHtml(text) {
  const out = []
  let line = 1
  const re = /(>)([^<>]+)(<)|(?:title|placeholder|aria-label)="([^"]*)"/g
  let m
  while ((m = re.exec(text))) {
    line = (text.slice(0, m.index).match(/\n/g) || []).length + 1
    if (m[2] && CJK.test(m[2]) && m[2].trim()) out.push({ line, kind: 'html-text', text: m[2].trim() })
    if (m[3] && CJK.test(m[3])) out.push({ line, kind: 'html-attr', text: m[3] })
  }
  return out
}

const seen = new Map()
const perFile = {}
for (const rel of FILES) {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) continue
  const text = fs.readFileSync(abs, 'utf8')
  const items = rel.endsWith('.html') ? scanHtml(text) : scanJs(text)
  perFile[rel] = items.length
  for (const it of items) {
    const key = it.kind === 'template' ? `T:${it.text}` : `L:${it.text}`
    if (!seen.has(key)) seen.set(key, { ...it, file: rel, occurrences: 1 })
    else seen.get(key).occurrences++
  }
}

const items = [...seen.values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
fs.writeFileSync(path.join(ROOT, 'i18n-inventory.json'), JSON.stringify({ stats: { files: perFile, unique: items.length }, items }, null, 2))
console.log('per file:', JSON.stringify(perFile))
console.log('unique strings:', items.length)
console.log('templates with placeholders:', items.filter((i) => i.kind === 'template').length,
  '(non-simple:', items.filter((i) => i.kind === 'template' && !i.simple).length + ')')
