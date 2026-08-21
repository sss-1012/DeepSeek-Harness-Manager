'use strict'
// DeepSeek Harness 管理器 — Electron 主进程
const path = require('node:path')
const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell, nativeImage } = require('electron')

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
const status = require('./src/status')
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

function showWindow() {
  if (mainWindow) { mainWindow.show(); mainWindow.focus() }
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
    if (await status.isRunning(name)) return { ok: false, error: `「${name}」已在运行` }
    return status.start(name, {
      args: opts.args || [],
      onLog: (line) => { log.logInfo(line); broadcast('log:line', line) },
      onEarlyExit: (info) => {
        const msg = `profile「${name}」启动失败(退出码 ${info.code}): ${info.lines}`
        log.logWarn(msg)
        broadcast('profile:failed', { profile: name, code: info.code, lines: info.lines })
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
    overrides.setEnabled(profile, id, enabled)
    log.logInfo(`插件 ${enabled ? '启用' : '禁用'}: ${profile} / ${id}`)
    const running = await status.isRunning(profile)
    return { ok: true, disabledIds: overrides.disabledIds(profile), needRestart: running }
  })

  ipcMain.handle('plugins:uninstall', async (_e, profile, pkg) => {
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
    return plugins.installWithDeps(profile, spec, {
      withDeps: opts.withDeps !== false,
      onLog: (line) => { log.logInfo(line); broadcast('log:line', line) },
    })
  })

  ipcMain.handle('plugins:update', async (_e, profile, pkg) => {
    log.logInfo(`更新插件: ${profile} / ${pkg}`)
    return plugins.update(profile, pkg)
  })

  ipcMain.handle('plugins:detail', async (_e, pkg) => {
    return { url: await plugins.resolveDetailUrl(pkg) }
  })

  // ---- 历史 / 诊断 / 更新 ----
  ipcMain.handle('history:list', (_e, profile) => history.listHistory(profile))

  ipcMain.handle('diagnose:run', async () => {
    const r = await diagnose.runDiagnostics()
    log.logInfo(`诊断完成: ${r.checks.filter((c) => c.status === 'error').length} 错误, ${r.checks.filter((c) => c.status === 'warn').length} 警告`)
    return r
  })

  ipcMain.handle('update:check', () => update.checkUpdate())

  ipcMain.handle('update:do', async () => {
    return update.doUpdate((msg) => { log.logInfo(msg); broadcast('update:progress', msg) })
  })

  ipcMain.handle('update:backups', () => update.listBackups())

  ipcMain.handle('update:rollback', async (_e, id) => {
    log.logInfo(`回滚到备份: ${id}`)
    return update.rollback(id)
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
    onQuit: () => app.quit(),
    isAnyRunning: () => lastStatusJson.includes('"running":true'),
  })

  statusTimer = setInterval(pollStatus, store.getSettings().pollIntervalMs || 2000)
  pollStatus()

  app.on('before-quit', async (e) => {
    if (quitting) return
    e.preventDefault()
    quitting = true
    if (statusTimer) clearInterval(statusTimer)
    const running = (await status.snapshot()).filter((s) => s.running)
    if (running.length) {
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: 'warning',
        title: '退出管理器',
        message: `仍有 ${running.length} 个 harness 在运行(${running.map((s) => s.name).join(', ')})`,
        detail: '退出管理器将停止这些进程。要继续吗?',
        buttons: ['停止并退出', '取消'],
        defaultId: 0,
        cancelId: 1,
      })
      if (choice !== 0) { quitting = false; return }
    }
    await status.stopAll()
    app.exit(0)
  })

  app.on('window-all-closed', () => { /* 托盘常驻,不自动退出 */ })
})
