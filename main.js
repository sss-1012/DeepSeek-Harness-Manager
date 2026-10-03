'use strict'
// DeepSeek Harness 管理器 — Electron 主进程
const path = require('node:path')
const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell, nativeImage, screen } = require('electron')

const paths = require('./src/paths')
const store = require('./src/store')
const log = require('./src/log')
const dsh = require('./src/dsh')
const profiles = require('./src/profiles')
const overrides = require('./src/overrides')
const plugins = require('./src/plugins')
const sources = require('./src/plugins/sources')
const resolver = require('./src/plugins/resolver')
const history = require('./src/history')
const diagnose = require('./src/diagnose')
const update = require('./src/update')
const balance = require('./src/balance')
const env = require('./src/env')
const compat = require('./src/compat')
const security = require('./src/security')
const status = require('./src/status')
const desktop = require('./src/desktop')
const icons = require('./src/icons')
const trayMod = require('./src/tray')

const APP_VERSION = require('./package.json').version
const APP_NAME = require('./package.json').name

let mainWindow = null
let trayHandle = null
let statusTimer = null
let lastStatusJson = ''
let quitting = false

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
}

// ---- 渲染后端选择(必须在 app ready 之前决定)----
// 现场证据:窗口、进程、渲染进程全正常,但窗口内容一个像素都没画出来(只有背景色),
// invalidate()/重画都无效 —— 这是 Chromium 合成层(GPU)没出画面。
// 因此提供软件渲染兜底:命令行 --disable-gpu / --software-rendering,或设置里的开关(多次自愈失败后自动打开)。
function wantsSoftwareRendering() {
  if (process.argv.includes('--disable-gpu') || process.argv.includes('--software-rendering')) return 'command-line'
  try { if (store.getSettings().softwareRendering) return 'settings' } catch { /* ignore */ }
  return null
}
const SOFTWARE_RENDERING = wantsSoftwareRendering()
if (SOFTWARE_RENDERING) {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu-compositing')
}

// GPU/工具进程崩溃是“窗口空白”的常见原因,必须留下证据(以前不记)
app.on('child-process-gone', (_e, details) => {
  const d = details || {}
  log.logWarn(`子进程退出: type=${d.type} reason=${d.reason} exitCode=${d.exitCode}${d.serviceName ? ` service=${d.serviceName}` : ''}`)
  if (d.type === 'GPU' && d.reason && d.reason !== 'clean-exit') {
    log.logWarn('GPU 进程异常退出 → 若界面空白,可从托盘菜单选「以软件渲染重启」')
  }
})

// 窗口尺寸兜底:隐藏到托盘期间可能因休眠/分辨率变化/DPI 切换被归零或挪到屏幕外,
// 那会让用户看到「窗口在、内容全没了」(卡片消失)。这里统一校验并修复。
const DEFAULT_BOUNDS = { width: 1360, height: 880 }
function boundsAreSane(bounds) {
  if (!bounds) return false
  if (!(bounds.width >= 400) || !(bounds.height >= 300)) return false
  try {
    const displays = screen.getAllDisplays()
    return displays.some((d) => {
      const a = d.workArea
      return bounds.x < a.x + a.width && bounds.x + bounds.width > a.x &&
        bounds.y < a.y + a.height && bounds.y + bounds.height > a.y
    })
  } catch { return true } // 拿不到显示器信息时不做判断,避免误重置
}

