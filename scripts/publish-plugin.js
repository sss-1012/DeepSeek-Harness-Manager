'use strict'
/**
 * 半自动发布 npm 插件 dsh-harness-manager
 *
 * 为什么是「半自动」:本地能查的、能验的、能打包的全部自动做,只有一件机器做不了的事
 * 停下来等人 —— 登录(或提供有写权限的 token)。人补完凭据后重跑同一条命令,它自动接着发布。
 *
 * 用法:
 *   node scripts/publish-plugin.js                # 预检 → 认证 → 冲突检查 → 发布 → 校验
 *   node scripts/publish-plugin.js --dry-run      # 只看要发什么(本地检查,不需要登录)
 *   node scripts/publish-plugin.js --yes          # 不问确认
 *   node scripts/publish-plugin.js --no-login     # 不自动发起登录,只打印入口
 *   node scripts/publish-plugin.js --wait=600     # 等登录成功的秒数(默认 300)
 *   node scripts/publish-plugin.js --otp=123456   # 直接给一次性密码
 *
 * 认证与二重验证都是「等人」而不是「报错退出」:
 *   - 未登录 → 打印登录入口,并在本终端跑 npm login --auth-type=web(npm 自己会开浏览器
 *     并等待),同时轮询 npm whoami;检测到登录成功就自动继续(也适用于你在别的终端登录)。
 *   - 发布时遇到 EOTP → 和手动发布一样走 npm 的浏览器验证(--auth-type=web),
 *     不行再退回输入 6 位验证码。
 *
 * 提供 token 的两种方式(等价):
 *   $env:NPM_TOKEN="npm_xxx"; node scripts/publish-plugin.js      # 推荐:不写进任何文件
 *   npm login --registry https://registry.npmjs.org               # 写进 ~/.npmrc,后续一直有效
 *
 * 退出码:0 成功/干跑通过;1 失败;2 卡在需要人工的地方(补完凭据重跑即可)。
 *
 * 设计说明:
 *  - 子进程输出走临时文件而不是管道(受限沙箱里 piped stdio 会 EPERM)。
 *  - token 只从环境变量读,写进临时 .npmrc(仅本次进程用,结束即删),永不回显。
 */
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const PLUGIN = path.join(ROOT, 'plugin')
const TMP = path.join(ROOT, '.tmp-publish')
const REGISTRY = 'https://registry.npmjs.org'
const NAME = 'dsh-harness-manager'

const argv = process.argv.slice(2)
const flag = (n) => argv.includes(`--${n}`)
const opt = (n, d = null) => {
  const eq = argv.find((a) => a.startsWith(`--${n}=`))
  if (eq) return eq.slice(n.length + 3)
  const i = argv.indexOf(`--${n}`)
  if (i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1]
  return d
}
const DRY = flag('dry-run')
const YES = flag('yes') || flag('y')
const OTP = opt('otp')
const SKIP_TESTS = flag('skip-tests')
const NO_LOGIN = flag('no-login')
const WAIT_SEC = Math.max(0, Number(opt('wait', '300')) || 0)
const LOGIN_URL = 'https://www.npmjs.com/login'

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
}
const log = (...a) => console.log(...a)
const step = (n, t) => log(`\n${C.cyan}${C.bold}[${n}] ${t}${C.reset}`)
const ok = (m) => log(`  ${C.green}✔${C.reset} ${m}`)
const warn = (m) => log(`  ${C.yellow}!${C.reset} ${m}`)
const bad = (m) => log(`  ${C.red}✘${C.reset} ${m}`)
const info = (m) => log(`  ${C.dim}·${C.reset} ${m}`)

