'use strict'
// 路径集中管理:DSH 目录 / 管理器数据目录均可通过环境变量覆盖(便于测试)
const os = require('node:os')
const path = require('node:path')

const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const managerHome = process.env.DSH_MANAGER_HOME || path.join(os.homedir(), '.dsh-manager')

const managerDirs = {
  plugins: path.join(managerHome, 'plugins'),
  history: path.join(managerHome, 'history'),
  backups: path.join(managerHome, 'backups'),
  reports: path.join(managerHome, 'reports'),
  logs: path.join(managerHome, 'logs'),
}

const configPath = path.join(managerHome, 'config.json')
const profilesDir = path.join(dshHome, 'profiles')

function profileDir(name) {
  return path.join(profilesDir, name)
}
function overridesDir(profile) {
  return path.join(managerDirs.plugins, profile, 'overrides')
}
function statePatchPath(profile) {
  return path.join(overridesDir(profile), 'state.yml')
}
function ensureManagerDirs() {
  for (const d of Object.values(managerDirs)) {
    try { require('node:fs').mkdirSync(d, { recursive: true }) } catch { /* ignore */ }
  }
}

module.exports = {
  dshHome,
  managerHome,
  managerDirs,
  configPath,
  profilesDir,
  profileDir,
  overridesDir,
  statePatchPath,
  ensureManagerDirs,
}