// 从托盘恢复 / 重新唤起时:修复尺寸 + 强制重绘 + 让渲染层重画当前视图
function showWindow() {
  if (!mainWindow) { createWindow(); return }
  try {
    if (mainWindow.isMinimized()) mainWindow.restore()
    const b = mainWindow.getBounds()
    if (!boundsAreSane(b)) {
      log.logWarn(`窗口尺寸/位置异常(${b.width}x${b.height} @ ${b.x},${b.y}),已重置为 ${DEFAULT_BOUNDS.width}x${DEFAULT_BOUNDS.height} 并居中`)
      mainWindow.setBounds(DEFAULT_BOUNDS)
      mainWindow.center()
    }
    mainWindow.show()
    mainWindow.focus()
    repaintWindow()
    log.logInfo(`窗口已显示 (${mainWindow.getBounds().width}x${mainWindow.getBounds().height})`)
    scheduleUiChecks()   // 显示后自检:隐藏久了容易出“窗口在但画面没出来”
  } catch (e) { log.logWarn(`显示窗口失败: ${e.message}`) }
}

// 重置窗口:用户从托盘菜单显式触发,用于自助恢复「内容不见了」的窗口
function resetWindow() {
  if (!mainWindow) { createWindow(); return }
  try {
    if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false)
    mainWindow.unmaximize()
    mainWindow.setBounds(DEFAULT_BOUNDS)
    mainWindow.center()
    mainWindow.show()
    mainWindow.focus()
    repaintWindow()
    log.logInfo(`窗口已重置为 ${DEFAULT_BOUNDS.width}x${DEFAULT_BOUNDS.height} 并居中`)
  } catch (e) { log.logWarn(`重置窗口失败: ${e.message}`) }
}

// 手动重载界面(托盘菜单 / 设置里的按钮):不重启进程的最轻恢复手段
function reloadUi() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  log.logInfo('手动重载界面')
  repaintWindow()
  try { mainWindow.webContents.reload() } catch { /* ignore */ }
  uiRecoveryAttempts = 0
}

// 以软件渲染重启:GPU 合成挂了时,这是最可靠的恢复手段(不关 harness)
function restartWithSoftwareRendering() {
  if (SOFTWARE_RENDERING) {
    log.logInfo('当前已是软件渲染,直接重启管理器')
  } else {
    log.logWarn('切换到软件渲染(关闭硬件加速)并重启管理器')
    try { store.setSettings({ softwareRendering: true }) } catch { /* ignore */ }
  }
  setTimeout(() => { try { app.relaunch(); app.exit(0) } catch { /* ignore */ } }, 300)
}

// 强制重绘:隐藏久了再次显示时,Chromium 可能保留旧帧或空白帧
function repaintWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  try { mainWindow.webContents.invalidate() } catch { /* ignore */ }
  try { mainWindow.webContents.send('app:refresh') } catch { /* ignore */ }
  // 有些驱动不吃 invalidate,轻微改尺寸能强制重排一次
  try {
    const b = mainWindow.getBounds()
    mainWindow.setBounds({ ...b, width: b.width + 1 })
    setTimeout(() => { try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setBounds(b) } catch { /* ignore */ } }, 60)
  } catch { /* ignore */ }
}

// ---- 界面健康自检 ----
// 分辨两种“卡片不见了”:页面没加载出来(DOM 空) vs 页面正常但没画到屏幕上(合成失败)。
// 现场实测过第二种:窗口、进程、渲染进程全正常,capturePage 只有背景色,invalidate() 无效。
let uiRecoveryAttempts = 0
let uiCheckTimer = null

async function uiHealth() {
  const wc = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null
  if (!wc) return null
  let dom
  try {
    dom = await wc.executeJavaScript(`(() => ({
      ready: document.readyState,
      bodyLen: document.body ? document.body.innerHTML.length : 0,
      cards: document.querySelectorAll('#status-cards .card').length,
      nav: document.querySelectorAll('.nav-item').length,
    }))()`, true)
  } catch (e) { dom = { error: e.message } }
  let colorCount = null
  try {
    const img = await wc.capturePage()
    const { width, height } = img.getSize()
    if (width && height) {
      const buf = img.toBitmap()
      const seen = new Set()
      const sx = Math.max(1, Math.floor(width / 32))
      const sy = Math.max(1, Math.floor(height / 32))
      for (let y = 0; y < height && seen.size <= 5; y += sy) {
        for (let x = 0; x < width && seen.size <= 5; x += sx) {
          const i = (y * width + x) * 4
          seen.add(`${buf[i]},${buf[i + 1]},${buf[i + 2]}`)
        }
      }
      colorCount = seen.size
    }
  } catch { colorCount = null }
  return { dom, colorCount }
}

