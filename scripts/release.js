'use strict'
/**
 * 一键发布:体检 → 测试 → 提交 → 打 tag → 推送 → 等 CI 构建 → 校验线上包 → 同步产物 → npm 插件
 *
 * 用法:
 *   node scripts/release.js                  # 交互确认后完整发布
 *   node scripts/release.js --dry-run        # 只体检 + 跑测试,不改任何东西
 *   node scripts/release.js --yes            # 不询问(非交互/CI 用)
 *   node scripts/release.js --from=ci        # 从某一步续跑(任务中断后用)
 *   node scripts/release.js --skip-tests     # 跳过测试(仅紧急时)
 *   node scripts/release.js --no-npm         # 不发布 npm 插件
 *   node scripts/release.js --no-wait        # 推完 tag 就走,不等 CI
 *
 * 步骤(preflight→…→npm),每步都是幂等的,失败后可用 --from=<step> 续跑。
 *
 * 退出码:0 成功;1 失败;2 体检/测试未通过(没有产生任何副作用)。
 *
 * 设计说明:
 *  - 子进程一律用 stdio:'ignore'/'inherit' 或重定向到临时文件,不用管道
 *    —— 受限沙箱里 piped stdio 会 EPERM,重定向文件两种环境都能跑。
 *  - git 推送遇到 schannel/TLS 凭据错误时自动用 openssl 后端重试。
 *  - npm 发布需要 write token;当前 ~/.npmrc 里的 token 是只读的(E401),
 *    脚本会把确切的补发命令打出来而不是留一个红叉。
 */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const TMP = path.join(ROOT, '.tmp-release')
const REPO = 'sss-1012/DeepSeek-Harness-Manager'
const WORKFLOW = 'release.yml'
const ARCHIVE_ROOT = process.env.DSH_MANAGER_RELEASES_DIR || path.resolve(ROOT, '..', 'DSH-Manager-Releases')

// ─────────────────────────── 命令行参数 ───────────────────────────
const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const opt = (name, dflt = null) => {
  const eq = argv.find((a) => a.startsWith(`--${name}=`))
  if (eq) return eq.slice(name.length + 3)
  const i = argv.indexOf(`--${name}`)
  if (i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1]
  return dflt
}

const DRY_RUN = flag('dry-run')
const YES = flag('yes') || flag('y')
const SKIP_TESTS = flag('skip-tests')
const NO_NPM = flag('no-npm')
const NO_WAIT = flag('no-wait')
const RETAG = flag('retag')
const ALLOW_DIRTY = flag('allow-dirty')
const FROM = opt('from')
const CI_TIMEOUT_MIN = Number(opt('timeout', '30')) || 30

// ─────────────────────────── 小工具 ───────────────────────────
const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
}
const log = (...a) => console.log(...a)
const step = (n, title) => log(`\n${C.cyan}${C.bold}[${n}] ${title}${C.reset}`)
const ok = (m) => log(`  ${C.green}✔${C.reset} ${m}`)
const warn = (m) => log(`  ${C.yellow}!${C.reset} ${m}`)
const bad = (m) => log(`  ${C.red}✘${C.reset} ${m}`)
const info = (m) => log(`  ${C.dim}·${C.reset} ${m}`)

let tmpSeq = 0
/** 捕获子进程输出(不用管道:写临时文件再读) */
function capture(cmd, args, opts = {}) {
  fs.mkdirSync(TMP, { recursive: true })
  const file = path.join(TMP, `out-${process.pid}-${++tmpSeq}.log`)
  const fd = fs.openSync(file, 'w')
  let r
  try {
    r = spawnSync(cmd, args, {
      cwd: opts.cwd || ROOT,
      env: { ...process.env, ...(opts.env || {}) },
      stdio: ['ignore', fd, fd],
      timeout: opts.timeout || 0,
      shell: !!opts.shell,
      windowsHide: true,
    })
  } finally {
    fs.closeSync(fd)
  }
  let out = ''
  try { out = fs.readFileSync(file, 'utf8') } catch { /* 忽略 */ }
  try { fs.rmSync(file, { force: true }) } catch { /* 忽略 */ }
  return { status: r.status, signal: r.signal, error: r.error, out: out.replace(/\r\n/g, '\n').trim() }
}

