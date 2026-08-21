'use strict'
// 日志:内存环形缓冲(推送到界面)+ 文件落盘
const fs = require('node:fs')
const path = require('node:path')
const { managerDirs } = require('./paths')

const MAX_LINES = 2000
const buffer = []
let listeners = []
let logFile = null

function initLog() {
  try {
    fs.mkdirSync(managerDirs.logs, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    logFile = path.join(managerDirs.logs, `manager-${stamp}.log`)
  } catch { logFile = null }
}

function onLogLine(cb) { listeners.push(cb) }

function log(level, msg) {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}`
  buffer.push(line)
  if (buffer.length > MAX_LINES) buffer.shift()
  if (logFile) { try { fs.appendFileSync(logFile, line + '\n') } catch { /* ignore */ } }
  for (const cb of listeners) { try { cb(line) } catch { /* ignore */ } }
}

const logInfo = (m) => log('INFO', m)
const logWarn = (m) => log('WARN', m)
const logError = (m) => log('ERROR', m)

function tail(n = 500) { return buffer.slice(-n) }

module.exports = { initLog, onLogLine, log, logInfo, logWarn, logError, tail }