// ── 子进程(不用管道) ──
let seq = 0
function capture(cmd, args, opts = {}) {
  fs.mkdirSync(TMP, { recursive: true })
  const f = path.join(TMP, `out-${process.pid}-${++seq}.log`)
  const fd = fs.openSync(f, 'w')
  let r
  try {
    r = spawnSync(cmd, args, {
      cwd: opts.cwd || PLUGIN,
      env: { ...process.env, ...(opts.env || {}) },
      stdio: ['ignore', fd, fd],
      timeout: opts.timeout || 300000,
      shell: !!opts.shell,
      windowsHide: true,
    })
  } finally {
    fs.closeSync(fd)
  }
  let out = ''
  try { out = fs.readFileSync(f, 'utf8') } catch { /* 忽略 */ }
  try { fs.rmSync(f, { force: true }) } catch { /* 忽略 */ }
  return { status: r.status, error: r.error, out: out.replace(/\r\n/g, '\n').trim() }
}
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd || PLUGIN,
    env: { ...process.env, ...(opts.env || {}) },
    stdio: 'inherit',
    timeout: opts.timeout || 0,
    shell: !!opts.shell,
    windowsHide: true,
  })
  return { status: r.status }
}

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm'

// token 只从环境变量来。有就写一个临时 .npmrc(本次进程专用),结束删掉。
const TOKEN = process.env.NPM_TOKEN || process.env.DSHM_NPM_TOKEN || ''
let USERCONFIG = null
function setupToken() {
  if (!TOKEN) return
  fs.mkdirSync(TMP, { recursive: true })
  USERCONFIG = path.join(TMP, `.npmrc-${process.pid}`)
  fs.writeFileSync(USERCONFIG, `//registry.npmjs.org/:_authToken=${TOKEN}\n`, { mode: 0o600 })
}
function cleanup() {
  if (USERCONFIG) { try { fs.rmSync(USERCONFIG, { force: true }) } catch { /* 忽略 */ } }
  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch { /* 忽略 */ }
}

function npmArgs(extra = []) {
  const base = [...extra, '--registry', REGISTRY]
  if (USERCONFIG) base.push('--userconfig', USERCONFIG)
  return base
}
/**
 * 直接跑 npm-cli.js,不经过 shell。
 * Windows 上 spawn('npm.cmd', args) 必须 shell:true,而 shell:true + args 数组会触发
 * Node 的 DEP0190 警告 —— 那行 stderr 会让 PowerShell 把「成功」当成失败(报 exit 1)。
 */
function npmInvocationRaw(args) {
  const base = path.dirname(process.execPath)
  const candidates = [
    path.join(base, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(base, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return { cmd: process.execPath, args: [c, ...args], shell: false }
  }
  return { cmd: NPM, args, shell: true }
}
function npmInvocation(extra) {
  return npmInvocationRaw(npmArgs(extra))
}
function npm(extra, opts = {}) {
  const inv = npmInvocation(extra)
  return capture(inv.cmd, inv.args, { ...opts, shell: inv.shell, env: npmCacheEnv() })
}
function npmRun(extra, opts = {}) {
  const inv = npmInvocation(extra)
  return run(inv.cmd, inv.args, { ...opts, shell: inv.shell, env: npmCacheEnv() })
}
function npmCacheEnv() {
  // 有些环境 ~/.npm-cache 不可写,允许用 DSHM_NPM_CACHE 指到工作区内的缓存
  return process.env.DSHM_NPM_CACHE ? { npm_config_cache: process.env.DSHM_NPM_CACHE } : {}
}

function ask(q) {
  if (YES) return true
  if (!process.stdin.isTTY) {
    bad('需要确认,但当前不是交互终端;加 --yes 重跑。')
    return false
  }
  process.stdout.write(`\n${C.yellow}?${C.reset} ${q} [y/N] `)
  const buf = Buffer.alloc(16)
  try {
    const n = fs.readSync(0, buf, 0, 16, null)
    const a = buf.subarray(0, n).toString('utf8').trim().toLowerCase()
    return a === 'y' || a === 'yes'
  } catch { return false }
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/** 读一行输入(仅在 TTY 下调用;终端是行缓冲模式,一次 readSync 就能拿到整行) */
function promptLine(question) {
  process.stdout.write(`\n${C.yellow}?${C.reset} ${question} `)
  const buf = Buffer.alloc(64)
  try {
    const n = fs.readSync(0, buf, 0, 64, null)
    return buf.subarray(0, n).toString('utf8').replace(/[\r\n]/g, '').trim()
  } catch { return '' }
}

// npm 常把 "Unknown user config" 之类的 warn 混进输出,取值前先剔掉这些行
function stripNpmLogs(out) {
  return out.split('\n').filter((l) => l && !/^\s*npm (warn|notice|error)\b/i.test(l)).join('\n')
}
function npmValue(out) {
  const lines = stripNpmLogs(out).split('\n').map((l) => l.trim()).filter(Boolean)
  return lines.length ? lines[lines.length - 1] : ''
}

// npm 的 --json 有时给数组、有时给单个对象(npm pack 现在给对象),两种都要认
function lastJson(out) {
  const iBrace = out.indexOf('{')
  const iBracket = out.indexOf('[')
  const cands = [iBrace, iBracket].filter((i) => i >= 0)
  if (!cands.length) return null
  const i = Math.min(...cands)
  try { return JSON.parse(out.slice(i)) } catch { return null }
}

// ── 事实 ──
const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const pkg = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'package.json'), 'utf8'))
const VERSION = pkg.version
let publishable = true