async function checkUi(where) {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return
  const h = await uiHealth()
  if (!h) return
  const dom = h.dom || {}
  const domEmpty = !dom.error && (dom.bodyLen || 0) < 200
  const noCards = !dom.error && (dom.cards || 0) === 0
  const blankPaint = h.colorCount !== null && h.colorCount <= 2
  const healthy = !dom.error && !domEmpty && !blankPaint && (dom.nav || 0) > 0
  log.logInfo(`界面自检(${where}):ready=${dom.ready} 侧栏=${dom.nav} 卡片=${dom.cards} body=${dom.bodyLen} 颜色数=${h.colorCount}${dom.error ? ` 错误=${dom.error}` : ''}`)
  if (healthy) { uiRecoveryAttempts = 0; return }
  recoverUi(domEmpty || noCards ? '页面内容为空' : '窗口只有背景色(合成失败)')
}

// 恢复阶梯:重画 → 重载页面 → 重建窗口 → 软件渲染重启
function recoverUi(reason) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  uiRecoveryAttempts++
  if (uiRecoveryAttempts === 1) {
    log.logWarn(`界面异常(${reason}):第 1 次恢复 —— 强制重绘 + 重新加载页面`)
    repaintWindow()
    try { mainWindow.webContents.reload() } catch { /* ignore */ }
    return
  }
  if (uiRecoveryAttempts === 2) {
    log.logWarn(`界面异常(${reason}):第 2 次恢复 —— 重建窗口`)
    recreateWindow()
    return
  }
  log.logWarn(`界面异常(${reason}):多次恢复无效 —— 改为软件渲染重启管理器(判断为 GPU 合成问题)`)
  try { store.setSettings({ softwareRendering: true }) } catch { /* ignore */ }
  setTimeout(() => { try { app.relaunch(); app.exit(0) } catch { /* ignore */ } }, 500)
}

function recreateWindow() {
  try {
    const old = mainWindow
    mainWindow = null
    if (old && !old.isDestroyed()) old.destroy()
  } catch { /* ignore */ }
  createWindow()
  showWindow()
}

function scheduleUiChecks() {
  if (uiCheckTimer) clearTimeout(uiCheckTimer)
  setTimeout(() => checkUi('加载后'), 2000)
  uiCheckTimer = setTimeout(() => checkUi('延迟复检'), 9000)
}

function createWindow() {
  const winIcon = nativeImage.createFromDataURL(`data:image/png;base64,${icons.ICONS['icon.png']}`)
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1024,
    minHeight: 640,
    title: 'DeepSeek Harness 管理器',
    icon: winIcon.isEmpty() ? path.join(__dirname, 'assets', 'icon.png') : winIcon,
    backgroundColor: '#f3f5f9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  // 显示时补一次重绘(异步,避开 show 的同帧)
  mainWindow.on('show', () => {
    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      try { mainWindow.webContents.invalidate() } catch { /* ignore */ }
      scheduleUiChecks()
    }, 200)
  })
  // 渲染进程崩溃/无响应时自愈:否则窗口会永远停在一片空白(看起来就是「卡片全没了」)
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    log.logWarn(`渲染进程退出(${details && details.reason}),正在重新加载界面`)
    try { mainWindow.webContents.reload() } catch { /* ignore */ }
    setTimeout(() => scheduleUiChecks(), 1500)
  })
  mainWindow.webContents.on('unresponsive', () => log.logWarn('界面无响应(仍在等待渲染进程)'))
  mainWindow.webContents.on('responsive', () => log.logInfo('界面已恢复响应'))
  // 诊断:页面到底加载成了没有(以前这些事件不记日志,出现“空白窗口”时无从判断)
  mainWindow.webContents.on('did-finish-load', () => {
    log.logInfo('界面页面已加载,开始自检')
    scheduleUiChecks()
  })
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => log.logWarn(`界面页面加载失败(${code} ${desc}): ${url}`))
  mainWindow.webContents.on('preload-error', (_e, file, err) => log.logWarn(`preload 执行出错: ${file} - ${err && err.message}`))
  mainWindow.webContents.on('console-message', (...args) => {
    try {
      const details = args[1]
      const msg = details && typeof details === 'object' && 'message' in details ? details.message : args[2]
      log.logInfo(`[renderer] ${msg}`)
    } catch { /* ignore */ }
  })
  mainWindow.on('close', (e) => {
    if (!quitting && store.getSettings().closeToTray) {
      e.preventDefault()
      mainWindow.hide()
      log.logInfo('窗口已最小化到托盘')
    }
  })
  mainWindow.on('closed', () => { mainWindow = null })
}

