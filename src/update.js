'use strict'
// 更新模块:版本检测 / 更新前备份 / 全局更新 / 回滚
//
// 针对 2026-09-10 那次真实失败(npm EBUSY:copyfile koffi.node,npm 清理 ENOTEMPTY,全局 dsh 半更新,
// 之后"回滚"只恢复了 profile 的 package.json/cordis 文件却没有任何结果记录、也没有修联接)做了四点加固:
//   1. 更新/回滚前**强制进程预检**:有 harness 在跑就拒绝执行,避免文件占用导致 EBUSY
//   2. npm 失败时**分类给出可执行结论**(占用/半更新/权限),并标记是否需要重装 CLI
//   3. 回滚**逐步记录结果**(停进程 → 装旧版 → 还原 profile → 修联接 → 复验),失败在哪一步说清楚
//   4. 更新/回滚结束后跑兼容性自检,并确认 dsh 版本真的变了
const fs = require('node:fs')
const path = require('node:path')
const semver = require('semver')
const { managerDirs, profilesDir } = require('./paths')
const log = require('./log')
const { version, execDsh } = require('./dsh')
const { listProfiles, profileInfo } = require('./profiles')
const { execTool, execToolStream } = require('./tool')

function execFileAsync(cmd, args, opts = {}) {
  return execTool(cmd, args, opts)
}

// npm view 要跑 5 秒左右(走网络)—— 缓存结果,避免每次打开就一直转圈;fresh 用于手动点「检查更新」
let updateCache = null // { at, value }
const UPDATE_TTL_MS = 10 * 60 * 1000

async function checkUpdate({ fresh = false } = {}) {
  const now = Date.now()
  if (!fresh && updateCache && now - updateCache.at < UPDATE_TTL_MS) {
    // 本地版本可能已经变了(刚更新过),所以 current 总是重新读
    const current = await version()
    return { ...updateCache.value, current, hasUpdate: Boolean(updateCache.value.latest && current && semver.valid(current) && semver.valid(updateCache.value.latest) && semver.lt(current, updateCache.value.latest)) }
  }
  const current = await version()
  let latest = null
  let error = null
  try {
    // 先读 dist-tags(单次请求、比 npm view 快),失败再回退到 npm view
    const res = await fetch('https://registry.npmjs.org/-/package/@deepseek-ai%2fdsh/dist-tags', { signal: AbortSignal.timeout(8000) })
    if (res.ok) {
      const tags = await res.json()
      latest = tags && tags.latest ? String(tags.latest) : null
    }
  } catch { /* 回退到 npm view */ }
  if (!latest) {
    try {
      const r = await execFileAsync('npm', ['view', '@deepseek-ai/dsh', 'version'], { timeout: 30000 })
      latest = r.ok ? r.stdout.trim() : null
      if (!r.ok) error = r.stderr || r.error
    } catch (e) { error = e.message }
  }
  let hasUpdate = false
  if (current && latest && semver.valid(current) && semver.valid(latest)) {
    hasUpdate = semver.lt(current, latest)
  }
  updateCache = { at: now, value: { latest, error } }
  return { current, latest, hasUpdate, error }
}

function invalidateUpdateCache() { updateCache = null }

