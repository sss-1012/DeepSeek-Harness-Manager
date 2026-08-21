'use strict'
// 运行历史:~/.dsh-manager/history/<profile>/history.jsonl
const fs = require('node:fs')
const path = require('node:path')
const { managerDirs } = require('./paths')

function historyFile(profile) {
  const dir = path.join(managerDirs.history, profile)
  try { fs.mkdirSync(dir, { recursive: true }) } catch { /* ignore */ }
  return path.join(dir, 'history.jsonl')
}

function record(profile, entry) {
  const e = { ts: new Date().toISOString(), ...entry }
  try { fs.appendFileSync(historyFile(profile), JSON.stringify(e) + '\n') } catch { /* ignore */ }
  return e
}

function listHistory(profile) {
  try {
    const raw = fs.readFileSync(historyFile(profile), 'utf8').trim()
    if (!raw) return []
    return raw.split('\n')
      .map((l) => { try { return JSON.parse(l) } catch { return null } })
      .filter(Boolean)
      .reverse()
  } catch { return [] }
}

module.exports = { record, listHistory }