/** 直通子进程输出(继承终端) */
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd || ROOT,
    env: { ...process.env, ...(opts.env || {}) },
    stdio: 'inherit',
    timeout: opts.timeout || 0,
    shell: !!opts.shell,
    windowsHide: true,
  })
  return { status: r.status, signal: r.signal, error: r.error }
}

// npm 相关发布逻辑统一在 scripts/publish-plugin.js 里,这里只调它
// (同一个实现两处维护,迟早会不一致;上一步的插件发布就是这样丢过一次)
const git = (args, opts = {}) => capture('git', args, opts)

/**
 * 需要联网的 git 操作(ls-remote / push)。
 * 本机到 github.com:443 会间歇性被重置("Recv failure: Connection was reset",
 * DNS 指到代理的 fake-IP 段),单次失败不代表真的不可达,所以重试 3 次;
 * 同时总是用 openssl 后端 —— ~/.gitconfig 里的 schannel 在部分环境下
 * 会 AcquireCredentialsHandle / 凭据管道失败。
 */
function gitNet(args, opts = {}) {
  const tries = 3
  let last = null
  for (let i = 1; i <= tries; i++) {
    const r = git(['-c', 'http.sslBackend=openssl', ...args], opts)
    if (r.status === 0) return r
    last = r
    const first = (r.out.split('\n').find(Boolean) || '').slice(0, 100)
    if (i < tries) {
      warn(`联网 git 失败(${i}/${tries}),${i * 3}s 后重试:${first}`)
      sleep(i * 3000)
    }
  }
  return last
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

function sha256(file) {
  const h = crypto.createHash('sha256')
  const fd = fs.openSync(file, 'r')
  try {
    const buf = Buffer.alloc(1 << 20)
    let n
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n))
  } finally {
    fs.closeSync(fd)
  }
  return h.digest('hex')
}

function ask(question) {
  if (YES) return true
  if (!process.stdin.isTTY) {
    bad('需要确认,但当前不是交互终端;确认无误请加 --yes 重跑。')
    return false
  }
  process.stdout.write(`\n${C.yellow}?${C.reset} ${question} [y/N] `)
  const buf = Buffer.alloc(16)
  let n = 0
  try {
    n = fs.readSync(0, buf, 0, 16, null)
  } catch {
    return false
  }
  const a = buf.subarray(0, n).toString('utf8').trim().toLowerCase()
  return a === 'y' || a === 'yes'
}

// ─────────────────────────── 项目事实 ───────────────────────────
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const pluginPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin', 'package.json'), 'utf8'))
const VERSION = pkg.version
const TAG = `v${VERSION}`
const ARTIFACTS = [
  `DeepSeek-Harness-Manager-${VERSION}-setup.exe`,
  `DeepSeek-Harness-Manager-${VERSION}-portable.exe`,
]

// ─────────────────────────── 步骤实现 ───────────────────────────
const STEPS = {}

