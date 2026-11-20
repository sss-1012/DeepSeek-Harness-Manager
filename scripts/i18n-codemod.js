'use strict'
/**
 * 一次性 codemod:把 JS 里的中文文案包成 t("…"),让界面能按语言切换。
 *
 * 规则(保守,宁可漏包也不改坏逻辑):
 *  - 字符串字面量:整条包成 t("…"),但跳过
 *      · 对象键 / case 标签(后面紧跟 `:`)
 *      · 比较与字符串匹配的实参(==, ===, !=, !==, includes(, indexOf(, startsWith(,
 *        endsWith(, match(, split(, replace(, search(, test(, RegExp()
 *      · require(/import( 的实参、console. 那一行
 *  - 模板字符串:没有 ${} 的整条包成 t("…");有 ${} 的只包"中文连续片段"为 ${t("…")},
 *    这样 HTML/表达式结构完全不动。
 *  - 只处理给定扩展名的文件;处理完必须 node --check 通过。
 *
 * 用法:node scripts/i18n-codemod.js [--dry]
 */
const fs = require('node:fs')
const path = require('node:path')
// 语法校验用 vm.Script(等价于 node --check 的脚本模式);不走子进程——沙箱里 spawn 会被拒

const ROOT = path.resolve(__dirname, '..')
const DRY = process.argv.includes('--dry')
const FILES = [
  'renderer/app.js',
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
// 中文片段:中文字 + 常见中文标点/全角符号(不含 ${ } `)
const RUN = /[\u4e00-\u9fff\uff00-\uffef\u3000-\u303f]+/g
const SKIP_CALL = /(?:^|[^A-Za-z0-9_$.])(includes|indexOf|startsWith|endsWith|match|split|replace|search|test|RegExp|require|import)\s*\(\s*$/
const SKIP_OP = /(?:===|!==|==|!=)\s*$/

function needsT(file) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8')
  if (/require\(['"]\.\/src\/i18n['"]\)|require\(['"]\.\/i18n['"]\)/.test(text)) return { text, hasT: true }
  return { text, hasT: false }
}

function transform(text, file) {
  let out = ''
  let i = 0
  let changed = 0
  const n = text.length
  // 上一次输出是否以 "t(" 结尾(避免重复包裹)
  const wrappedAlready = () => /(?:^|[^\w$])t\(\s*$/.test(out)

  while (i < n) {
    const c = text[i]
    if (c === '/' && text[i + 1] === '/') {
      const j = text.indexOf('\n', i)
      out += text.slice(i, j === -1 ? n : j)
      i = j === -1 ? n : j
      continue
    }
    if (c === '/' && text[i + 1] === '*') {
      const j = text.indexOf('*/', i + 2)
      out += text.slice(i, j === -1 ? n : j + 2)
      i = j === -1 ? n : j + 2
      continue
    }
    if (c === '\'' || c === '"') {
      const quote = c
      let j = i + 1
      while (j < n) {
        if (text[j] === '\\') { j += 2; continue }
        if (text[j] === quote || text[j] === '\n') break
        j++
      }
      const raw = text.slice(i + 1, j)
      const value = raw.replace(/\\(['"\\])/g, '$1')
      const nextCh = (text.slice(j + 1).match(/^\s*(.)/) || [])[1] || ''
      const isKey = nextCh === ':' && !/^\s*$/.test(out.slice(-1))
      const logic = SKIP_CALL.test(out) || SKIP_OP.test(out)
      const consoleLine = /console\.[a-z]+\([^)]*$/.test(out)
      if (!CJK.test(value) || j >= n || isKey || logic || consoleLine || wrappedAlready()) {
        out += text.slice(i, j + 1)
      } else {
        out += 't(' + JSON.stringify(value) + ')'
        changed++
      }
      i = j + 1
      continue
    }
    if (c === '`') {
      let j = i + 1
      let segs = []       // { kind: 'text'|'expr', value }
      let cur = ''
      let hasExpr = false
      while (j < n) {
        const ch = text[j]
        if (ch === '\\') { cur += ch + (text[j + 1] || ''); j += 2; continue }
        if (ch === '`') break
        if (ch === '$' && text[j + 1] === '{') {
          hasExpr = true
          if (cur) { segs.push({ kind: 'text', value: cur }); cur = '' }
          let k = j + 2
          let d = 1
          let expr = ''
          while (k < n && d > 0) {
            if (text[k] === '{') d++
            else if (text[k] === '}') { d--; if (!d) break }
            expr += text[k]
            k++
          }
          segs.push({ kind: 'expr', value: expr })
          j = k + 1
          continue
        }
        cur += ch
        j++
      }
      if (cur) segs.push({ kind: 'text', value: cur })
      const whole = text.slice(i + 1, j)
      const simple = !hasExpr && CJK.test(whole)
      if (simple && !wrappedAlready()) {
        out += 't(' + JSON.stringify(whole.replace(/\\([`$\\])/g, '$1')) + ')'
        changed++
      } else if (hasExpr && segs.some((s) => s.kind === 'text' && CJK.test(s.value))) {
        let built = '`'
        for (const s of segs) {
          if (s.kind === 'expr') { built += '${' + s.value + '}'; continue }
          let text = s.value
          let last = 0
          let m
          RUN.lastIndex = 0
          while ((m = RUN.exec(text))) {
            const piece = m[0]
            if (!CJK.test(piece)) continue
            if (m.index > last) built += text.slice(last, m.index)
            built += '${t(' + JSON.stringify(piece) + ')}'
            last = m.index + piece.length
          }
          built += text.slice(last)
        }
        built += '`'
        out += built
        if (built !== text.slice(i, j + 1)) changed++
      } else {
        out += text.slice(i, j + 1)
      }
      i = j + 1
      continue
    }
    out += c
    i++
  }
  return { out, changed }
}

let totalChanged = 0
for (const file of FILES) {
  const abs = path.join(ROOT, file)
  if (!fs.existsSync(abs)) continue
  const { text, hasT } = needsT(file)
  const { out, changed } = transform(text, file)
  if (!changed) continue
  let next = out
  if (!hasT) {
    const req = file.startsWith('src/') ? "const { t } = require('./i18n')\n" : "const { t } = require('./src/i18n')\n"
    // 插到第一段 require/import 之后
    const m = next.match(/^(?:(?:'use strict'[^\n]*\n)|(?:\s*\n))*/)
    next = next.slice(0, m[0].length) + req + next.slice(m[0].length)
  }
  if (DRY) { console.log(`[dry] ${file}: ${changed} 处`); continue }
  const prev = fs.readFileSync(abs, 'utf8')
  fs.writeFileSync(abs, next, 'utf8')
  try {
    new (require('node:vm').Script)(next, { filename: abs })
    console.log(`✔ ${file}: ${changed} 处`)
    totalChanged += changed
  } catch (e) {
    fs.writeFileSync(abs, prev, 'utf8')
    console.log(`✘ ${file}: 语法检查失败,已回滚`)
    console.log(String(e.stderr || e.message).split('\n').slice(0, 4).join('\n'))
  }
}
console.log(`\n完成:${totalChanged} 处`)
