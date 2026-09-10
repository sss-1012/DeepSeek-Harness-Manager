'use strict'
// 本地归档:把本次打包出的安装版 + 免安装版按版本号复制一份留档
// - 归档目录:DSH_MANAGER_RELEASES_DIR 或 <项目上级>/DSH-Manager-Releases
// - 目录结构:<归档根>/v<version>/DeepSeek-Harness-Manager-<version>-{setup,portable}.exe
// - CI 环境下自动跳过(GitHub Actions 有自己的 Release 产物)
// - 幂等:已存在且大小一致的文件不重复复制
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const version = pkg.version
const distDir = path.join(ROOT, 'dist')
const archiveRoot = process.env.DSH_MANAGER_RELEASES_DIR || path.resolve(ROOT, '..', 'DSH-Manager-Releases')
const force = process.argv.includes('--force')

if (process.env.CI) {
  console.log('· archive: CI 环境,跳过本地归档')
  process.exit(0)
}

const wanted = [
  `DeepSeek-Harness-Manager-${version}-setup.exe`,
  `DeepSeek-Harness-Manager-${version}-portable.exe`,
]

const missing = wanted.filter((f) => !fs.existsSync(path.join(distDir, f)))
if (missing.length) {
  console.error(`✘ archive: dist 中缺少产物:${missing.join(', ')}`)
  console.error('  (先执行 npm run pack 生成,或检查 electron-builder 是否失败)')
  process.exit(1)
}

const targetDir = path.join(archiveRoot, `v${version}`)
fs.mkdirSync(targetDir, { recursive: true })

const results = []
for (const name of wanted) {
  const src = path.join(distDir, name)
  const dst = path.join(targetDir, name)
  const srcSize = fs.statSync(src).size
  if (!force && fs.existsSync(dst) && fs.statSync(dst).size === srcSize) {
    results.push({ name, status: 'skip (已存在)', mb: (srcSize / 1048576).toFixed(1) })
    continue
  }
  fs.copyFileSync(src, dst)
  results.push({ name, status: force ? 'overwrite' : 'copied', mb: (srcSize / 1048576).toFixed(1) })
}

console.log(`✔ archive: v${version} → ${targetDir}`)
for (const r of results) console.log(`   ${r.name}  ${r.mb} MB  [${r.status}]`)

// 顺带列出归档中已有的版本,便于一眼看到本地留存情况
try {
  const versions = fs.readdirSync(archiveRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^v/.test(d.name))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  if (versions.length) console.log(`   本地已留档版本(${versions.length}):${versions.join(', ')}`)
} catch { /* 忽略 */ }
