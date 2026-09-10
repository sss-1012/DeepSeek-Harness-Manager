// dsh-harness-manager 插件端到端自检
//   隔离环境创建 mgr-test profile → 安装本插件 → 真实启动 dsh web → 校验路由 → 停止清理
// 安全保证:使用独立的 DSH_HOME / DSH_MANAGER_HOME 与非默认端口,不读写真实的
//          ~/.dsh、~/.dsh-manager,也不影响正在运行的服务。
//
// 用法: node plugin/test/boot-check.mjs [--port 3099] [--keep] [--spec <安装源>]
//   --spec 默认 link:<本仓库>/plugin;验证 npm 发布包时用 --spec dsh-harness-manager
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pluginDir = path.resolve(here, '..').replace(/\\/g, '/')
const argv = process.argv.slice(2)
const port = Number((argv.includes('--port') ? argv[argv.indexOf('--port') + 1] : null) || 3099)
const keep = argv.includes('--keep')
const spec = argv.includes('--spec') ? argv[argv.indexOf('--spec') + 1] : `link:${pluginDir}`
const root = process.env.DSHM_CHECK_ROOT || path.resolve(here, '..', '..', '.dshm-plugin-check')
const profileDir = path.join(root, 'profiles', 'mgr-test')
const bootLog = path.join(root, 'boot.log')
const dshBin = path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')

if (!fs.existsSync(dshBin)) throw new Error(`未找到 dsh CLI: ${dshBin}`)

const results = []
async function check(label, fn) {
  try { await fn(); results.push({ label, ok: true }); console.log(`✔ ${label}`) }
  catch (e) { results.push({ label, ok: false, error: e.message }); console.log(`✘ ${label} — ${e.message}`) }
}

const env = { ...process.env, DSH_HOME: root, DSH_MANAGER_HOME: root }
const dsh = (...args) => execFileSync(process.execPath, [dshBin, ...args], { env, stdio: 'ignore' })

await cleanup(root)
fs.mkdirSync(path.dirname(profileDir), { recursive: true })

console.log(`[1/5] 从内置 web 模板创建测试 profile(${profileDir})`)
dsh('--profile', 'mgr-test', '--from-default-profile', 'web', '--dump-config')
await check('profile 已创建', () => fs.accessSync(path.join(profileDir, 'package.json')))

console.log(`[2/5] 安装插件(${spec})`)
dsh('plugin', '--profile', 'mgr-test', 'add', spec)
const pkg = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'))
await check('插件已加入 dsh.profile.bundles', () => {
  if (!(pkg.dsh?.profile?.bundles || []).includes('dsh-harness-manager')) throw new Error(JSON.stringify(pkg.dsh))
})

// install.json 用于验证「已安装」分支;故意指向不可执行文件,确认启动失败被优雅处理
const stub = path.join(root, 'stub.exe')
fs.writeFileSync(stub, 'stub')
fs.writeFileSync(path.join(root, 'install.json'),
  JSON.stringify({ exe: stub, version: '0.0.0-check', updatedAt: new Date().toISOString() }), 'utf8')

console.log(`[3/5] 启动 dsh web (127.0.0.1:${port}, --no-open)`)
const out = fs.openSync(bootLog, 'w')
const child = spawn(process.execPath, [dshBin, '--profile', 'mgr-test', '--port', String(port), '--no-open'],
  { cwd: profileDir, env, stdio: ['ignore', out, out], windowsHide: true })
fs.closeSync(out)

// pnpm 会在 profile 里为 link: 依赖建立目录联接(junction)。递归删除前先断开,
// 否则删除可能跟随联接走到插件源码目录。
function dropJunctions(dir) {
  let entries = []
  try { entries = fs.readdirSync(dir) } catch { return }
  for (const name of entries) {
    const p = path.join(dir, name)
    let link = false
    try { link = fs.lstatSync(p).isSymbolicLink() } catch { /* 忽略 */ }
    if (link) {
      try { fs.rmdirSync(p) } catch { try { fs.unlinkSync(p) } catch { /* 忽略 */ } }
    } else if (name.startsWith('@')) {
      dropJunctions(p) // scoped 目录(如 @scope/pkg)
    }
  }
}

async function cleanup(dir) {
  dropJunctions(path.join(dir, 'profiles', 'mgr-test', 'node_modules'))
  dropJunctions(path.join(dir, 'profiles', 'node_modules')) // profile 共享依赖目录
  for (let i = 0; i < 3; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
      if (!fs.existsSync(dir)) return true
    } catch { /* 句柄尚未释放 */ }
    await new Promise((r) => setTimeout(r, 800))
  }
  // 被 kill 的子进程树可能仍短暂持有目录句柄,交给独立进程稍后清理
  const code = `setTimeout(() => { for (let i = 0; i < 30; i++) { try { require('fs').rmSync(${JSON.stringify(dir)}, { recursive: true, force: true }) } catch {} ; if (!require('fs').existsSync(${JSON.stringify(dir)})) break ; } }, 3000)`
  try {
    spawn(process.execPath, ['-e', code], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    console.log('  (已交给后台进程清理该目录)')
  } catch { /* 忽略 */ }
  return !fs.existsSync(dir)
}

