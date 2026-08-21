'use strict'
// 管理器自有的启停状态补丁(不修改 profile 原文件):
// ~/.dsh-manager/plugins/<profile>/overrides/state.yml
// 启动 profile 时通过 --patch 注入;npm update 覆盖配置不影响本状态。
const fs = require('node:fs')
const yaml = require('js-yaml')
const { overridesDir, statePatchPath } = require('./paths')

const HEADER = '# managed by deepseek-harness-manager — 启停状态,启动时经 --patch 注入。请勿手改。\n'

function ensureOverrides(profile) {
  fs.mkdirSync(overridesDir(profile), { recursive: true })
  const f = statePatchPath(profile)
  if (!fs.existsSync(f)) {
    fs.writeFileSync(f, HEADER + '[]\n')
  }
  return f
}

function readState(profile) {
  ensureOverrides(profile)
  try {
    const v = yaml.load(fs.readFileSync(statePatchPath(profile), 'utf8'))
    return Array.isArray(v) ? v.filter((e) => e && typeof e === 'object') : []
  } catch { return [] }
}

function writeState(profile, entries) {
  ensureOverrides(profile)
  fs.writeFileSync(statePatchPath(profile), HEADER + yaml.dump(entries || []))
}

// 返回所有被禁用的条目 id(bundle 条目 id 即 bundle 包名)
function disabledIds(profile) {
  return readState(profile).filter((e) => e.id && e.disabled === true).map((e) => e.id)
}

function setEnabled(profile, id, enabled) {
  const entries = readState(profile).filter((e) => !(e && e.id === id))
  if (!enabled) entries.push({ id, disabled: true })
  writeState(profile, entries)
  return entries
}

module.exports = { ensureOverrides, readState, writeState, disabledIds, setEnabled, statePatchPath }