STEPS.preflight = () => {
  step(1, `体检 · ${TAG}`)
  const problems = []
  const notes = []

  // 版本一致性
  if (pluginPkg.version !== VERSION) {
    problems.push(`plugin/package.json 版本 ${pluginPkg.version} ≠ 根 ${VERSION}`)
  } else ok(`版本一致:${VERSION}(桌面端 / npm 插件)`)

  // 发布说明
  const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8')
  if (!new RegExp(`^#{2,3} .*?${VERSION.replace(/\./g, '\\.')}`, 'm').test(changelog)) {
    problems.push(`CHANGELOG.md 没有 ${VERSION} 的段落`)
  } else ok(`CHANGELOG.md 含 ${VERSION} 段落`)

  const notesPath = path.join(ROOT, 'RELEASE_NOTES.md')
  const notesText = fs.existsSync(notesPath) ? fs.readFileSync(notesPath, 'utf8') : ''
  if (!notesText.includes(VERSION)) problems.push(`RELEASE_NOTES.md 没有提到 ${VERSION}`)
  else ok(`RELEASE_NOTES.md 提到 ${VERSION}`)

  // tag 唯一性
  const localTag = git(['rev-parse', '--verify', '--quiet', `refs/tags/${TAG}`])
  const remoteTags = gitNet(['ls-remote', '--tags', 'origin', `refs/tags/${TAG}`])
  const remoteHasTag = remoteTags.status === 0 && /refs\/tags\//.test(remoteTags.out)
  if (localTag.status === 0 && !RETAG) problems.push(`本地已存在 tag ${TAG}(确认要重打请加 --retag)`)
  else if (remoteHasTag && !RETAG) problems.push(`远端已存在 tag ${TAG}(已发布过?)`)
  else if (localTag.status !== 0) ok(`tag ${TAG} 尚未存在`)

  // 工作区
  const st = git(['status', '--porcelain'])
  const dirty = st.out.split('\n').filter(Boolean)
  if (dirty.length && !ALLOW_DIRTY) {
    notes.push(`工作区有 ${dirty.length} 个未提交改动,将在 commit 步骤提交`)
  } else if (!dirty.length) ok('工作区干净')

  // 分支
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).out
  if (branch !== 'main') warn(`当前分支是 ${branch} 而不是 main`)
  else ok('在 main 分支上')

  // 远端可达 & 领先提交
  const lsRemote = gitNet(['ls-remote', 'origin', 'refs/heads/main'])
  if (lsRemote.status !== 0) {
    problems.push(`无法访问远端(检查网络/凭据):${lsRemote.out.split('\n')[0] || 'git ls-remote 失败'}`)
  } else {
    const remoteSha = (lsRemote.out.match(/^([0-9a-f]{40})/) || [])[1] || ''
    const ahead = git(['rev-list', '--count', `origin/main..HEAD`])
    const n = Number(ahead.out) || 0
    if (remoteSha) info(`origin/main = ${remoteSha.slice(0, 7)};本地领先 ${n} 个提交`)
  }

  // 构建产物(本地已有的才算;CI 会自己构建)
  const distDir = path.join(ROOT, 'dist')
  const missing = ARTIFACTS.filter((f) => !fs.existsSync(path.join(distDir, f)))
  if (missing.length) {
    warn(`本地 dist 缺产物(${missing.length}/2):CI 会重新构建,但本地留档需要它们`)
  } else {
    for (const f of ARTIFACTS) {
      const p = path.join(distDir, f)
      info(`${f}  ${(fs.statSync(p).size / 1048576).toFixed(1)} MB`)
    }
  }

  // 打包产物自检:这两个 bug 曾经把"能装上但打不开"发出去过
  const asar = path.join(distDir, 'win-unpacked', 'resources', 'app.asar')
  if (fs.existsSync(asar)) {
    const text = fs.readFileSync(asar, 'utf8')
    const tImport = text.split(`const { t } = require('./src/i18n')`).length - 1
    if (tImport === 1) ok('app.asar:main.js 的 t 绑定恰好 1 处(渲染层没有混进来)')
    else problems.push(`app.asar 里 "const { t } = require('./src/i18n')" 出现 ${tImport} 次(应为 1 次,否则渲染层会 ReferenceError)`)
    if (text.includes('i18n-en.json')) ok('app.asar:含英文词典')
    else problems.push('app.asar 里找不到 i18n-en.json')
    if (text.includes('renderer/i18n.js') || text.includes('i18n.js')) ok('app.asar:含渲染层 i18n 脚本')
  } else {
    warn('没有 dist/win-unpacked,跳过打包产物自检(CI 会构建)')
  }

  // 渲染层不许出现 require(browser 里必然炸)
  const rendererDir = path.join(ROOT, 'renderer')
  for (const f of fs.readdirSync(rendererDir).filter((x) => x.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(rendererDir, f), 'utf8')
    if (/\brequire\s*\(/.test(src)) problems.push(`renderer/${f} 里出现 require(会 ReferenceError,整个 UI 冻结)`)
  }

  // 归档目录
  if (fs.existsSync(ARCHIVE_ROOT)) ok(`归档根目录存在:${ARCHIVE_ROOT}`)
  else warn(`归档根目录不存在,将在 sync 步骤创建:${ARCHIVE_ROOT}`)

  for (const n of notes) info(n)

  if (problems.length) {
    log('')
    for (const p of problems) bad(p)
    return { ok: false, fatal: true, code: 2 }
  }
  ok('体检通过')
  return { ok: true }
}

