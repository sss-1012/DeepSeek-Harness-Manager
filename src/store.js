'use strict'
// 配置存储:~/.dsh-manager/config.json,API Key 用 Electron safeStorage(Windows DPAPI)加密
const fs = require('node:fs')
const { configPath, ensureManagerDirs } = require('./paths')

const DEFAULTS = {
  apiKeyEnc: null, // enc:<base64> 由 safeStorage 加密;plain:<base64> 仅在显式允许时用于测试
  githubToken: null,
  settings: {
    closeToTray: true,
    pollIntervalMs: 2000,
    insecureGitHub: false, // 网络代理/证书拦截环境下,GitHub 请求跳过证书校验
    profiles: {}, // { profileName: { port: null, args: '' } }
  },
}

let cache = null
let safeStorage = null

function initSafeStorage(electronSafeStorage) {
  safeStorage = electronSafeStorage
}

function load() {
  if (cache) return cache
  ensureManagerDirs()
  let raw = {}
  try { raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) } catch { /* 首次运行 */ }
  cache = {
    ...JSON.parse(JSON.stringify(DEFAULTS)),
    ...raw,
    settings: { ...DEFAULTS.settings, ...(raw.settings || {}) },
  }
  return cache
}

function save() {
  ensureManagerDirs()
  try { fs.writeFileSync(configPath, JSON.stringify(cache, null, 2)) } catch (e) { /* 只读环境忽略 */ }
}

function getSettings() { return load().settings }
function setSettings(patch) {
  const c = load()
  c.settings = { ...c.settings, ...patch }
  save()
  return c.settings
}
function getProfileSetting(name) {
  const c = load()
  return { port: null, args: '', ...(c.settings.profiles[name] || {}) }
}
function setProfileSetting(name, patch) {
  const c = load()
  c.settings.profiles = c.settings.profiles || {}
  c.settings.profiles[name] = { port: null, args: '', ...(c.settings.profiles[name] || {}), ...patch }
  save()
  return c.settings.profiles[name]
}

// 加密保存:优先系统凭据(safeStorage/DPAPI);不可用时拒绝明文(除非 DSH_MANAGER_ALLOW_PLAIN=1 用于测试)
function encryptSecret(plain) {
  if (safeStorage && safeStorage.isEncryptionAvailable()) {
    return 'enc:' + safeStorage.encryptString(plain).toString('base64')
  }
  if (process.env.DSH_MANAGER_ALLOW_PLAIN === '1') {
    return 'plain:' + Buffer.from(plain, 'utf8').toString('base64')
  }
  throw new Error('系统加密不可用(safeStorage),已拒绝明文保存密钥')
}
function decryptSecret(stored) {
  if (!stored) return null
  try {
    if (stored.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
    if (stored.startsWith('plain:')) return Buffer.from(stored.slice(6), 'base64').toString('utf8')
  } catch { return null }
  return null
}

// 密钥存储加密状态:secure(系统加密)/ plain(明文降级,仅测试)/ none(未保存)
function encryptionStatus() {
  const stored = load().apiKeyEnc
  if (!stored) return 'none'
  if (stored.startsWith('enc:')) return 'secure'
  if (stored.startsWith('plain:')) return 'plain'
  return 'unknown'
}

function setApiKey(key) {
  if (!key) {
    const c = load()
    c.apiKeyEnc = null
    save()
    return { ok: true }
  }
  try {
    const c = load()
    c.apiKeyEnc = encryptSecret(String(key).trim())
    save()
    return { ok: true, encryption: encryptionStatus() }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}
function getApiKey() { return decryptSecret(load().apiKeyEnc) }
function hasApiKey() { return Boolean(getApiKey()) }
function setGithubToken(t) { const c = load(); c.githubToken = t || null; save() }
function getGithubToken() { return load().githubToken || null }

module.exports = {
  initSafeStorage,
  load,
  save,
  getSettings,
  setSettings,
  getProfileSetting,
  setProfileSetting,
  setApiKey,
  getApiKey,
  hasApiKey,
  encryptionStatus,
  setGithubToken,
  getGithubToken,
}