const base = `http://127.0.0.1:${port}`

// 首页带 token 访问:用 node:http 而不是 fetch —— fetch 会带上 Sec-Fetch-* 等头,
// 会被 web app 的浏览器信任围栏判为「非导航请求」并返回 401。
function httpGetText(url, maxRedirects = 4, cookies = '') {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers: cookies ? { Cookie: cookies } : {} }, (res) => {
      const setCookie = (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ')
      const nextCookies = setCookie || cookies
      const code = res.statusCode || 0
      if ([301, 302, 303, 307, 308].includes(code) && res.headers.location && maxRedirects > 0) {
        res.resume()
        resolve(httpGetText(new URL(res.headers.location, url).href, maxRedirects - 1, nextCookies))
        return
      }
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { body += c })
      res.on('end', () => resolve({ status: code, body, headers: res.headers }))
    })
    req.setTimeout(8000, () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}

let ready = false
for (let i = 0; i < 40 && !ready; i++) {
  await new Promise((r) => setTimeout(r, 750))
  try {
    const r = await fetch(`${base}/dsh-manager/status.json`, { signal: AbortSignal.timeout(2000) })
    ready = r.ok
  } catch { /* 还没起来 */ }
}
await check('服务就绪', () => { if (!ready) throw new Error('40 次探测后仍未就绪') })

try {
  if (ready) {
    console.log('[4/5] 校验路由')
    await check('status.json:已安装分支(读取 install.json)', async () => {
      const d = await (await fetch(`${base}/dsh-manager/status.json`)).json()
      if (d.installed !== true || d.version !== '0.0.0-check') throw new Error(JSON.stringify(d))
    })
    await check('status.json:给出下载地址', async () => {
      const d = await (await fetch(`${base}/dsh-manager/status.json`)).json()
      if (!/releases\/latest$/.test(d.downloadUrl || '')) throw new Error(String(d.downloadUrl))
    })
    await check('panel.js:可执行脚本', async () => {
      const r = await fetch(`${base}/dsh-manager/panel.js`)
      const body = await r.text()
      if (!/javascript/.test(r.headers.get('content-type') || '')) throw new Error(String(r.headers.get('content-type')))
      if (!body.includes('__dshManagerPanel')) throw new Error('脚本内容不含守卫标识')
    })
    await check('index:已注入 panel.js 标签', async () => {
      // token 行在监听就绪后写入,可能晚于 status.json 就绪 → 轮询等待
      let token = null
      for (let i = 0; i < 20 && !token; i++) {
        token = (fs.readFileSync(bootLog, 'utf8').match(/token=([\w-]+)/) || [])[1] || null
        if (!token) await new Promise((r) => setTimeout(r, 250))
      }
      if (!token) throw new Error('boot log 中未找到 token')
      const res = await httpGetText(`${base}/?token=${token}`)
      const html = res.body
      fs.writeFileSync(path.join(root, 'index.html'), html)
      if (!html.includes('<script defer src="/dsh-manager/panel.js"></script>')) {
        throw new Error(`status=${res.status} bytes=${html.length} hasPanelRef=${html.includes('panel.js')} tail=${JSON.stringify(html.slice(-200))}`)
      }
    })
    await check('launch:GET 返回 405', async () => {
      const r = await fetch(`${base}/dsh-manager/launch`)
      if (r.status !== 405) throw new Error(`status=${r.status}`)
    })
    await check('launch:非可执行文件优雅失败', async () => {
      const d = await (await fetch(`${base}/dsh-manager/launch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      })).json()
      if (d.ok !== false || d.code !== 'LAUNCH_FAILED') throw new Error(JSON.stringify(d))
    })
  }
} finally {
  console.log('[5/5] 停止测试实例并清理')
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* 已退出 */ }
  // 等进程真正消失再删:句柄未释放时 Windows 会拒绝删除整个目录树
  for (let i = 0; i < 50; i++) {
    try { process.kill(child.pid, 0) } catch { break }
    await new Promise((r) => setTimeout(r, 300))
  }
  await new Promise((r) => setTimeout(r, 1500))
  if (keep) {
    console.log(`保留目录以便排查:${root}`)
  } else {
    await cleanup(root)
  }
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
process.exit(failed.length ? 1 : 0)