STEPS.test = () => {
  step(2, '回归测试')
  if (SKIP_TESTS) {
    warn('已按 --skip-tests 跳过(不建议:上一次发布的 UI 冻结就是测试缺失放过去的)')
    return { ok: true }
  }
  const suites = [
    { name: 'smoke(含 i18n 断言)', cmd: [process.execPath, ['scripts/smoke.js']] },
    { name: 'compat-repair(隔离 DSH_HOME)', cmd: [process.execPath, ['scripts/compat-repair-test.js']] },
    { name: 'plugin host 测试', cmd: [process.execPath, ['plugin/test/host.test.js']] },
    { name: 'i18n 覆盖闸门 --strict', cmd: [process.execPath, ['scripts/i18n-extract.js']] },
    { name: 'i18n 接线闸门 --strict', cmd: [process.execPath, ['scripts/i18n-check.js', '--strict']] },
    { name: '文档检查 --offline', cmd: [process.execPath, ['scripts/check-docs.js', '--offline']] },
  ]
  const failed = []
  for (const s of suites) {
    process.stdout.write(`  ${C.dim}·${C.reset} ${s.name} … `)
    const r = capture(s.cmd[0], s.cmd[1], { timeout: 300000 })
    if (r.status === 0) {
      log(`${C.green}通过${C.reset}`)
    } else {
      log(`${C.red}失败${C.reset}`)
      log(r.out.split('\n').slice(-25).map((l) => `      ${l}`).join('\n'))
      failed.push(s.name)
    }
  }
  if (failed.length) {
    bad(`测试未通过:${failed.join('、')}`)
    return { ok: false, fatal: true, code: 2 }
  }
  ok('全部测试通过')
  return { ok: true }
}

STEPS.commit = () => {
  step(3, '提交工作区改动')
  const st = git(['status', '--porcelain'])
  const dirty = st.out.split('\n').filter(Boolean)
  if (!dirty.length) {
    ok('没有需要提交的改动')
    return { ok: true }
  }
  for (const l of dirty.slice(0, 20)) info(l)
  if (dirty.length > 20) info(`… 共 ${dirty.length} 项`)

  if (DRY_RUN) { warn('--dry-run:不提交'); return { ok: true } }
  if (!ask(`提交这 ${dirty.length} 项改动并随 ${TAG} 一起发布?`)) return { ok: false, fatal: true, code: 1 }

  const add = git(['add', '-A'])
  if (add.status !== 0) { bad(`git add 失败:${add.out}`); return { ok: false, fatal: true, code: 1 } }
  const msg = opt('message') || `release: ${TAG}`
  const c = git(['commit', '-m', msg])
  if (c.status !== 0) { bad(`git commit 失败:${c.out}`); return { ok: false, fatal: true, code: 1 } }
  ok(`已提交:${msg}`)
  return { ok: true }
}

