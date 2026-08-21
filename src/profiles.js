'use strict'
// profile 扫描与信息读取:~/.dsh/profiles/<name>/
const fs = require('node:fs')
const path = require('node:path')
const { profilesDir, profileDir } = require('./paths')

function isValidProfile(name) {
  if (!/^[\w.-]+$/.test(name)) return false
  const pkgPath = path.join(profileDir(name), 'package.json')
  if (!fs.existsSync(pkgPath)) return false
  try {
    const j = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    return j && typeof j === 'object'
  } catch { return false }
}

function readPackageJson(name) {
  try { return JSON.parse(fs.readFileSync(path.join(profileDir(name), 'package.json'), 'utf8')) } catch { return {} }
}

function profileInfo(name) {
  const dir = profileDir(name)
  const pkg = readPackageJson(name)
  const bundles = Array.isArray(pkg.dsh?.profile?.bundles) ? pkg.dsh.profile.bundles : []
  const dependencies = pkg.dependencies || {}
  const type = bundles.some((b) => b === '@deepseek-ai/dsh-web-app' || /^@deepseek-ai\/dsh-web/.test(b)) ? 'web' : 'custom'
  return {
    name,
    dir,
    type,
    bundles,
    dependencies,
    exists: fs.existsSync(dir),
    pkg,
  }
}

function listProfiles() {
  if (!fs.existsSync(profilesDir)) return []
  return fs.readdirSync(profilesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter(isValidProfile)
    .map(profileInfo)
}

function readFileText(name, file) {
  try { return fs.readFileSync(path.join(profileDir(name), file), 'utf8') } catch { return null }
}

function createProfile(name) {
  if (!/^[\w.-]+$/.test(name)) throw new Error('profile 名称只能包含字母、数字、_ - .')
  const dir = profileDir(name)
  if (fs.existsSync(dir)) throw new Error(`profile「${name}」已存在`)
  fs.mkdirSync(dir, { recursive: true })
  const pkg = {
    name: `dsh-profile-${name}`,
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: [] } },
  }
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2))
  fs.writeFileSync(path.join(dir, 'cordis.yml'), '# dsh profile root — edit cordis.patch.yml, not this file.\n[]\n')
  fs.writeFileSync(path.join(dir, 'cordis.patch.yml'), '# Your patch layer for this dsh profile.\n[]\n')
  fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - "."\n')
  return profileInfo(name)
}

function removeProfile(name) {
  const dir = profileDir(name)
  if (!fs.existsSync(dir)) return false
  fs.rmSync(dir, { recursive: true, force: true })
  return true
}

module.exports = { listProfiles, profileInfo, readPackageJson, readFileText, createProfile, removeProfile, isValidProfile }
