'use strict'
// 管理器自更新:检查 GitHub Releases → 下载安装包 → 退出并静默安装
// 只处理「管理器自身」,不碰 dsh / profile / harness 进程
const fs = require('node:fs')
const path = require('node:path')
const https = require('node:https')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { app, shell } = require('electron')
const log = require('./log')
const store = require('./store')

const REPO = 'sss-1012/DeepSeek-Harness-Manager'
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`

function currentVersion() {
  try { return app.getVersion() } catch { return require('../package.json').version }
}

function request(url, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const insecure = Boolean(store.getSettings().insecureGitHub)
    const req = https.request(url, {
      method,
      headers: { 'User-Agent': 'deepseek-harness-manager', Accept: 'application/vnd.github+json', ...headers },
      // 网络环境被证书拦截时,用户可在设置里关掉校验(与 GitHub 搜索同一开关)
      rejectUnauthorized: !insecure,
      timeout: 30000,
    }, (res) => resolve(res))
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(new Error('timeout')) })
    req.end()
  })
}

// 版本比较:只支持 x.y.z 与带 prerelease 的 -rc.N / -alpha.N 形式
function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(v || '').trim())
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] || null }
}

function compareVersions(a, b) {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!x || !y) return 0
  for (const k of ['major', 'minor', 'patch']) {
    if (x[k] !== y[k]) return x[k] > y[k] ? 1 : -1
  }
  if (!x.pre && !y.pre) return 0
  if (!x.pre) return 1    // 正式版 > 预发布版
  if (!y.pre) return -1
  return x.pre === y.pre ? 0 : (x.pre > y.pre ? 1 : -1)
}

// 检查最新版:返回 { current, latest, hasUpdate, assets, notes, error }
async function checkLatest() {
  const current = currentVersion()
  try {
    const res = await request(RELEASES_API)
    if (res.statusCode === 404) return { current, latest: null, hasUpdate: false, error: null, empty: true }
    if (res.statusCode !== 200) {
      res.resume()
      return { current, latest: null, hasUpdate: false, error: `GitHub 返回 HTTP ${res.statusCode}` }
    }
    let body = ''
    for await (const chunk of res) body += chunk
    const rel = JSON.parse(body)
    const latest = String(rel.tag_name || '').replace(/^v/, '')
    const assets = (rel.assets || []).map((a) => ({ name: a.name, size: a.size, url: a.browser_download_url }))
    return {
      current,
      latest,
      hasUpdate: compareVersions(latest, current) > 0,
      assets,
      notes: (rel.body || '').slice(0, 4000),
      page: rel.html_url || RELEASES_PAGE,
      publishedAt: rel.published_at || null,
      error: null,
    }
  } catch (e) {
    log.logWarn(`检查管理器更新失败: ${e.message}`)
    return { current, latest: null, hasUpdate: false, error: e.message }
  }
}

function pickAsset(assets, kind) {
  const list = assets || []
  if (kind === 'portable') return list.find((a) => /portable\.exe$/i.test(a.name)) || null
  return list.find((a) => /setup\.exe$/i.test(a.name)) || null
}

// 下载到临时目录,带进度回调(0~100)与取消
async function download(asset, { onProgress, onChild } = {}) {
  const dir = path.join(os.tmpdir(), 'dsh-manager-update')
  fs.mkdirSync(dir, { recursive: true })
  const dest = path.join(dir, asset.name)
  const tmp = `${dest}.part`

  const follow = (url, hop = 0) => new Promise((resolve, reject) => {
    if (hop > 6) return reject(new Error('重定向次数过多'))
    request(url).then((res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        return resolve(follow(new URL(res.headers.location, url).toString(), hop + 1))
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)) }
      const total = Number(res.headers['content-length'] || asset.size || 0)
      let received = 0
      const out = fs.createWriteStream(tmp)
      res.on('data', (c) => {
        received += c.length
        if (total) onProgress?.(Math.min(99, Math.round((received / total) * 100)), received, total)
      })
      res.pipe(out)
      out.on('finish', () => out.close(() => resolve({ path: dest, tmp, total, received })))
      out.on('error', reject)
      res.on('error', reject)
    }).catch(reject)
  })

  const r = await follow(asset.url)
  if (r.total && r.received !== r.total) {
    fs.rmSync(r.tmp, { force: true })
    throw new Error(`下载不完整(${r.received}/${r.total} 字节)`)
  }
  fs.rmSync(dest, { force: true })
  fs.renameSync(r.tmp, dest)
  log.logInfo(`已下载管理器更新包: ${dest}(${(r.received / 1048576).toFixed(1)} MB)`)
  onProgress?.(100, r.received, r.total)
  return { path: dest, size: r.received }
}

// 启动安装包并退出管理器。setup 用 NSIS 静默参数 /S;portable 直接运行(替换当前文件由用户决定)
function launchInstaller(filePath, { silent = true } = {}) {
  if (!fs.existsSync(filePath)) return { ok: false, error: '安装包不存在' }
  const isPortable = /portable\.exe$/i.test(filePath)
  const args = isPortable ? [] : (silent ? ['/S'] : [])
  try {
    // detached + unref:管理器退出后安装程序继续运行
    const child = spawn(filePath, args, { detached: true, stdio: 'ignore', windowsHide: false })
    child.unref()
    log.logInfo(`已启动安装程序: ${filePath} ${args.join(' ')}`)
    return { ok: true, portable: isPortable }
  } catch (e) {
    log.logWarn(`启动安装程序失败: ${e.message}`)
    return { ok: false, error: e.message }
  }
}

function openReleasePage() {
  try { shell.openExternal(RELEASES_PAGE); return { ok: true } } catch (e) { return { ok: false, error: e.message } }
}

module.exports = {
  currentVersion, checkLatest, download, launchInstaller, openReleasePage,
  pickAsset, compareVersions, RELEASES_PAGE,
}
