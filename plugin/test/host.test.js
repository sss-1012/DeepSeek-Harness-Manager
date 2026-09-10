// dsh-harness-manager 插件自检(不启动真实 DSH,不接触用户 profile)
// 运行: node plugin/test/host.test.js
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dshm-plugin-test-'))
process.env.DSH_MANAGER_HOME = tmp

const mod = await import('../lib/index.js')

function fakeRes() {
  return {
    status: null,
    headers: null,
    body: '',
    writeHead(s, h) { this.status = s; this.headers = h },
    end(b) { this.body = b == null ? '' : String(b) },
  }
}
function fakeReq(method = 'GET', body = '') {
  return {
    method,
    destroyed: false,
    on(ev, fn) {
      if (ev === 'end') fn()
      else if (ev === 'data' && body) fn(Buffer.from(body))
      return this
    },
    destroy() { this.destroyed = true },
  }
}

function makeCtx() {
  const routes = new Map()
  const taps = []
  let cleanup = null
  return {
    routes,
    taps,
    get cleanup() { return cleanup },
    ctx: {
      webServer: {
        register(route) { routes.set(route.path, route); return () => routes.delete(route.path) },
        tapIndex(fn) { taps.push(fn); return () => taps.splice(taps.indexOf(fn), 1) },
      },
      effect(fn) { cleanup = fn(); return () => cleanup && cleanup() },
    },
  }
}

const results = []
async function test(label, fn) {
  try { await fn(); results.push({ label, ok: true }) } catch (e) { results.push({ label, ok: false, error: e.message }) }
}

await test('导出 name / inject 形态正确', () => {
  assert.equal(mod.name, 'dsh-harness-manager')
  assert.ok(Array.isArray(mod.inject) && mod.inject.includes('webServer'), 'inject 必须含 webServer')
  assert.equal(typeof mod.apply, 'function')
})

const host = makeCtx()
mod.apply(host.ctx)

await test('注册 3 个路由 + 1 个 index 注入 + effect 清理', () => {
  assert.deepEqual([...host.routes.keys()].sort(), ['/dsh-manager/launch', '/dsh-manager/panel.js', '/dsh-manager/status.json'])
  assert.equal(host.taps.length, 1)
  assert.equal(typeof host.cleanup, 'function')
})

await test('缺少 ctx.webServer 时静默退出(不影响宿主启动)', () => {
  const empty = makeCtx()
  mod.apply(empty.ctx)
  assert.ok(empty.routes.size > 0)
  assert.doesNotThrow(() => mod.apply({}))
  assert.doesNotThrow(() => mod.apply(null))
})

await test('status.json:未安装时 installed=false 且给出下载地址', () => {
  const res = fakeRes()
  host.routes.get('/dsh-manager/status.json').handler(fakeReq(), res)
  const data = JSON.parse(res.body)
  assert.equal(res.status, 200)
  assert.equal(data.ok, true)
  assert.equal(data.installed, false)
  assert.match(data.downloadUrl, /^https:\/\/github\.com\/sss-1012\/DeepSeek-Harness-Manager\/releases\/latest$/)
})

await test('status.json:install.json 自注册时回传 exe 与版本', () => {
  const exe = path.join(tmp, 'DeepSeek-Harness-Manager.exe')
  fs.writeFileSync(exe, 'stub')
  fs.writeFileSync(path.join(tmp, 'install.json'), JSON.stringify({ exe, version: '0.1.4', updatedAt: new Date().toISOString() }))
  const res = fakeRes()
  host.routes.get('/dsh-manager/status.json').handler(fakeReq(), res)
  const data = JSON.parse(res.body)
  assert.equal(data.installed, true)
  assert.equal(data.exe, exe)
  assert.equal(data.version, '0.1.4')
  assert.equal(data.source, 'install.json')
})

await test('install.json 指向不存在的 exe 时回退(不误报已安装)', () => {
  fs.writeFileSync(path.join(tmp, 'install.json'), JSON.stringify({ exe: path.join(tmp, 'nope.exe'), version: '9.9.9' }))
  const res = fakeRes()
  host.routes.get('/dsh-manager/status.json').handler(fakeReq(), res)
  const data = JSON.parse(res.body)
  assert.equal(data.installed, false)
})

await test('launch:非 POST 返回 405', async () => {
  const res = fakeRes()
  await host.routes.get('/dsh-manager/launch').handler(fakeReq('GET'), res)
  assert.equal(res.status, 405)
  assert.equal(JSON.parse(res.body).ok, false)
})

await test('launch:未安装返回 NOT_INSTALLED 且不抛错', async () => {
  const res = fakeRes()
  await host.routes.get('/dsh-manager/launch').handler(fakeReq('POST', '{}'), res)
  const data = JSON.parse(res.body)
  assert.equal(res.status, 200)
  assert.equal(data.ok, false)
  assert.equal(data.code, 'NOT_INSTALLED')
  assert.match(data.downloadUrl, /github\.com/)
})

await test('panel.js 路由返回可执行客户端脚本', () => {
  const res = fakeRes()
  host.routes.get('/dsh-manager/panel.js').handler(fakeReq(), res)
  assert.equal(res.status, 200)
  assert.match(res.headers['Content-Type'], /javascript/)
  assert.match(res.body, /__dshManagerPanel/)
})

await test('index 注入:插到 </body> 之前且幂等', () => {
  const tap = host.taps[0]
  const html = '<html><body><div>app</div></body></html>'
  const out = tap(html)
  assert.match(out, /<script defer src="\/dsh-manager\/panel\.js"><\/script><\/body>/)
  assert.equal(tap(out), out, '重复注入不应产生第二份 script 标签')
})

await test('index 注入:无 </body> 时追加', () => {
  const out = host.taps[0]('<html><div>fragment</div>')
  assert.match(out, /panel\.js/)
})

await test('cleanup 可重复调用且不抛错', () => {
  assert.doesNotThrow(() => {
    host.cleanup()
    host.cleanup()
  })
})

// ---- 客户端脚本:语法与顶层守卫(用最小 DOM 桩,不发真实请求) ----
await test('panel.js 语法正确且只挂载一次', () => {
  const src = fs.readFileSync(path.join(here, '..', 'lib', 'panel.js'), 'utf8')
  const prev = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    fetch: globalThis.fetch,
    requestAnimationFrame: globalThis.requestAnimationFrame,
  }
  const node = () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, textContent: '', title: '', id: '' })
  globalThis.window = {}
  globalThis.document = { readyState: 'complete', createElement: node, body: { appendChild() {} }, getElementById: () => null, addEventListener() {} }
  globalThis.localStorage = { getItem: () => null, setItem() {} }
  globalThis.fetch = () => new Promise(() => {}) // 永不 resolve:pending 即通过
  globalThis.requestAnimationFrame = (fn) => fn()
  try {
    new Function(src)()
    assert.equal(globalThis.window.__dshManagerPanel, true)
    new Function(src)() // 第二次执行应被守卫拦住
  } finally {
    for (const [k, v] of Object.entries(prev)) if (v === undefined) delete globalThis[k]; else globalThis[k] = v
  }
})

// ---- 汇总 ----
fs.rmSync(tmp, { recursive: true, force: true })
const failed = results.filter((r) => !r.ok)
for (const r of results) console.log(`${r.ok ? '✔' : '✘'} ${r.label}${r.ok ? '' : `\n    ${r.error}`}`)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
process.exit(failed.length ? 1 : 0)