// 列出 registry 上可安装的 dsh 版本(供「更新到指定版本」使用)。
// 上游偶发「latest 指向一个依赖没发全的版本」(npm ETARGET),这时只能回退到已知可用版本。
async function listVersions({ registry = null } = {}) {
  const base = registry === 'npmmirror' ? 'https://registry.npmmirror.com'
    : (registry && registry !== 'official' ? registry : 'https://registry.npmjs.org')
  try {
    const res = await fetch(`${base}/@deepseek-ai%2fdsh`, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const j = await res.json()
    const all = Object.keys(j.versions || {})
    const distTags = j['dist-tags'] || {}
    const sorted = all.filter((v) => semver.valid(v)).sort((a, b) => semver.rcompare(a, b))
    return { ok: true, versions: sorted.slice(0, 60), distTags, registry: base }
  } catch (e) {
    return { ok: false, error: e.message, versions: [], distTags: {}, registry: base }
  }
}

// ---- 进程预检:谁会占用全局 dsh 的文件 -------------------------------------------------
function runningWorkloads() {
  const out = { managed: [], cli: [], desktop: null, unknown: false, blocking: false, detail: [] }
  try {
    const status = require('./status')
    out.managed = status.snapshot().filter((p) => p.running && !p.external).map((p) => ({ name: p.name, pid: p.pid, port: p.port }))
  } catch { /* ignore */ }
  let desktop = null
  try { desktop = require('./desktop').detect() } catch { desktop = null }
  out.desktop = desktop ? { installed: desktop.installed, running: desktop.running, version: desktop.version, exe: desktop.exe } : null
  try {
    const proc = require('./proc').dshProcesses(desktop && desktop.exe ? path.basename(desktop.exe) : null)
    out.cli = proc.cli
    out.unknown = Boolean(proc.unknown)
    out.nodeCount = proc.nodeCount || 0
  } catch { out.unknown = true }

  if (out.managed.length) out.detail.push(`${out.managed.length} 个由管理器启动的 profile:${out.managed.map((m) => m.name).join('、')}`)
  if (out.cli.length) out.detail.push(`${out.cli.length} 个 dsh CLI 进程`)
  if (out.desktop && out.desktop.running === true) out.detail.push('官方 DeepSeek Harness 桌面端正在运行')
  if (out.unknown && !out.detail.length) out.detail.push('无法确认是否有 dsh 进程在运行(权限不足)')
  out.blocking = out.managed.length > 0 || out.cli.length > 0 || Boolean(out.desktop && out.desktop.running === true)
  return out
}

// npm 失败分类:EBUSY 是全量更新最常见的死因(有进程占用文件)
function classifyNpmError(text) {
  const t = String(text || '')
  if (/EBUSY|resource busy or locked/i.test(t)) {
    return {
      code: 'EBUSY',
      hint: '文件被占用:更新前必须停掉所有 harness 进程(包括官方桌面端)。停止后重试即可。',
      needsReinstall: true,
    }
  }
  if (/ENOTEMPTY|npm warn cleanup/i.test(t)) {
    return {
      code: 'ENOTEMPTY',
      hint: '上次更新残留了半清理的目录,全局 dsh 可能处于半更新状态,建议直接「强制重装 dsh CLI」。',
      needsReinstall: true,
    }
  }
  if (/EPERM|EACCES/i.test(t)) {
    return { code: 'EPERM', hint: '权限不足:请关闭占用进程,或以管理员身份重试。', needsReinstall: false }
  }
  if (/ETARGET|No matching version/i.test(t)) {
    return {
      code: 'ETARGET',
      // 最常见成因:上游 latest 指向一个依赖未同步/未发布的版本(如 0.2.2-rc.1 的某个子包),
      // 或镜像源尚未同步到该版本。给用户可操作的出路,而不是只说“失败”。
      hint: 'npm 上找不到这个版本(常因上游最新版的依赖未发布/未同步,或镜像尚未同步)。可在「目标版本」里选一个已知可用的版本重试;若正在用镜像,也可切回官方源。',
      needsReinstall: false,
    }
  }
  // 网络类:国内直连 registry.npmjs.org 最常见的“没反应”就是这个
  if (/ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network|fetch failed|request to .* failed|ERR_SOCKET|timed out/i.test(t)) {
    return {
      code: 'NETWORK',
      hint: '连接 npm 源失败/超时:可在「设置 → npm 下载源」改用国内镜像(npmRegistry=npmmirror)后重试。',
      needsReinstall: false,
      network: true,
    }
  }
  return { code: 'UNKNOWN', hint: null, needsReinstall: false }
}

async function createBackup() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const dir = path.join(managerDirs.backups, stamp)
  fs.mkdirSync(dir, { recursive: true })
  const v = await version()
  fs.writeFileSync(path.join(dir, 'dsh-version.txt'), v || 'unknown')
  const manifest = { version: v, createdAt: new Date().toISOString(), profiles: [] }
  for (const p of listProfiles()) {
    // 官方桌面端独占的 profile 不备份也不还原(它由 Electron 自己管理,写它等于破坏官方运行时)
    if (p.external) continue
    const read = (f) => { try { return fs.readFileSync(path.join(p.dir, f), 'utf8') } catch { return null } }
    manifest.profiles.push({
      name: p.name,
      type: p.type,
      bundles: p.bundles,
      dependencies: p.dependencies,
      packageJson: read('package.json'),
      cordisPatch: read('cordis.patch.yml'),
      cordis: read('cordis.yml'),
    })
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  log.logInfo(`已创建备份 ${stamp}(版本 ${v || '未知'}、${manifest.profiles.length} 个 profile)`)
  return { id: stamp, dir, version: v }
}

// 更新后自检:新版可能改变插件解析位置,导致 profile 插件加载失败
async function postCheck(emit) {
  try {
    const compat = require('./compat')
    const all = await compat.checkAll({ deep: true })
    if (!all.global.ok) {
      emit?.('done', 100, `⚠ 全局 dsh 安装完整性异常:${all.global.problems.join(';')}`)
      emit?.('done', 100, '💡 建议点「强制重装 dsh CLI」把安装树恢复完整')
      return { ok: false, all, needsReinstall: true }
    }
    const bad = all.profiles.filter((p) => !p.ok && !p.skipped)
    if (bad.length) {
      const detail = bad.map((i) => `${i.profile}: ${i.bad.join(', ')}`).join(';')
      emit?.('done', 100, `⚠ 自检发现插件无法解析:${detail}`)
      emit?.('done', 100, '💡 点「插件兼容性修复」可一键建联接并复验(否则启动 harness 会失败)')
      return { ok: false, all }
    }
    emit?.('done', 100, `✔ 更新后自检通过:${all.summary}`)
    return { ok: true, all }
  } catch (e) {
    emit?.('done', 100, `⚠ 更新后自检未完成: ${e.message}`)
    return { ok: false, error: e.message }
  }
}

async function doUpdate(onProgress, { stopManaged = false, registry = null, onChild = null, targetVersion = null } = {}) {
  const emit = (phase, percent, line, meta) => onProgress?.({ phase, percent, line, ...(meta || {}) })
  const oldVersion = await version()

  // 1. 强制预检:有 harness 在跑就拒绝(EBUSY 的根因)
  const pre = runningWorkloads()
  if (pre.blocking && !stopManaged) {
    const msg = `更新被阻止:检测到 ${pre.detail.join(';')}。请先停止它们(点「全部停止并继续」),否则 npm 替换文件会失败(EBUSY)。`
    emit('preflight', 2, `✘ ${msg}`)
    log.logWarn(msg)
    return { ok: false, code: 'RUNNING', preflight: pre, error: msg }
  }
  if (pre.blocking && stopManaged) {
    emit('preflight', 3, `正在停止 ${pre.managed.length} 个管理器托管的 profile …`)
    try {
      const status = require('./status')
      for (const m of pre.managed) { await status.stop(m.name, { force: true }); emit('preflight', 4, `已停止 ${m.name}`) }
    } catch (e) { emit('preflight', 4, `停止 profile 失败: ${e.message}`) }
    const again = runningWorkloads()
    if (again.blocking) {
      const msg = `仍然有 dsh 进程在运行:${again.detail.join(';')}。官方桌面端与外部 CLI 进程请手动关闭后再更新。`
      emit('preflight', 5, `✘ ${msg}`)
      return { ok: false, code: 'RUNNING', preflight: again, error: msg }
    }
    emit('preflight', 5, '✔ 已确认没有 dsh 进程在占用文件')
  } else {
    emit('preflight', 5, '✔ 预检通过:没有 dsh 进程占用文件')
  }

  emit('start', 6, `开始更新 @deepseek-ai/dsh(当前 ${oldVersion || '未知'})…`)

  let backup = null
  try {
    backup = await createBackup()
    emit('backup', 15, `✔ 已备份当前版本(${backup.version})与各 profile 配置`)
  } catch (e) {
    emit('backup', 15, `⚠ 备份失败(继续更新): ${e.message}`)
  }

  const spec = targetVersion ? `@deepseek-ai/dsh@${targetVersion}` : '@deepseek-ai/dsh@latest'
  emit('install', 20, `正在全局安装 ${spec}(输出实时显示如下)…`)
  const envMod = require('./env')
  const regArgs = registry && envMod.NPM_REGISTRY[registry] ? [`--registry=${envMod.NPM_REGISTRY[registry]}`] : []
  if (registry) emit('install', 20, `使用 npm 镜像:${envMod.NPM_REGISTRY[registry] || registry}`)
  const r = await execToolStream('npm', ['install', '-g', spec, ...regArgs], {
    timeout: 900000,
    heartbeatMs: 5000,
    onChild,
    onLine: (line, meta) => emit('install', null, line, meta),
  })
  if (r.cancelled) {
    emit('failed', 100, '⏹ 已取消更新')
    return { ok: false, cancelled: true, backup, error: '已取消' }
  }
  if (!r.ok) {
    const cls = classifyNpmError(`${r.stderr || ''}\n${r.stdout || ''}\n${r.error || ''}`)
    log.logWarn(`更新失败(${cls.code}):${(r.stderr || r.error || '').slice(0, 400)}`)
    emit('failed', 100, `✘ 更新失败[${cls.code}]: ${(r.stderr || r.error || '').slice(0, 400)}`)
    if (cls.hint) emit('failed', 100, `💡 ${cls.hint}`)
    return { ok: false, backup, error: r.stderr || r.error, code: cls.code, hint: cls.hint, needsReinstall: cls.needsReinstall }
  }

  emit('verify', 95, '正在校验版本 …')
  const v = await version()
  if (oldVersion && v === oldVersion) {
    emit('done', 100, `⚠ 安装命令已结束但版本仍是 ${v}(全局安装可能不完整)`)
    emit('done', 100, '💡 建议点「强制重装 dsh CLI」')
    return { ok: false, backup, version: v, code: 'NOCHANGE', needsReinstall: true, hint: 'npm 报成功但版本未变化,安装树可能不完整' }
  }
  emit('done', 100, `✔ 更新完成:${oldVersion || '?'} → ${v || '?'}`)

  const post = await postCheck(emit)
  return { ok: true, backup, version: v, compat: post.all || null, compatOk: post.ok, needsReinstall: post.needsReinstall || false }
}

// 强制重装:半更新状态下唯一可靠的修法
async function reinstallDsh(onProgress, opts = {}) {
  const emit = (phase, percent, line, meta) => onProgress?.({ phase, percent, line, ...(meta || {}) })
  const pre = runningWorkloads()
  if (pre.blocking) {
    const msg = `重装被阻止:${pre.detail.join(';')}。请先停止它们。`
    emit('preflight', 2, `✘ ${msg}`)
    return { ok: false, code: 'RUNNING', error: msg, preflight: pre }
  }
  emit('install', 5, '正在强制重装 @deepseek-ai/dsh@latest(忽略缓存与锁)…')
  const env = require('./env')
  const regArgs = opts.registry && env.NPM_REGISTRY[opts.registry] ? [`--registry=${env.NPM_REGISTRY[opts.registry]}`] : []
  if (opts.registry) emit('install', 5, `使用 npm 镜像:${env.NPM_REGISTRY[opts.registry] || opts.registry}`)
  const r = await execToolStream('npm', ['install', '-g', '@deepseek-ai/dsh@latest', '--force', ...regArgs], {
    timeout: 1200000,
    heartbeatMs: 5000,
    onChild: opts.onChild,
    onLine: (line, meta) => emit('install', null, line, meta),
  })
  if (r.cancelled) {
    emit('failed', 100, '⏹ 已取消重装')
    return { ok: false, cancelled: true, error: '已取消' }
  }
  if (!r.ok) {
    const cls = classifyNpmError(`${r.stderr || ''}\n${r.stdout || ''}\n${r.error || ''}`)
    log.logWarn(`重装失败(${cls.code}):${(r.stderr || r.error || '').slice(0, 300)}`)
    emit('failed', 100, `✘ 重装失败[${cls.code}]${cls.hint ? ':' + cls.hint : ''}`)
    return { ok: false, error: r.stderr || r.error, code: cls.code, hint: cls.hint }
  }
  const v = await version()
  emit('done', 100, `✔ 重装完成,当前版本 ${v || '未知'}`)
  const post = await postCheck(emit)
  return { ok: true, version: v, compat: post.all || null, compatOk: post.ok }
}

function listBackups() {
  if (!fs.existsSync(managerDirs.backups)) return []
  return fs.readdirSync(managerDirs.backups)
    .map((id) => {
      const dir = path.join(managerDirs.backups, id)
      let version = '?'
      try { version = fs.readFileSync(path.join(dir, 'dsh-version.txt'), 'utf8').trim() } catch { /* ignore */ }
      return { id, version, dir }
    })
    .sort((a, b) => b.id.localeCompare(a.id))
}


// 备份的创建时间:优先 manifest.json 里的 createdAt,其次目录 mtime,最后从 id 解析
function backupAge(id, dir) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
    if (m.createdAt) { const t = Date.parse(m.createdAt); if (!Number.isNaN(t)) return t }
  } catch { /* ignore */ }
  try { return fs.statSync(dir).mtimeMs } catch { /* ignore */ }
  // id 形如 2026-09-30T03-30-12(UTC,冒号被换成了短横)
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})$/.exec(id)
  if (m) { const t = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`); if (!Number.isNaN(t)) return t }
  return null
}

function dirSizeMb(dir) {
  let total = 0
  const walk = (d) => {
    let entries = []
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) walk(full)
      else { try { total += fs.statSync(full).size } catch { /* ignore */ } }
    }
  }
  walk(dir)
  return total / 1024 / 1024
}

// 备份列表:带时间与体积,供界面展示与手动删除
function backupsDetailed() {
  return listBackups().map((b) => ({
    ...b,
    createdAt: backupAge(b.id, b.dir),
    sizeMb: Math.round(dirSizeMb(b.dir) * 10) / 10,
  }))
}

function backupStats() {
  const items = backupsDetailed()
  const totalMb = Math.round(items.reduce((n, b) => n + (b.sizeMb || 0), 0) * 10) / 10
  return { count: items.length, totalMb, items }
}

// 删除单个备份(先确认 id 在备份目录下,防止路径穿越)
function removeBackup(id) {
  if (!id || /[\\/]|\.\./.test(String(id))) return { ok: false, error: '非法的备份 id' }
  const dir = path.join(managerDirs.backups, String(id))
  if (!dir.startsWith(managerDirs.backups)) return { ok: false, error: '非法的备份路径' }
  if (!fs.existsSync(dir)) return { ok: false, error: '该备份不存在' }
  try {
    fs.rmSync(dir, { recursive: true, force: true })
    log.logInfo(`已删除备份 ${id}`)
    return { ok: true, id }
  } catch (e) {
    log.logWarn(`删除备份 ${id} 失败: ${e.message}`)
    return { ok: false, error: e.message }
  }
}

// 自动清理:删除「比保留期更老」的备份,但永远保留最新 1 份(避免把自己删空)
function pruneBackups({ retentionDays = 0, now = Date.now() } = {}) {
  const days = Number(retentionDays) || 0
  if (!(days > 0)) return { ok: true, skipped: true, removed: [] }
  const items = backupsDetailed()
  if (items.length <= 1) return { ok: true, removed: [], kept: items.length, reason: '只有一个备份,保留' }
  const cutoff = now - days * 24 * 60 * 60 * 1000
  // items 已按 id 降序(新的在前),第一份永不删
  const newest = items[0]
  const removed = []
  for (const b of items.slice(1)) {
    if (b.createdAt && b.createdAt < cutoff) {
      const r = removeBackup(b.id)
      if (r.ok) removed.push({ id: b.id, sizeMb: b.sizeMb })
    }
  }
  if (removed.length) {
    const freed = Math.round(removed.reduce((n, x) => n + (x.sizeMb || 0), 0) * 10) / 10
    log.logInfo(`自动清理备份:删除 ${removed.length} 个(超过 ${days} 天),释放约 ${freed} MB;保留最新 ${newest.id}`)
  }
  return { ok: true, removed, kept: items.length - removed.length }
}

// 手动清空:全部删除(界面会二次确认)
function clearBackups() {
  const items = listBackups()
  const removed = []
  for (const b of items) { const r = removeBackup(b.id); if (r.ok) removed.push(b.id) }
  log.logWarn(`已清空全部备份(${removed.length} 个)`)
  return { ok: true, removed }
}
// 回滚:逐步执行并记录每一步结果(旧版只有一行日志,失败也无从得知)
async function rollback(id, { stopManaged = false } = {}) {
  const steps = []
  const step = (name, ok, detail) => {
    steps.push({ name, ok, detail })
    log.logInfo(`[回滚] ${ok ? '✔' : '✘'} ${name}${detail ? ': ' + detail : ''}`)
  }
  const backup = listBackups().find((b) => b.id === id)
  if (!backup) return { ok: false, error: '未找到该备份', steps }
  const targetVersion = backup.version === '?' || backup.version === 'unknown' ? null : backup.version
  if (!targetVersion) return { ok: false, error: '备份中缺少版本号,无法回滚', steps }

  const pre = runningWorkloads()
  if (pre.blocking && !stopManaged) {
    const msg = `回滚被阻止:${pre.detail.join(';')}。请先停止它们,否则安装旧版同样会 EBUSY。`
    step('进程预检', false, msg)
    return { ok: false, code: 'RUNNING', error: msg, preflight: pre, steps }
  }
  if (pre.blocking && stopManaged) {
    try {
      const status = require('./status')
      for (const m of pre.managed) await status.stop(m.name, { force: true })
      const again = runningWorkloads()
      if (again.blocking) {
        step('进程预检', false, `仍有进程在跑:${again.detail.join(';')}`)
        return { ok: false, code: 'RUNNING', error: `仍有进程在跑:${again.detail.join(';')}`, preflight: again, steps }
      }
      step('进程预检', true, '已停止管理器托管的 profile')
    } catch (e) {
      step('进程预检', false, e.message)
    }
  } else {
    step('进程预检', true, '没有 dsh 进程占用文件')
  }

  const r = await execFileAsync('npm', ['install', '-g', `@deepseek-ai/dsh@${targetVersion}`], { timeout: 600000 })
  if (!r.ok) {
    const cls = classifyNpmError(`${r.stderr || ''}\n${r.error || ''}`)
    step(`安装旧版 ${targetVersion}`, false, `${cls.code}: ${(r.stderr || r.error || '').slice(0, 300)}`)
    if (cls.hint) step('建议', false, cls.hint)
    return { ok: false, error: r.stderr || r.error, code: cls.code, hint: cls.hint, steps }
  }
  step(`安装旧版 ${targetVersion}`, true, 'npm 安装完成')

  let restored = 0
  let restoreError = null
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(backup.dir, 'manifest.json'), 'utf8'))
    for (const p of manifest.profiles || []) {
      const dir = path.join(profilesDir, p.name)
      // 官方桌面端独占的 profile 绝不写
      let info = null
      try { info = profileInfo(p.name) } catch { info = null }
      if (info && info.external) { log.logWarn(`[回滚] 跳过官方桌面端 profile「${p.name}」`); continue }
      if (p.packageJson != null) fs.writeFileSync(path.join(dir, 'package.json'), p.packageJson)
      if (p.cordisPatch != null) fs.writeFileSync(path.join(dir, 'cordis.patch.yml'), p.cordisPatch)
      if (p.cordis != null) fs.writeFileSync(path.join(dir, 'cordis.yml'), p.cordis)
      restored++
    }
    step('还原 profile 配置', true, `${restored} 个 profile`)
  } catch (e) {
    restoreError = e.message
    step('还原 profile 配置', false, e.message)
  }

  // 旧版 dsh 的解析位置可能与新版不同:回滚后同样要修联接并复验
  try {
    const compat = require('./compat')
    const fixResults = []
    for (const p of listProfiles()) {
      if (p.external) continue
      const fix = await compat.fixBundles(p.name, { onLog: (l) => log.logInfo(l) })
      const check = await compat.checkBundles(p.name, { deep: true })
      fixResults.push({ profile: p.name, ok: check.ok, fixed: (fix.results || []).filter((x) => x.status === 'linked').map((x) => x.pkg), bad: check.bad })
    }
    const badProfiles = fixResults.filter((x) => !x.ok)
    step('修复并复验插件解析', badProfiles.length === 0, badProfiles.length ? badProfiles.map((x) => `${x.profile}: ${x.bad.join(',')}`).join(';') : '全部通过')
    const v = await version()
    step('确认版本', v === targetVersion, `当前 ${v || '未知'}(目标 ${targetVersion})`)
    return {
      ok: v === targetVersion, version: v, steps,
      warning: restoreError ? `profile 配置恢复失败: ${restoreError}` : null,
      compat: fixResults,
    }
  } catch (e) {
    step('修复并复验插件解析', false, e.message)
    const v = await version()
    return { ok: v === targetVersion, version: v, steps, error: e.message }
  }
}

module.exports = {
  checkUpdate, invalidateUpdateCache, createBackup, doUpdate, listBackups, rollback,
  backupsDetailed, backupStats, removeBackup, pruneBackups, clearBackups,
  runningWorkloads, classifyNpmError, reinstallDsh, postCheck,
}
