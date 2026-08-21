'use strict'
// 更新模块:版本检测 / 更新前备份 / 全局更新 / 回滚
const fs = require('node:fs')
const path = require('node:path')
const semver = require('semver')
const { managerDirs, profilesDir } = require('./paths')
const { version } = require('./dsh')
const { listProfiles } = require('./profiles')
const { execTool } = require('./tool')

function execFileAsync(cmd, args, opts = {}) {
  return execTool(cmd, args, opts)
}

async function checkUpdate() {
  const current = await version()
  let latest = null
  let error = null
  try {
    const r = await execFileAsync('npm', ['view', '@deepseek-ai/dsh', 'version'], { timeout: 30000 })
    latest = r.ok ? r.stdout.trim() : null
    if (!r.ok) error = r.stderr || r.error
  } catch (e) { error = e.message }
  let hasUpdate = false
  if (current && latest && semver.valid(current) && semver.valid(latest)) {
    hasUpdate = semver.lt(current, latest)
  }
  return { current, latest, hasUpdate, error }
}

async function createBackup() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const dir = path.join(managerDirs.backups, stamp)
  fs.mkdirSync(dir, { recursive: true })
  const v = await version()
  fs.writeFileSync(path.join(dir, 'dsh-version.txt'), v || 'unknown')
  const manifest = { version: v, createdAt: new Date().toISOString(), profiles: [] }
  for (const p of listProfiles()) {
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
  return { id: stamp, dir, version: v }
}

async function doUpdate(onProgress) {
  onProgress?.('开始更新 @deepseek-ai/dsh ...')
  const backup = await createBackup()
  onProgress?.(`✔ 已备份到 ${backup.dir}`)
  const r = await execFileAsync('npm', ['install', '-g', '@deepseek-ai/dsh@latest'], { timeout: 600000 })
  if (!r.ok) {
    onProgress?.(`✘ 更新失败: ${(r.stderr || r.error || '').slice(0, 500)}`)
    return { ok: false, backup, error: r.stderr || r.error }
  }
  const v = await version()
  onProgress?.(`✔ 更新完成,当前版本: ${v}`)
  return { ok: true, backup, version: v }
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

async function rollback(id) {
  const backup = listBackups().find((b) => b.id === id)
  if (!backup) return { ok: false, error: '未找到该备份' }
  const oldVersion = backup.version === '?' || backup.version === 'unknown' ? null : backup.version
  if (!oldVersion) return { ok: false, error: '备份中缺少版本号,无法回滚' }
  const r = await execFileAsync('npm', ['install', '-g', `@deepseek-ai/dsh@${oldVersion}`], { timeout: 600000 })
  if (!r.ok) return { ok: false, error: r.stderr || r.error }
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(backup.dir, 'manifest.json'), 'utf8'))
    for (const p of manifest.profiles || []) {
      const dir = path.join(profilesDir, p.name)
      if (p.packageJson != null) fs.writeFileSync(path.join(dir, 'package.json'), p.packageJson)
      if (p.cordisPatch != null) fs.writeFileSync(path.join(dir, 'cordis.patch.yml'), p.cordisPatch)
      if (p.cordis != null) fs.writeFileSync(path.join(dir, 'cordis.yml'), p.cordis)
    }
  } catch (e) {
    return { ok: true, warning: `版本已回滚,但 profile 配置恢复失败: ${e.message}`, version: oldVersion }
  }
  const v = await version()
  return { ok: true, version: v }
}

module.exports = { checkUpdate, createBackup, doUpdate, listBackups, rollback }