STEPS.tag = () => {
  step(4, `打 tag ${TAG}`)
  const exists = git(['rev-parse', '--verify', '--quiet', `refs/tags/${TAG}`])
  if (exists.status === 0) {
    if (!RETAG) { warn(`tag ${TAG} 已存在,跳过(要重打加 --retag)`); return { ok: true } }
    if (DRY_RUN) { warn('--dry-run:不重打 tag'); return { ok: true } }
    git(['tag', '-d', TAG])
    info(`已删除本地 tag ${TAG}`)
  }
  if (DRY_RUN) { warn(`--dry-run:将创建 tag ${TAG}`); return { ok: true } }
  const firstLine = fs.readFileSync(path.join(ROOT, 'RELEASE_NOTES.md'), 'utf8')
    .split('\n').find((l) => l.trim() && l.includes(VERSION)) || `DeepSeek Harness Manager ${TAG}`
  const cleanMsg = `DeepSeek Harness Manager ${TAG}\n\n${firstLine.replace(/^[#\s]+/, '').trim()}`
  const r = git(['tag', '-a', TAG, '-m', cleanMsg])
  if (r.status !== 0) { bad(`git tag 失败:${r.out}`); return { ok: false, fatal: true, code: 1 } }
  ok(`已创建 tag ${TAG}`)
  return { ok: true }
}

STEPS.push = () => {
  step(5, '推送到 GitHub')
  if (DRY_RUN) { warn('--dry-run:将 push main + tag'); return { ok: true } }
  if (!ask(`把 main 与 ${TAG} 推送到 origin(这会触发 CI 构建并挂 Release)?`)) {
    return { ok: false, fatal: true, code: 1 }
  }

  const push = (refs) => gitNet(['push', 'origin', ...refs], { timeout: 180000 })

  const b = push(['main'])
  if (b.status !== 0) { bad(`push main 失败:\n${b.out}`); return { ok: false, fatal: true, code: 1 } }
  ok('main 已推送')

  const t = push([TAG])
  if (t.status !== 0) { bad(`push tag 失败:\n${t.out}`); return { ok: false, fatal: true, code: 1 } }
  ok(`tag ${TAG} 已推送(CI 开始构建)`)
  return { ok: true }
}

/** Release 上真正给用户下载的那几个文件(含 sha256 digest) */
function releaseAssets(tag) {
  const r = capture('gh', ['release', 'view', tag, '--repo', REPO, '--json', 'assets'], { timeout: 120000 })
  if (r.status !== 0) return []
  try {
    return (JSON.parse(r.out).assets || []).map((a) => ({
      name: a.name, size: a.size || 0, digest: a.digest || '',
    }))
  } catch { return [] }
}

function findRun(tag, sinceMs) {
  const r = capture('gh', [
    'run', 'list', '--workflow', WORKFLOW, '--repo', REPO, '--limit', '10',
    '--json', 'databaseId,headBranch,event,status,conclusion,createdAt,displayTitle,url',
  ], { timeout: 60000 })
  if (r.status !== 0) return { error: r.out }
  let runs = []
  try { runs = JSON.parse(r.out) } catch { return { error: 'gh run list 输出无法解析' } }
  const byTag = runs.find((x) => x.headBranch === tag || x.headBranch === `refs/tags/${tag}`)
  if (byTag) return { run: byTag }
  const since = new Date(sinceMs - 60000).toISOString()
  const fresh = runs.filter((x) => x.createdAt >= since).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  return { run: fresh[0] || null }
}

STEPS.ci = () => {
  step(6, '等待 CI 构建')
  if (DRY_RUN) { warn('--dry-run:不等待'); return { ok: true } }
  if (NO_WAIT) { warn('已按 --no-wait 跳过;之后可手动跑 node scripts/release.js --from=sync'); return { ok: true } }

  const since = Date.now()
  const deadline = since + CI_TIMEOUT_MIN * 60000
  let run = null
  let waited = 0
  while (Date.now() < deadline) {
    const found = findRun(TAG, since)
    if (found.error) {
      warn(`查询运行状态失败:${found.error.split('\n')[0]}`)
    } else if (found.run) {
      run = found.run
      const st = run.status
      process.stdout.write(`\r  ${C.dim}·${C.reset} ${run.displayTitle?.slice(0, 40) || run.databaseId}  ${st}   (${waited}s)   `)
      if (st === 'completed') break
    } else {
      process.stdout.write(`\r  ${C.dim}·${C.reset} 等待工作流出现… (${waited}s)   `)
    }
    sleep(10000)
    waited += 10
  }
  log('')

  if (!run) { bad(`等不到工作流运行(${CI_TIMEOUT_MIN} 分钟);用 gh run list 手工确认`); return { ok: false, fatal: true, code: 1 } }
  if (run.conclusion !== 'success') {
    bad(`CI 结果:${run.conclusion}`)
    info(`日志:gh run view ${run.databaseId} --log-failed`)
    info(run.url || '')
    return { ok: false, fatal: true, code: 1 }
  }
  ok(`CI 构建成功:${run.url || run.databaseId}`)

  const rel = capture('gh', ['release', 'view', TAG, '--repo', REPO, '--json', 'assets,tagName,url'])
  if (rel.status === 0) {
    try {
      const j = JSON.parse(rel.out)
      for (const a of j.assets || []) info(`${a.name}  ${((a.size || 0) / 1048576).toFixed(1)} MB`)
      info(`Release:${j.url}`)
    } catch { /* 忽略 */ }
  }
  return { ok: true }
}

