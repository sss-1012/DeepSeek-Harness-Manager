import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// dsh-harness-manager —— 在 DSH 界面里一键打开 DeepSeek Harness Manager。
// 由 manager 仓库提供;安装:
//   dsh plugin --profile web add dsh-harness-manager
//   dsh plugin --profile web add link:<repo>/plugin      (本地开发)
const name = 'dsh-harness-manager'
const inject = ['webServer']

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MANAGER_HOME = process.env.DSH_MANAGER_HOME || path.join(os.homedir(), '.dsh-manager')
const EXE_NAME = 'DeepSeek-Harness-Manager.exe'
const DOWNLOAD_URL = 'https://github.com/sss-1012/DeepSeek-Harness-Manager/releases/latest'

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
}

function candidatePaths() {
  const list = []
  if (process.env.DSH_MANAGER_EXE) list.push(process.env.DSH_MANAGER_EXE)
  const local = process.env.LOCALAPPDATA || ''
  const pf = process.env.ProgramFiles || 'C:\\Program Files'
  const pf86 = process.env['ProgramFiles(x86)'] || ''
  if (local) {
    list.push(path.join(local, 'Programs', 'DeepSeek-Harness-Manager', EXE_NAME))
    list.push(path.join(local, 'DeepSeek-Harness-Manager', EXE_NAME))
  }
  list.push(path.join(pf, 'DeepSeek-Harness-Manager', EXE_NAME))
  if (pf86) list.push(path.join(pf86, 'DeepSeek-Harness-Manager', EXE_NAME))
  return list
}

// manager 启动时会写 install.json(自注册),优先采用;否则回退到常见安装路径
function locateManager() {
  try {
    const raw = fs.readFileSync(path.join(MANAGER_HOME, 'install.json'), 'utf8')
    const info = JSON.parse(raw.replace(/^\uFEFF/, ''))
    if (info && typeof info.exe === 'string' && fs.existsSync(info.exe)) {
      return { exe: info.exe, version: info.version || null, source: 'install.json' }
    }
  } catch { /* 未自注册 */ }
  for (const p of candidatePaths()) {
    try { if (p && fs.existsSync(p)) return { exe: p, version: null, source: 'path' } } catch { /* 忽略 */ }
  }
  return null
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function apply(ctx) {
  const disposers = []
  if (!ctx || !ctx.webServer) return

  const panelJs = fs.readFileSync(path.join(PACKAGE_ROOT, 'lib', 'panel.js'), 'utf8')

  // 状态:是否已安装、版本、下载地址
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-manager/status.json',
    handler: (req, res) => {
      const found = locateManager()
      res.writeHead(200, JSON_HEADERS)
      res.end(JSON.stringify({
        ok: true,
        installed: Boolean(found),
        exe: found ? found.exe : null,
        version: found ? found.version : null,
        source: found ? found.source : null,
        downloadUrl: DOWNLOAD_URL,
      }))
    },
  }))

  // 启动管理器(单实例锁会让已在运行的窗口前置)
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-manager/launch',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405, JSON_HEADERS)
        res.end(JSON.stringify({ ok: false, error: 'POST only' }))
        return
      }
      try { await readBody(req) } catch { /* 忽略 body */ }
      const found = locateManager()
      if (!found) {
        res.writeHead(200, JSON_HEADERS)
        res.end(JSON.stringify({ ok: false, code: 'NOT_INSTALLED', downloadUrl: DOWNLOAD_URL }))
        return
      }
      try {
        const child = spawn(found.exe, [], { detached: true, stdio: 'ignore', windowsHide: false })
        child.unref()
        res.writeHead(200, JSON_HEADERS)
        res.end(JSON.stringify({ ok: true, exe: found.exe }))
      } catch (err) {
        res.writeHead(200, JSON_HEADERS)
        res.end(JSON.stringify({ ok: false, code: 'LAUNCH_FAILED', error: String((err && err.message) || err).slice(0, 200) }))
      }
    },
  }))

  // 客户端脚本
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-manager/panel.js',
    handler: (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
      })
      res.end(panelJs)
    },
  }))

  // 注入到 Web UI
  disposers.push(ctx.webServer.tapIndex((html) => {
    if (html.indexOf('/dsh-manager/panel.js') !== -1) return html
    const tag = '<script defer src="/dsh-manager/panel.js"></script>'
    if (html.indexOf('</body>') !== -1) return html.replace('</body>', tag + '</body>')
    return html + tag
  }))

  ctx.effect(() => () => {
    for (const d of disposers) {
      try { d() } catch { /* 忽略 */ }
    }
  })
}

export { name, inject, apply }
