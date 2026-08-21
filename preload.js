'use strict'
// preload:通过 contextBridge 暴露白名单 API 给渲染进程
const { contextBridge, ipcRenderer } = require('electron')

const api = {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  // ---- 基础 ----
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  getProfile: (name) => ipcRenderer.invoke('profile:get', name),
  startProfile: (name, opts) => ipcRenderer.invoke('profile:start', name, opts),
  stopProfile: (name, opts) => ipcRenderer.invoke('profile:stop', name, opts),
  createProfile: (name) => ipcRenderer.invoke('profile:create', name),
  removeProfile: (name) => ipcRenderer.invoke('profile:remove', name),
  // ---- 插件 ----
  listPlugins: (profile) => ipcRenderer.invoke('plugins:list', profile),
  setPluginEnabled: (profile, id, enabled) => ipcRenderer.invoke('plugins:setEnabled', profile, id, enabled),
  uninstallPlugin: (profile, pkg) => ipcRenderer.invoke('plugins:uninstall', profile, pkg),
  searchPlugins: (query, selected) => ipcRenderer.invoke('plugins:search', query, selected),
  resolveDeps: (spec) => ipcRenderer.invoke('plugins:resolveDeps', spec),
  installPlugin: (profile, spec, opts) => ipcRenderer.invoke('plugins:install', profile, spec, opts),
  updatePlugin: (profile, pkg) => ipcRenderer.invoke('plugins:update', profile, pkg),
  pluginDetail: (pkg) => ipcRenderer.invoke('plugins:detail', pkg),
  // ---- 历史 / 诊断 / 更新 ----
  listHistory: (profile) => ipcRenderer.invoke('history:list', profile),
  runDiagnostics: () => ipcRenderer.invoke('diagnose:run'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  doUpdate: () => ipcRenderer.invoke('update:do'),
  listBackups: () => ipcRenderer.invoke('update:backups'),
  rollback: (id) => ipcRenderer.invoke('update:rollback', id),
  // ---- 设置 ----
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  setProfileSetting: (name, patch) => ipcRenderer.invoke('settings:profile', name, patch),
  getGithubToken: () => ipcRenderer.invoke('github:token'),
  setGithubToken: (t) => ipcRenderer.invoke('github:setToken', t),
  // ---- 余额 ----
  getBalance: () => ipcRenderer.invoke('balance:get'),
  setApiKey: (key) => ipcRenderer.invoke('balance:setKey', key),
  hasApiKey: () => ipcRenderer.invoke('balance:hasKey'),
  importDshKey: () => ipcRenderer.invoke('balance:importDsh'),
  // ---- 环境 ----
  envCheck: () => ipcRenderer.invoke('env:check'),
  envInstallDsh: () => ipcRenderer.invoke('env:installDsh'),
  envInstallNode: () => ipcRenderer.invoke('env:installNode'),
  envInstallNpm: () => ipcRenderer.invoke('env:installNpm'),
  envUpdateDsh: () => ipcRenderer.invoke('env:updateDsh'),
  envUninstallDsh: () => ipcRenderer.invoke('env:uninstallDsh'),
  envUninstallPnpm: () => ipcRenderer.invoke('env:uninstallPnpm'),
  envUninstallNode: () => ipcRenderer.invoke('env:uninstallNode'),
  // ---- 日志 / 系统 ----
  logTail: () => ipcRenderer.invoke('logs:tail'),
  openPath: (p) => ipcRenderer.invoke('open:path', p),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  // ---- 事件订阅 ----
  onStatus: (cb) => { ipcRenderer.on('status:changed', (_e, d) => cb(d)) },
  onLog: (cb) => { ipcRenderer.on('log:line', (_e, d) => cb(d)) },
  onUpdateProgress: (cb) => { ipcRenderer.on('update:progress', (_e, d) => cb(d)) },
  onProfileFailed: (cb) => { ipcRenderer.on('profile:failed', (_e, d) => cb(d)) },
}

contextBridge.exposeInMainWorld('dshm', api)