function broadcast(channel, data) {
  for (const w of BrowserWindow.getAllWindows()) {
    try { w.webContents.send(channel, data) } catch { /* ignore */ }
  }
}

async function pollStatus() {
  try {
    const snap = await status.snapshot()
    const json = JSON.stringify(snap)
    if (json !== lastStatusJson) {
      lastStatusJson = json
      broadcast('status:changed', snap)
      if (trayHandle) trayHandle.update(snap.some((s) => s.running))
    }
  } catch { /* ignore */ }
}

function registerIpc() {
  // ---- 基础 ----
  ipcMain.handle('app:bootstrap', async () => {
    const snap = await status.snapshot()
    lastStatusJson = JSON.stringify(snap)
    return {
      appVersion: APP_VERSION,
      dshVersion: await dsh.version(),
      dshHome: paths.dshHome,
      managerHome: paths.managerHome,
      profiles: snap,
      settings: store.getSettings(),
      hasApiKey: store.hasApiKey(),
      hasGithubToken: Boolean(store.getGithubToken()),
    }
  })

  ipcMain.handle('profiles:list', async () => status.snapshot())

  ipcMain.handle('profile:get', async (_e, name) => {
    const info = profiles.profileInfo(name)
    return {
      info,
      plugins: plugins.listPlugins(name),
      cordisPatch: profiles.readFileText(name, 'cordis.patch.yml'),
      packageJson: JSON.stringify(info.pkg, null, 2),
      disabledIds: overrides.disabledIds(name),
      running: await status.isRunning(name),
    }
  })

  ipcMain.handle('profile:start', async (_e, name, opts = {}) => {
    const info = profiles.profileInfo(name)
    if (info.external) return { ok: false, error: info.externalReason, external: true }
    if (await status.isRunning(name)) return { ok: false, error: `「${name}」已在运行` }
    return status.start(name, {
      args: opts.args || [],
      onLog: (line) => { log.logInfo(line); broadcast('log:line', line) },
      onEarlyExit: (info) => {
        const msg = `profile「${name}」启动失败(退出码 ${info.code},存活 ${(info.aliveMs / 1000).toFixed(1)}s): ${info.summary}`
        log.logWarn(msg)
        broadcast('profile:failed', {
          profile: name,
          code: info.code,
          aliveMs: info.aliveMs,
          summary: info.summary,
          lines: info.lines,
        })
      },
    })
  })

  ipcMain.handle('profile:stop', async (_e, name, opts = {}) => {
    return status.stop(name, { force: opts.force })
  })

  ipcMain.handle('profile:create', async (_e, name) => {
    try {
      const info = profiles.createProfile(name)
      log.logInfo(`创建 profile: ${name}`)
      await pollStatus()
      return { ok: true, info }
    } catch (e) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('profile:remove', async (_e, name) => {
    const info = profiles.profileInfo(name)
    if (info.external) return { ok: false, error: info.externalReason, external: true }
    try {
      profiles.removeProfile(name)
      log.logInfo(`删除 profile: ${name}`)
      await pollStatus()
      return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // ---- 插件 ----
  ipcMain.handle('plugins:list', (_e, profile) => plugins.listPlugins(profile))

  ipcMain.handle('plugins:setEnabled', async (_e, profile, id, enabled) => {
    try {
      overrides.setEnabled(profile, id, enabled)
    } catch (e) {
      log.logWarn(`插件启停被拒绝(${profile} / ${id}):${e.message}`)
      return { ok: false, error: e.message, external: Boolean(e.external) }
    }
    log.logInfo(`插件 ${enabled ? '启用' : '禁用'}: ${profile} / ${id}`)
    const running = await status.isRunning(profile)
    return { ok: true, disabledIds: overrides.disabledIds(profile), needRestart: running }
  })

  ipcMain.handle('plugins:uninstall', async (_e, profile, pkg) => {
    const info = profiles.profileInfo(profile)
    if (info.external) return { ok: false, error: info.externalReason, external: true }
    log.logInfo(`卸载插件: ${profile} / ${pkg}`)
    return plugins.uninstall(profile, pkg)
  })

  ipcMain.handle('plugins:search', async (_e, query, selected) => {
    return sources.search(query, selected, {
      githubToken: store.getGithubToken(),
      insecureGitHub: Boolean(store.getSettings().insecureGitHub),
    })
  })

  ipcMain.handle('plugins:resolveDeps', async (_e, spec) => {
    return resolver.resolveDeps(spec)
  })

  ipcMain.handle('plugins:install', async (_e, profile, spec, opts = {}) => {
    const info = profiles.profileInfo(profile)
    if (info.external) return { ok: false, error: info.externalReason, external: true }
    return plugins.installWithDeps(profile, spec, {
      withDeps: opts.withDeps !== false,
      onLog: (line) => { log.logInfo(line); broadcast('log:line', line) },
    })
  })

  ipcMain.handle('plugins:update', async (_e, profile, pkg) => {
    const info = profiles.profileInfo(profile)
    if (info.external) return { ok: false, error: info.externalReason, external: true }
    log.logInfo(`更新插件: ${profile} / ${pkg}`)
    return plugins.update(profile, pkg)
  })

  ipcMain.handle('plugins:detail', async (_e, pkg) => {
    return { url: await plugins.resolveDetailUrl(pkg) }
  })

  // ---- 密钥存储安全 ----
  ipcMain.handle('security:audit', () => security.audit())
  ipcMain.handle('security:harden', async () => {
    const r = security.hardenFilePerms()
    for (const x of r) log.logInfo(`权限收紧 ${x.file}: ${x.status}${x.error ? ' - ' + x.error : ''}`)
    return { ok: r.every((x) => x.status === 'hardened' || x.status === 'skip'), results: r }
  })

  // ---- 历史 / 诊断 / 更新 ----
  ipcMain.handle('history:list', (_e, profile) => history.listHistory(profile))

  ipcMain.handle('diagnose:run', async () => {
    const r = await diagnose.runDiagnostics()
    log.logInfo(`诊断完成: ${r.checks.filter((c) => c.status === 'error').length} 错误, ${r.checks.filter((c) => c.status === 'warn').length} 警告`)
    return r
  })

  ipcMain.handle('update:check', () => update.checkUpdate())

  ipcMain.handle('update:do', async (_e, opts = {}) => {
    return update.doUpdate((evt) => {
      const line = typeof evt === 'string' ? evt : evt?.line
      if (line) log.logInfo(line)
      broadcast('update:progress', evt)
    }, { stopManaged: Boolean(opts.stopManaged) })
  })

  // 强制重装全局 dsh(npm 半更新 / EBUSY 之后的可靠修法)
  ipcMain.handle('update:reinstallDsh', async () => {
    return update.reinstallDsh((evt) => {
      const line = typeof evt === 'string' ? evt : evt?.line
      if (line) log.logInfo(line)
      broadcast('update:progress', evt)
    })
  })

  // 更新/回滚前的进程预检(谁在占用全局 dsh)
  ipcMain.handle('update:preflight', () => update.runningWorkloads())

  // ---- 插件解析兼容性(新版 dsh 变更解析位置) ----
  ipcMain.handle('compat:check', async () => {
    const all = await compat.checkAll({ deep: true })
    log.logInfo(`插件兼容性检查:${all.summary}`)
    for (const p of all.profiles) {
      for (const it of p.items || []) {
        if (it.state === 'ok') continue
        // 仅 profile 内不算失败(dsh 0.2.x 可直接解析),只记 info,避免刷一堆吓人的 WARN
        const line = `[兼容性] ${p.profile} / ${it.name}: ${it.state} - ${it.detail}`
        if (it.severity === 'info') log.logInfo(line); else log.logWarn(line)
      }
    }
    return { ok: all.global.ok && all.profiles.every((p) => p.ok), ...all }
  })
  ipcMain.handle('compat:fix', async (_e, profile) => {
    const targets = profile ? [profile] : profiles.listProfiles().map((p) => p.name)
    const out = []
    for (const name of targets) {
      const r = await compat.fixBundles(name, { deep: true, onLog: (l) => log.logInfo(l) })
      const line = r.skipped
        ? `[compat] ${name}: 跳过(${r.reason})`
        : `[compat] ${name}: ${(r.results || []).map((x) => `${x.pkg}=${x.status}${x.verify && x.verify !== 'ok' ? '(' + x.verify + ')' : ''}`).join(', ')}`
      log.logInfo(line)
      broadcast('log:line', line)
      out.push(r)
    }
    const check = await compat.checkAll({ deep: false })
    return { ok: out.every((r) => r.ok), results: out, check }
  })

  ipcMain.handle('update:backups', () => update.listBackups())

  ipcMain.handle('update:rollback', async (_e, id, opts = {}) => {
    log.logInfo(`回滚到备份: ${id}`)
    const r = await update.rollback(id, { stopManaged: Boolean(opts.stopManaged) })
    for (const s of r.steps || []) log.logInfo(`[回滚] ${s.ok ? '✔' : '✘'} ${s.name}${s.detail ? ': ' + s.detail : ''}`)
    return r
  })

  // ---- 官方桌面端 ----
  // 显式询问桌面端信息时用 fresh:用户在看卡片,要的是实时值
  ipcMain.handle('desktop:info', () => desktop.detectCached({ fresh: true }))
  ipcMain.handle('desktop:open', async () => {
    const info = desktop.detect()
    if (!info.exe) return { ok: false, error: '未找到官方桌面端可执行文件' }
    try { await shell.openPath(info.exe); log.logInfo(`打开官方桌面端: ${info.exe}`); return { ok: true, exe: info.exe } } catch (e) { return { ok: false, error: e.message } }
  })

  // ---- 设置 ----
  ipcMain.handle('settings:get', () => store.getSettings())
  ipcMain.handle('settings:set', (_e, patch) => store.setSettings(patch))
  ipcMain.handle('settings:profile', (_e, name, patch) => store.setProfileSetting(name, patch))

  ipcMain.handle('github:token', () => store.getGithubToken())
  ipcMain.handle('github:setToken', (_e, t) => { store.setGithubToken(t); return { ok: true } })

  // ---- 余额 ----
  ipcMain.handle('balance:get', () => balance.getBalance())
  ipcMain.handle('balance:setKey', async (_e, key) => {
    const r = store.setApiKey(key ? String(key).trim() : null)
    log.logInfo(key ? '已更新 API Key' : '已清除 API Key')
    return r
  })
  ipcMain.handle('balance:hasKey', () => store.hasApiKey())
  ipcMain.handle('balance:importDsh', () => balance.importFromDshCredentials())

  // ---- 环境检测 / 一键安装 ----
  ipcMain.handle('env:check', () => env.check())
  ipcMain.handle('env:installDsh', async () => {
    log.logInfo('一键安装 dsh')
    return env.installDsh((msg) => { log.logInfo(msg); broadcast('log:line', msg) })
  })
  ipcMain.handle('env:installNode', async () => {
    log.logInfo('一键安装 Node.js')
    return env.installNode((msg) => { log.logInfo(msg); broadcast('log:line', msg) })
  })
  ipcMain.handle('env:installNpm', async () => {
    log.logInfo('一键安装 npm')
    return env.installNpm((msg) => { log.logInfo(msg); broadcast('log:line', msg) })
  })
  ipcMain.handle('env:updateDsh', async () => {
    log.logInfo('更新 dsh')
    return env.updateDsh((msg) => { log.logInfo(msg); broadcast('log:line', msg) })
  })
  ipcMain.handle('env:uninstallDsh', async () => {
    log.logInfo('卸载 dsh')
    return env.uninstallDsh((msg) => { log.logInfo(msg); broadcast('log:line', msg) })
  })
  ipcMain.handle('env:uninstallPnpm', async () => {
    log.logInfo('卸载 pnpm')
    return env.uninstallPnpm((msg) => { log.logInfo(msg); broadcast('log:line', msg) })
  })
  ipcMain.handle('env:uninstallNode', async () => {
    log.logInfo('卸载 Node.js')
    return env.uninstallNode((msg) => { log.logInfo(msg); broadcast('log:line', msg) })
  })

  // ---- 日志 / 系统 ----
  ipcMain.handle('logs:tail', () => log.tail(800))
  ipcMain.handle('open:path', (_e, p) => { try { shell.openPath(p) } catch { /* ignore */ } return { ok: true } })
  ipcMain.handle('open:external', (_e, url) => {
    try { shell.openExternal(url) } catch { /* ignore */ }
    return { ok: true }
  })
}

app.whenReady().then(() => {
  store.initSafeStorage(safeStorage)
  paths.ensureManagerDirs()
  log.initLog()
  log.onLogLine((line) => broadcast('log:line', line))
  log.logInfo(`${APP_NAME} v${APP_VERSION} 启动, DSH_HOME=${paths.dshHome}`)

  // 自注册:写入 ~/.dsh-manager/install.json,让 DSH 插件(dsh-harness-manager)能找到管理器
  // 仅在打包后写入,避免开发态把 electron.exe 当成管理器程序
  try {
    if (app.isPackaged) {
      require('node:fs').writeFileSync(paths.installInfoPath, JSON.stringify({
        exe: process.execPath,
        version: APP_VERSION,
        updatedAt: new Date().toISOString(),
      }, null, 2), 'utf8')
    }
  } catch (e) { log.logWarn(`install.json 写入失败: ${e.message}`) }

  // 安全加固:启动时若检测到明文存储的密钥/Token,自动迁移为系统加密
  try {
    const c = store.load()
    for (const [field, label] of [['apiKeyEnc', 'API Key'], ['githubToken', 'GitHub Token']]) {
      const stored = c[field]
      if (typeof stored === 'string' && stored.startsWith('plain:')) {
        const plain = field === 'apiKeyEnc' ? store.getApiKey() : (() => { try { return Buffer.from(stored.slice(6), 'base64').toString('utf8') } catch { return null } })()
        if (plain) {
          const r = store.setApiKey ? (field === 'apiKeyEnc' ? store.setApiKey(plain) : (() => { store.setGithubToken(plain); return { ok: true } })()) : { ok: false }
          if (r.ok) log.logInfo(`✔ 检测到明文存储的 ${label},已自动迁移为系统加密`)
          else log.logWarn(`明文 ${label} 迁移失败: ${r.error}`)
        }
      }
    }
  } catch (e) { log.logWarn(`密钥迁移检查失败: ${e.message}`) }

  registerIpc()
  createWindow()

  // 截图模式(app --screenshots):生成各视图截图到 docs/screenshots 后退出
  if (process.argv.includes('--screenshots')) {
    setTimeout(async () => {
      const fs = require('node:fs')
      const outDir = path.join(__dirname, 'docs', 'screenshots')
      fs.mkdirSync(outDir, { recursive: true })
      const views = ['overview', 'plugins', 'diagnose']
      await new Promise((r) => setTimeout(r, 3000))
      for (const v of views) {
        try {
          await mainWindow.webContents.executeJavaScript(`window.__switchView && window.__switchView('${v}')`)
          await new Promise((r) => setTimeout(r, 1600))
          const img = await mainWindow.webContents.capturePage()
          fs.writeFileSync(path.join(outDir, v + '.png'), img.toPNG())
          log.logInfo(`截图完成: ${v}.png`)
        } catch (e) { log.logWarn(`截图 ${v} 失败: ${e.message}`) }
      }
      app.exit(0)
    }, 100)
    return
  }

  trayHandle = trayMod.createTray({
    onStart: async () => {
      const r = await status.start('web', { onLog: (l) => { log.logInfo(l); broadcast('log:line', l) } })
      if (!r.ok) log.logWarn(`托盘启动 web 失败: ${r.error}`)
    },
    onStop: async () => {
      const names = (await status.snapshot()).filter((s) => s.running).map((s) => s.name)
      for (const n of names) await status.stop(n, { force: false })
    },
    onShow: showWindow,
    onResetWindow: resetWindow,
    onReloadUi: reloadUi,
    onSoftwareRestart: restartWithSoftwareRendering,
    onQuit: () => app.quit(),
    isAnyRunning: () => lastStatusJson.includes('"running":true'),
  })

  statusTimer = setInterval(pollStatus, store.getSettings().pollIntervalMs || 2000)
  pollStatus()

  // 全局快捷键之外的手动恢复入口:渲染层也可调
  ipcMain.handle('window:reset', () => { resetWindow(); return { ok: true } })
  ipcMain.handle('window:reload', () => { reloadUi(); return { ok: true } })
  ipcMain.handle('window:software-restart', () => { restartWithSoftwareRendering(); return { ok: true } })
  ipcMain.handle('window:info', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false }
    const b = mainWindow.getBounds()
    return {
      ok: true, bounds: b, sane: boundsAreSane(b), visible: mainWindow.isVisible(), minimized: mainWindow.isMinimized(),
      softwareRendering: Boolean(SOFTWARE_RENDERING), softwareSource: SOFTWARE_RENDERING,
    }
  })

  app.on('before-quit', async (e) => {
    if (quitting) return
    e.preventDefault()
    quitting = true
    if (statusTimer) clearInterval(statusTimer)
    // 默认「退出管理器不停止 harness」:管理器只是控制台,关掉它不该打断正在使用的 DSH 会话
    // (曾经默认 stopAll,导致关闭管理器连带断开 3080 上的会话)。需要旧行为可在设置里打开。
    if (!store.getSettings().stopProfilesOnExit) {
      log.logInfo('退出管理器(保留正在运行的 harness)')
      app.exit(0)
      return
    }
    const running = (await status.snapshot()).filter((s) => s.running && !s.external)
    if (running.length) {
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: 'warning',
        title: '退出管理器',
        message: `仍有 ${running.length} 个 harness 在运行(${running.map((s) => s.name).join(', ')})`,
        detail: '设置里开启了「退出时停止 harness」,退出管理器将停止这些进程。要继续吗?',
        buttons: ['停止并退出', '取消'],
        defaultId: 1,
        cancelId: 1,
      })
      if (choice !== 0) { quitting = false; return }
    }
    await status.stopAll()
    app.exit(0)
  })

  app.on('window-all-closed', () => { /* 托盘常驻,不自动退出 */ })
})