STEPS.verify = () => {
  step(7, '校验线上的发布包')
  if (DRY_RUN) { warn('--dry-run:不下载校验'); return { ok: true } }
  const r = capture(process.execPath, ['scripts/verify-artifact.js', '--release', TAG], { timeout: 900000 })
  if (r.status === 0) {
    for (const l of r.out.split('\n')) info(l.trim())
    ok('线上发布包校验通过')
    return { ok: true }
  }
  if (r.status === 2) {
    warn('无法拿到发布包做校验(网络/7za 不可用),已跳过:')
    for (const l of r.out.split('\n').slice(0, 3)) info(l.trim())
    return { ok: true, nonFatal: true, reason: 'verify-skip' }
  }
  bad('线上发布包校验失败:')
  for (const l of r.out.split('\n')) info(l.trim())
  info('先别宣传这次发布;修好后打新版本号重发(不要改已发布的 tag)')
  return { ok: false, fatal: true, code: 1 }
}

STEPS.sync = () => {
  step(8, '同步 CI 产物到本地归档')
  if (DRY_RUN) { warn('--dry-run:不同步'); return { ok: true } }
  const hasLocal = ARTIFACTS.every((f) => fs.existsSync(path.join(ROOT, 'dist', f)))
  if (hasLocal) {
    info('本地 dist 已有本次产物(本地构建的那一份),优先用本地留档')
    const r = run(process.execPath, ['scripts/archive-build.js'])
    if (r.status !== 0) warn('本地归档失败(不影响线上发布)')
    else ok(`已归档到 ${path.join(ARCHIVE_ROOT, TAG)}`)
  }
  const r = run(process.execPath, ['scripts/sync-releases.js', '--only', TAG])
  if (r.status !== 0) {
    warn('从 GitHub Releases 补齐产物失败(可稍后单独跑 npm run sync-releases)')
    return { ok: true }
  }
  ok('GitHub Releases 产物已同步到本地归档')
  return { ok: true }
}

STEPS.npm = () => {
  step(9, '发布 npm 插件 dsh-harness-manager')
  if (NO_NPM) { warn('已按 --no-npm 跳过'); return { ok: true } }
  if (DRY_RUN) { warn('--dry-run:不发布 npm'); return { ok: true } }

  // 交给专门的半自动脚本:它会做预检、包内容展示、冲突检查、发布和线上校验,
  // 并在「需要人登录」时以 exit 2 停下,而不是假装成功。
  const r = run(process.execPath, ['scripts/publish-plugin.js', '--yes'])
  if (r.status === 0) { ok('npm 插件已发布并校验'); return { ok: true } }
  if (r.status === 2) {
    warn('npm 插件停在一个只能人工完成的步骤(登录/token),见上方命令')
    info('桌面端发布不受影响;补完凭据后跑:node scripts/release.js --from=npm')
    return { ok: false, nonFatal: true, reason: 'npm 需人工登录' }
  }
  bad('npm 插件发布失败(详见上方输出)')
  return { ok: false, nonFatal: true, reason: 'npm-publish' }
}

