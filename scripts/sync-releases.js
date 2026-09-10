'use strict'
// 从 GitHub Releases 同步构建产物到本地归档
// 用途:CI(Actions)在云端构建的发布版,本地也留一份;或补齐历史版本
// 用法:
//   node scripts/sync-releases.js              # 补齐所有缺失版本
//   node scripts/sync-releases.js --only v0.1.2
//   node scripts/sync-releases.js --force      # 已存在也重新下载
// 归档结构:<归档根>/<tag>/<asset>   —— 与 scripts/archive-build.js 保持一致
const fs = require('node:fs')
const path = require('node:path')
const https = require('node:https')

const REPO = 'sss-1012/DeepSeek-Harness-Manager'
const ROOT = path.resolve(__dirname, '..')
const archiveRoot = process.env.DSH_MANAGER_RELEASES_DIR || path.resolve(ROOT, '..', 'DSH-Manager-Releases')
const force = process.argv.includes('--force')
const onlyIdx = process.argv.indexOf('--only')
const onlyTag = onlyIdx > -1 ? process.argv[onlyIdx + 1] : null

function request(url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method,
      headers: { 'User-Agent': 'deepseek-harness-manager-sync', Accept: 'application/vnd.github+json' },
      rejectUnauthorized: false,
      timeout: 60000,
    }, (res) => resolve(res))
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(new Error('timeout')) })
    req.end()
  })
}

// 跟随重定向下载到文件(带简单进度输出)
async function download(url, dest, expectedSize) {
  let current = url
  for (let hop = 0; hop < 6; hop++) {
    const res = await request(current)
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      res.resume()
      current = new URL(res.headers.location, current).toString()
      continue
    }
    if (res.statusCode !== 200) { res.resume(); throw new Error(`HTTP ${res.statusCode}`) }
    const total = Number(res.headers['content-length'] || expectedSize || 0)
    let received = 0
    let lastPrint = 0
    const tmp = `${dest}.part`
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(tmp)
      res.on('data', (chunk) => {
        received += chunk.length
        const now = Date.now()
        if (total && now - lastPrint > 3000) {
          lastPrint = now
          process.stdout.write(`\r      ${(received / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`)
        }
      })
      res.pipe(out)
      out.on('finish', () => out.close(resolve))
      out.on('error', reject)
      res.on('error', reject)
    })
    if (total && received !== total) {
      fs.rmSync(tmp, { force: true })
      throw new Error(`大小不符(收到 ${received} / 期望 ${total})`)
    }
    fs.renameSync(tmp, dest)
    return received
  }
  throw new Error('重定向次数过多')
}

;(async () => {
  console.log(`归档目录: ${archiveRoot}`)
  const res = await request(`https://api.github.com/repos/${REPO}/releases?per_page=100`)
  if (res.statusCode !== 200) throw new Error(`获取 releases 失败:HTTP ${res.statusCode}`)
  let body = ''
  for await (const chunk of res) body += chunk
  const releases = JSON.parse(body)
  if (!Array.isArray(releases) || !releases.length) { console.log('未找到任何 release'); return }

  console.log(`远端发布版:${releases.map((r) => r.tag_name).join(', ')}\n`)
  let downloaded = 0
  let skipped = 0

  for (const rel of releases.slice().reverse()) {
    const tag = rel.tag_name
    if (onlyTag && tag !== onlyTag) continue
    const assets = (rel.assets || []).filter((a) => /\.exe$/i.test(a.name))
    if (!assets.length) { console.log(`- ${tag}: 无 exe 资产,跳过`); continue }
    const dir = path.join(archiveRoot, tag)
    fs.mkdirSync(dir, { recursive: true })
    for (const a of assets) {
      const dest = path.join(dir, a.name)
      if (!force && fs.existsSync(dest) && fs.statSync(dest).size === a.size) {
        console.log(`✓ ${tag}/${a.name} 已存在(${(a.size / 1048576).toFixed(1)} MB),跳过`)
        skipped++
        continue
      }
      process.stdout.write(`↓ ${tag}/${a.name} (${(a.size / 1048576).toFixed(1)} MB)\n`)
      try {
        const got = await download(a.browser_download_url, dest, a.size)
        console.log(`\r  ✔ 完成 ${(got / 1048576).toFixed(1)} MB                    `)
        downloaded++
      } catch (e) {
        console.log(`\r  ✘ 失败:${e.message}                    `)
      }
    }
  }

  const versions = fs.existsSync(archiveRoot)
    ? fs.readdirSync(archiveRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    : []
  console.log(`\n新下载 ${downloaded} 个,跳过 ${skipped} 个`)
  console.log(`本地归档版本(${versions.length}):${versions.join(', ')}`)
})()