// ── [1] 预检 ──
function preflight() {
  step(1, `预检 · ${NAME}@${VERSION}`)

  if (pkg.name !== NAME) { bad(`package.json 的 name 是 ${pkg.name},期望 ${NAME}`); publishable = false }
  else ok(`包名 ${NAME}`)

  if (VERSION !== rootPkg.version) {
    bad(`版本与桌面端不一致:插件 ${VERSION} / 桌面端 ${rootPkg.version}(两者必须相同)`)
    publishable = false
  } else ok(`版本与桌面端一致:${VERSION}`)

  // 入口文件
  const entries = [pkg.main, './cordis.patch.yml'].filter(Boolean)
  for (const rel of entries) {
    const p = path.join(PLUGIN, rel.replace(/^\.\//, ''))
    if (!fs.existsSync(p)) { bad(`入口缺失:${rel}`); publishable = false }
  }
  if (pkg.exports) {
    for (const [k, v] of Object.entries(pkg.exports)) {
      const rel = typeof v === 'string' ? v : v && v.default
      if (typeof rel === 'string' && !fs.existsSync(path.join(PLUGIN, rel.replace(/^\.\//, '')))) {
        bad(`exports["${k}"] 指向不存在的文件:${rel}`); publishable = false
      }
    }
  }
  ok('入口与 exports 全部存在')

  // 客户端脚本要成对存在(AGENTS.md 明确 client.js / panel.js 是两份独立实现)
  for (const f of ['lib/index.js', 'lib/client.js', 'lib/panel.js']) {
    if (!fs.existsSync(path.join(PLUGIN, f))) { bad(`缺少 ${f}`); publishable = false }
  }

  // 真正会写进 tarball 的内容
  const pack = npm(['pack', '--dry-run', '--json'], { cwd: PLUGIN })
  const parsed = lastJson(pack.out)
  let packed = null
  if (pack.status !== 0 || !parsed) {
    warn('拿不到打包清单(npm pack --dry-run 失败),跳过内容检查:')
    for (const l of pack.out.split('\n').slice(-3)) info(l.trim())
  } else {
    packed = Array.isArray(parsed) ? parsed[0] : parsed
    const files = (packed.files || []).map((f) => f.path)
    const kb = (n) => `${(n / 1024).toFixed(1)} KB`
    log(`  ${C.dim}·${C.reset} 本次将上传 ${files.length} 个文件,解包 ${kb(packed.unpackedSize || 0)},压缩后 ${kb(packed.size || 0)}`)
    for (const f of (packed.files || []).slice(0, 20)) {
      log(`      ${kb(f.size || 0).padStart(9)}  ${f.path}`)
    }
    if (files.length > 20) log(`      … 共 ${files.length} 个`)

    const mustHave = ['lib/index.js', 'lib/client.js', 'lib/panel.js', 'cordis.patch.yml', 'README.md', 'LICENSE']
    for (const f of mustHave) {
      if (!files.includes(f)) { bad(`打包清单里没有 ${f}`); publishable = false }
    }
    if (files.some((f) => /^(test|tests)\//.test(f) || /\.test\.[cm]?js$/.test(f))) {
      warn('打包清单里带了测试文件(plugin/package.json 的 files 没排除干净)')
    } else ok('清单干净:不含 test/')
    if (files.some((f) => f.startsWith('node_modules/'))) { bad('清单里混进了 node_modules/'); publishable = false }
  }

  // 插件自检
  if (SKIP_TESTS) {
    warn('已按 --skip-tests 跳过插件测试')
  } else {
    const r = capture(process.execPath, ['plugin/test/host.test.js'], { cwd: ROOT })
    if (r.status === 0) ok('插件 host 测试通过')
    else {
      bad('插件 host 测试未通过:')
      for (const l of r.out.split('\n').slice(-12)) info(l)
      publishable = false
    }
  }

  // 桌面端 tag 是否已经打了(仅提示,不阻塞插件发布)
  const tag = `v${VERSION}`
  const t = capture('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`], { cwd: ROOT })
  if (t.status === 0) ok(`桌面端 tag ${tag} 存在`)
  else warn(`本地没有 tag ${tag}(桌面端可能还没发布,插件可以先发)`)
  return packed
}

// ── [2] 认证 ──
// ── [2] 认证:给入口、等人、检测到成功就继续 ──
function checkAuthQuiet() {
  const who = npm(['whoami'])
  return who.status === 0 && !!npmValue(who.out)
}

function printLoginHelp() {
  log('')
  log(`  ${C.yellow}需要登录 npm 才能发布。登录入口:${C.reset}`)
  log(`    ${C.bold}${LOGIN_URL}${C.reset}`)
  log(`  ${C.dim}命令行登录(会给出带一次性 token 的链接,凭据写进 ~/.npmrc):${C.reset}`)
  log(`    npm login --auth-type=web --registry ${REGISTRY}`)
  log(`  ${C.dim}或者只用一次(不落盘):${C.reset}`)
  log(`    $env:NPM_TOKEN="npm_有写权限的token"`)
}

/** 轮询 npm whoami 直到登录成功(也覆盖用户在别的终端/浏览器里完成登录的情况) */
function waitForLogin() {
  if (WAIT_SEC <= 0) return false
  log('')
  info(`等待登录完成(最多 ${WAIT_SEC}s);检测到已登录会自动继续,Ctrl+C 可取消`)
  const started = Date.now()
  let waited = 0
  while (Date.now() - started < WAIT_SEC * 1000) {
    if (checkAuthQuiet()) {
      log('')
      ok(`检测到登录成功:${npmValue(npm(['whoami']).out)}`)
      return true
    }
    process.stdout.write(`\r  ${C.dim}·${C.reset} 等待登录… ${waited}s / ${WAIT_SEC}s   `)
    sleep(5000)
    waited += 5
  }
  log('')
  return false
}

function ensureAuth() {
  step(2, '认证')
  const who = npm(['whoami'])
  if (who.status === 0 && who.out) {
    ok(`已登录:${npmValue(who.out)}`)
    return true
  }

  bad('当前没有可用的 npm 发布凭据')
  const first = (who.out.split('\n').find((l) => /error/i.test(l)) || '').trim()
  if (first) info(first.slice(0, 120))
  printLoginHelp()

  if (NO_LOGIN) return false

  // 有终端就直接进 npm 官方登录流程:它会开浏览器/打印带 token 的链接并阻塞等待,
  // 和用户手动执行完全一样,凭据写进 ~/.npmrc。
  if (process.stdin.isTTY) {
    log('')
    info('启动 npm 登录流程(浏览器里完成后这里会自动继续)…')
    const inv = npmInvocationRaw(['login', '--auth-type=web', '--registry', REGISTRY])
    run(inv.cmd, inv.args, { shell: inv.shell, cwd: PLUGIN })
    if (USERCONFIG) USERCONFIG = null // 登录写的是 ~/.npmrc,临时 token 不要再用了
    if (checkAuthQuiet()) {
      ok(`登录成功:${npmValue(npm(['whoami']).out)}`)
      return true
    }
  }

  if (waitForLogin()) {
    if (USERCONFIG) USERCONFIG = null
    return true
  }
  bad(`等了 ${WAIT_SEC}s 仍未检测到登录`)
  printLoginHelp()
  return false
}

// ── [3] 冲突 ──
function checkConflict() {
  step(3, '冲突检查')
  const v = npm(['view', `${NAME}@${VERSION}`, 'version'], { timeout: 120000 })
  if (v.status === 0 && /^\d+\.\d+\.\d+/.test(npmValue(v.out))) {
    bad(`registry 上已经存在 ${NAME}@${VERSION},npm 不允许覆盖已发布版本`)
    info('把 plugin/package.json 与根 package.json 一起升版本后重跑;已发布版本永远不能再发。')
    return { ok: false, code: 1 }
  }
  if (v.status !== 0 && !/E404|not found/i.test(v.out)) {
    warn(`查不到远端版本(可能是网络或权限),继续但可能发布时撞车:${v.out.split('\n')[0].slice(0, 100)}`)
  }

  const latest = npm(['view', NAME, 'dist-tags.latest'], { timeout: 120000 })
  const cur = latest.status === 0 ? npmValue(latest.out) : ''
  if (cur) {
    ok(`registry 当前 latest = ${cur},本次将发布 ${VERSION}`)
    const cmp = (a, b) => {
      const pa = a.split('.').map(Number), pb = b.split('.').map(Number)
      for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0)
      return 0
    }
    if (cmp(VERSION, cur) <= 0) {
      warn(`本次版本 ${VERSION} 不比线上 ${cur} 新,npm 会拒绝(或需要 --tag 发到非 latest 分支)`)
    } else if (VERSION.split('.')[1] !== cur.split('.')[1]) {
      // 小的次要版本:提示跳过了哪些
      const skipped = []
      for (let m = Number(cur.split('.')[1]) + 1; m < Number(VERSION.split('.')[1]); m++) {
        skipped.push(`${VERSION.split('.')[0]}.${m}.0`)
      }
      if (skipped.length) info(`中间的次要版本没有发布过(线上是 ${cur}),跳过:${skipped.join(', ')}`)
    }
  }
  return { ok: true }
}

// ── [4] 发布 ──
function doPublish() {
  step(4, '发布到 npm')
  if (!ask(`发布 ${NAME}@${VERSION} 到 npm(public)?`)) return { ok: false, code: 2 }

  const extra = ['publish', '--access', 'public']
  if (OTP) extra.push('--otp', OTP)
  info(`npm ${extra.join(' ')}`)

  // 发布输出整体捕获到结束再抖出来:npm publish 的报错信息很短,
  // 但需要原文才能分类(E401/E403/EOTP),不能只拿 exit code。
  const r = npm(extra, { timeout: 900000 })
  for (const l of r.out.split('\n').slice(-20)) if (l.trim()) info(l.trim())

  if (r.status === 0) { ok(`已发布 ${NAME}@${VERSION}`); return { ok: true } }
  bad('npm publish 失败')

  // 二重验证不是终点:按 npm 自己的做法继续,而不是让用户换个命令重来
  if (isOtpError(r.out)) {
    if (solveOtp()) { ok(`已发布 ${NAME}@${VERSION}`); return { ok: true } }
  }
  return { ok: false, code: 2, out: r.out }
}

function isOtpError(out) {
  return /EOTP|one-time password|two-factor/i.test(out)
}

/**
 * 处理二重验证,尽量和手动发布一致:
 *   1) 先走 npm 的浏览器验证(--auth-type=web):npm 会打印验证链接并阻塞等待
 *   2) 不行再退回输入 6 位验证码(--otp)
 */
function solveOtp() {
  if (!process.stdin.isTTY) {
    info('当前不是交互终端,无法走验证界面')
    info(`请带上一次性密码重跑:node scripts/publish-plugin.js --otp=<6位数字>`)
    return false
  }

  log('')
  info('该账号需要二重验证。打开 npm 的验证方式(给出链接,完成后自动继续)…')
  const inv = npmInvocation(['publish', '--access', 'public', '--auth-type=web'])
  const webRun = run(inv.cmd, inv.args, { shell: inv.shell, cwd: PLUGIN })
  if (webRun.status === 0) return true

  log('')
  const code = promptLine('浏览器验证没走通。输入认证器里的 6 位验证码(直接回车放弃):')
  if (!/^\d{6,8}$/.test(code)) return false
  const r = npm(['publish', '--access', 'public', '--otp', code], { timeout: 900000 })
  for (const l of r.out.split('\n').slice(-12)) if (l.trim()) info(l.trim())
  return r.status === 0
}

function classifyPublishFailure(out) {
  if (/EOTP|one-time password/i.test(out)) {
    info('二重验证没有完成:确认浏览器里已确认授权,或改用 --otp=<6位数字> 重跑')
    return true
  }
  if (/E401|Unauthorized|ENEEDAUTH/i.test(out)) {
    info('凭据仍无效 —— 见上面「认证」一节的 A/B 两种做法')
    return true
  }
  if (/E403|forbidden|cannot publish over|previously published/i.test(out)) {
    info('无权限或版本已存在:确认 token 属于有该包发布权的账号;版本冲突则升版本号')
    return true
  }
  if (/E402|payment|billing/i.test(out)) {
    info('需要付费账户或未验证邮箱,去 npmjs.com 处理后再发')
    return true
  }
  return false
}

// ── [5] 发布后校验 ──
function verifyPublished(packed) {
  step(5, '校验线上包')
  const deadline = Date.now() + 60000
  let meta = null
  let waited = 0
  while (Date.now() < deadline) {
    const r = npm(['view', `${NAME}@${VERSION}`, 'version', 'dist.integrity', 'dist.tarball',
      'dist.fileCount', 'dist.unpackedSize', '--json'], { timeout: 120000 })
    if (r.status === 0) {
      const clean = stripNpmLogs(r.out)
      const i = clean.indexOf('{')
      if (i >= 0) {
        try {
          const j = JSON.parse(clean.slice(i))
          if (j.version || j['dist.integrity']) { meta = j; break }
        } catch { /* 继续等 */ }
      }
    }
    process.stdout.write(`\r  ${C.dim}·${C.reset} 等待 registry 生效… (${waited}s)   `)
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000)
    waited += 5
  }
  log('')

  if (!meta) {
    warn('registry 一分钟内没查到该版本(可能只是缓存延迟);稍后用 npm view 复核')
    return { ok: true, soft: true }
  }
  ok(`线上已可查:${NAME}@${meta.version || VERSION}`)
  if (meta['dist.integrity']) info(`integrity ${meta['dist.integrity']}`)
  if (meta['dist.tarball']) info(`tarball   ${meta['dist.tarball']}`)
  if (meta['dist.fileCount'] !== undefined && packed && packed.entryCount !== undefined) {
    info(`文件数 线上 ${meta['dist.fileCount']} / 本地 ${packed.entryCount}` +
      (Number(meta['dist.fileCount']) === Number(packed.entryCount) ? '(一致)' : '(不一致,请人工核对)'))
  }
  const latest = npm(['view', NAME, 'dist-tags.latest'], { timeout: 120000 })
  if (latest.status === 0) {
    const l = npmValue(latest.out)
    if (l === VERSION) ok(`dist-tags.latest 已指向 ${VERSION}`)
    else warn(`dist-tags.latest 仍指向 ${l}(用了非 latest 标签时会这样)`)
  }
  return { ok: true }
}

// ── 主流程 ──
function main() {
  log(`${C.bold}npm 插件发布${C.reset}  ${C.dim}${NAME}@${VERSION} · ${REGISTRY}${C.reset}`)
  const flags = [DRY && 'dry-run', YES && 'yes', OTP && 'otp', NO_LOGIN && 'no-login'].filter(Boolean)
  if (flags.length) log(`${C.dim}flags: ${flags.join(' ')}${C.reset}`)
  if (TOKEN) info('已从环境变量读到 token(不回显,只写本次临时 .npmrc)')
  setupToken()

  const packed = preflight()
  if (!publishable) {
    log('')
    bad('预检未通过,没有发布任何东西。')
    process.exitCode = 1
    return
  }

  if (DRY) {
    step(2, '认证')
    const who = npm(['whoami'])
    if (who.status === 0) ok(`已登录:${npmValue(who.out)}(干跑不发布)`)
    else { warn('当前没有可用的 npm 写权限(干跑不阻塞、不登录)'); printLoginHelp() }
    step(3, '冲突检查')
    const c = checkConflictDry()
    log(`\n${C.green}${C.bold}干跑通过${C.reset}  将要发布 ${NAME}@${VERSION}`)
    log(`  ${C.dim}确认无误后执行:node scripts/publish-plugin.js${C.reset}`)
    process.exitCode = c ? 0 : 1
    return
  }

  // 认证:未登录时给入口并等登录成功(而不是直接失败退出)
  if (!ensureAuth()) {
    log(`\n  ${C.yellow}没有完成登录,停在这里,没有发布任何东西。${C.reset}`)
    info('补好凭据后重跑:node scripts/publish-plugin.js')
    process.exitCode = 2
    return
  }

  const conflict = checkConflict()
  if (!conflict.ok) { process.exitCode = conflict.code || 1; return }


  const pub = doPublish()
  if (!pub.ok) {
    if (pub.out) {
      for (const l of pub.out.split('\n').slice(-15)) info(l)
      const human = classifyPublishFailure(pub.out)
      if (!human) info('未识别的错误:把上面的输出发出来')
    }
    process.exitCode = pub.code || 1
    return
  }

  const v = verifyPublished(packed)
  log(`\n  ${C.green}${C.bold}npm 发布完成${C.reset}  https://www.npmjs.com/package/${NAME}/v/${VERSION}`)
  log(`  ${C.dim}用户安装:dsh plugin add ${NAME}${C.reset}`)
  if (v.soft) warn('校验只是延后确认,不代表没发成功。')
}

function checkAuthQuiet() {
  const who = npm(['whoami'])
  return who.status === 0 && !!who.out
}

function checkConflictDry() {
  const v = npm(['view', `${NAME}@${VERSION}`, 'version'], { timeout: 120000 })
  const exists = v.status === 0 && /^\d+\.\d+\.\d+/.test(npmValue(v.out))
  if (exists) { bad(`${NAME}@${VERSION} 已经发布过(不能再发同名同版本)`); return false }
  ok(`${VERSION} 尚未发布`)
  const latest = npm(['view', NAME, 'dist-tags.latest'], { timeout: 120000 })
  const cur = latest.status === 0 ? npmValue(latest.out) : ''
  if (cur) info(`registry 当前 latest = ${cur}`)
  return true
}

try {
  main()
} finally {
  cleanup()
}