// ─────────────────────────── 主流程 ───────────────────────────
function banner() {
  log(`${C.bold}DeepSeek Harness Manager 发布${C.reset}  ${C.dim}${TAG}${C.reset}`)
  const flags = [
    DRY_RUN && 'dry-run', YES && 'yes', SKIP_TESTS && 'skip-tests',
    NO_NPM && 'no-npm', NO_WAIT && 'no-wait', RETAG && 'retag', FROM && `from=${FROM}`,
  ].filter(Boolean)
  if (flags.length) log(`${C.dim}flags: ${flags.join(' ')}${C.reset}`)
}

function main() {
  banner()
  fs.mkdirSync(TMP, { recursive: true })

  const order = ['preflight', 'test', 'commit', 'tag', 'push', 'ci', 'verify', 'sync', 'npm']
  let start = 0
  if (FROM) {
    const i = order.indexOf(FROM)
    if (i < 0) { bad(`未知步骤 --from=${FROM};可选:${order.join(', ')}`); process.exitCode = 1; return }
    start = i
    info(`从步骤 ${FROM} 续跑(跳过前 ${i} 步)`)
  }

  const started = Date.now()
  const results = []
  for (let i = start; i < order.length; i++) {
    const name = order[i]
    let r
    try {
      r = STEPS[name]()
    } catch (e) {
      bad(`${name} 抛异常:${e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : e}`)
      r = { ok: false, fatal: true, code: 1 }
    }
    results.push({ name, ...r })
    if (r.fatal) break
  }

  // ── 汇总 ──
  log(`\n${C.bold}──────────── 发布结果 ────────────${C.reset}`)
  for (const r of results) {
    const mark = r.fatal ? `${C.red}✘` : r.ok && !r.nonFatal ? `${C.green}✔` : `${C.yellow}!`
    log(`  ${mark}${C.reset} ${r.name.padEnd(10)} ${r.fatal || r.nonFatal ? (r.reason || '失败') : 'ok'}`)
  }
  log(`  ${C.dim}耗时 ${((Date.now() - started) / 1000).toFixed(1)}s${C.reset}`)

  const fatal = results.some((r) => r.fatal)
  const soft = results.some((r) => r.nonFatal)

  if (!fatal) {
    log('')
    // 校验和以线上为准 —— 同一份源码在 CI 与本机构建的 exe 内容不同,别拿本地那组对外
    const assets = DRY_RUN ? [] : releaseAssets(TAG)
    if (assets.length) {
      log(`  ${C.dim}线上产物(GitHub Release,用户下载的就是这些):${C.reset}`)
      for (const a of assets) {
        const d = (a.digest || '').replace(/^sha256:/, '') || '(无 digest)'
        info(`${d}  ${a.name}  ${(a.size / 1048576).toFixed(1)} MB`)
      }
    }
    const localPresent = ARTIFACTS.filter((f) => fs.existsSync(path.join(ROOT, 'dist', f)))
    if (localPresent.length) {
      log(`  ${C.dim}本地构建(仅本机留存,与线上不同,不要拿去核对下载):${C.reset}`)
      for (const f of localPresent) info(`SHA256 ${sha256(path.join(ROOT, 'dist', f))}  ${f}`)
    }
    if (DRY_RUN) {
      log(`\n  ${C.green}${C.bold}体检通过(dry-run,没有发布任何东西)${C.reset}`)
      log(`  ${C.dim}确认无误后执行:npm run release${C.reset}`)
    } else {
      log(`\n  ${C.green}${C.bold}发布完成${C.reset}  https://github.com/${REPO}/releases/tag/${TAG}`)
      if (soft) log(`  ${C.yellow}注意:npm 插件未发布,按上面的命令补发即可。${C.reset}`)
    }
  } else if (!DRY_RUN) {
    log(`\n  ${C.dim}失败后可用 --from=<步骤> 续跑,例如 node scripts/release.js --from=ci${C.reset}`)
  }

  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch { /* 忽略 */ }

  if (fatal) process.exitCode = results.find((r) => r.fatal).code || 1
  else if (soft) process.exitCode = 0
}

main()
