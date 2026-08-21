'use strict'
// 跨平台工具执行:Windows 上 npm/pnpm 是 .cmd shim,直接 spawn 不可靠。
// 方案:解析 shim 内容找到真实 JS 入口(npm-cli.js / pnpm.cjs),用 node 直接执行。
const fs = require('node:fs')
const path = require('node:path')
const { execFile, execFileSync } = require('node:child_process')

const cache = new Map()

// Electron 主进程里 process.execPath 是 electron.exe,需要 ELECTRON_RUN_AS_NODE=1 才能当 node 用
function nodeRunEnv() {
  if (process.versions && process.versions.electron) {
    return { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  }
  return process.env
}

function whereAll(cmd) {
  try {
    const out = execFileSync('where.exe', [cmd], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  } catch { return [] }
}

// 从 .cmd shim 里提取真实 JS 入口。新版 shim(如 npm.cmd)用变量间接执行:
//   SET "NPM_CLI_JS=%~dp0\node_modules\npm\bin\npm-cli.js" ... "%NODE_EXE%" "%NPM_CLI_JS%" %*
// 解析顺序:① 字面 node_modules 路径(不含 =)→ ② SET "VAR=路径" 赋值(取最后一个)→ ③ 执行行 %VAR% 解引用
function jsEntryFromShim(cmdPath) {
  try {
    const content = fs.readFileSync(cmdPath, 'utf8')
    // ① 字面引用(不含 =,避免匹配到 SET 赋值)
    const literals = [...content.matchAll(/"([^"]*node_modules[^"]+\.(?:js|cjs|mjs))"/gi)]
      .map((m) => m[1])
      .filter((s) => !s.includes('='))
    if (literals.length) {
      const hit = resolveShimPath(cmdPath, literals[literals.length - 1])
      if (hit) return hit
    }
    // ② SET "VAR=path"(取最后一个 node_modules js 赋值)
    const sets = [...content.matchAll(/SET\s+"([A-Z0-9_]+)=([^"]*node_modules[^"]+\.(?:js|cjs|mjs))"/gi)]
    if (sets.length) {
      const hit = resolveShimPath(cmdPath, sets[sets.length - 1][2])
      if (hit) return hit
    }
    // ③ 执行行引用 %VAR%:先收集全部 SET 赋值再解引用
    const varMap = {}
    for (const m of content.matchAll(/SET\s+"([A-Z0-9_]+)=([^"]*)"/gi)) varMap[m[1]] = m[2]
    const execLines = content.split(/\r?\n/).filter((l) => /%[A-Z0-9_]+%/.test(l) && /\.(js|cjs|mjs)/i.test(l))
    for (const line of execLines.reverse()) {
      const vars = [...line.matchAll(/"%([A-Z0-9_]+)%"/g)].map((m) => m[1])
      for (const v of vars.reverse()) {
        if (varMap[v] && /node_modules/.test(varMap[v])) {
          const hit = resolveShimPath(cmdPath, varMap[v])
          if (hit) return hit
        }
      }
    }
    return null
  } catch { return null }
}

function resolveShimPath(cmdPath, raw) {
  const rel = raw.replace(/^%[~]?dp0%?\\?/i, '').replace(/\\/g, path.sep)
  const base = path.resolve(path.dirname(cmdPath), rel)
  if (fs.existsSync(base)) return base
  // 扩展名兜底
  for (const ext of ['.cjs', '.js', '.mjs']) {
    const cand = base.replace(/\.(js|cjs|mjs)$/i, '') + ext
    if (fs.existsSync(cand)) return cand
  }
  return null
}

// 从 where.exe node 结果推断 Node 安装目录(不依赖 process.execPath,electron 下该值不可用)
function nodeInstallDir() {
  try {
    const out = execFileSync('where.exe', ['node'], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
    const p = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0]
    return p ? path.dirname(p) : null
  } catch { return null }
}

// 解析工具的真实 JS 入口
function resolveJsTool(cmd) {
  if (cache.has(cmd)) return cache.get(cmd)
  let entry = null
  const all = whereAll(cmd)
  // 优先 .cmd shim;npm 有扩展名 shim 时优先 node_modules 形式
  const cmdPath = all.find((p) => /\.cmd$/i.test(p)) || all[0]
  if (cmdPath) {
    if (/\.cmd$/i.test(cmdPath)) {
      entry = jsEntryFromShim(cmdPath)
    } else if (/\.exe$/i.test(cmdPath)) {
      // 原生 exe(node/git)直接执行
      entry = cmdPath
    }
  }
  if (!entry) {
    // 兜底:从 node.exe 安装目录推断(node 与 npm 同目录),再查全局 npm 目录
    const nodeDir = nodeInstallDir()
    const fallbacks = [
      nodeDir ? path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js') : null,
      path.join(process.env.APPDATA || '', 'npm', 'node_modules', cmd, 'bin', `${cmd}.cjs`),
      path.join(process.env.APPDATA || '', 'npm', 'node_modules', cmd, 'bin', `${cmd}.js`),
      path.join(process.env.APPDATA || '', 'npm', 'node_modules', cmd, 'lib', 'cli.js'),
    ]
    for (const f of fallbacks) { if (f && fs.existsSync(f)) { entry = f; break } }
  }
  cache.set(cmd, entry || null)
  return entry
}

// 异步执行工具(输出走管道,供调用方捕获)
function execTool(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const entry = resolveJsTool(cmd)
    if (!entry) return resolve({ ok: false, code: 'ENOENT', stdout: '', stderr: `未找到命令: ${cmd}`, error: `ENOENT ${cmd}` })
    const isNative = /\.exe$/i.test(entry)
    execFile(isNative ? entry : process.execPath, isNative ? args : [entry, ...args], {
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
      env: nodeRunEnv(),
      ...opts,
    }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        code: err ? (err.code || 1) : 0,
        stdout: stdout || '',
        stderr: stderr || '',
        error: err ? err.message : null,
      })
    })
  })
}

// 同步执行(诊断用)
function execToolSync(cmd, args, opts = {}) {
  const entry = resolveJsTool(cmd)
  if (!entry) return { ok: false, stdout: '', error: `未找到命令: ${cmd}` }
  try {
    const isNative = /\.exe$/i.test(entry)
    const out = execFileSync(isNative ? entry : process.execPath, isNative ? args : [entry, ...args], {
      encoding: 'utf8', windowsHide: true, timeout: 15000, env: nodeRunEnv(), ...opts,
    })
    return { ok: true, stdout: out || '' }
  } catch (e) {
    return { ok: false, stdout: '', error: e.message }
  }
}

module.exports = { execTool, execToolSync, resolveJsTool }
