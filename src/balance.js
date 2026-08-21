'use strict'
// 余额查询(Phase 2):官方接口 + 管理器内加密保存的 API Key
const fs = require('node:fs')
const path = require('node:path')
const yaml = require('js-yaml')
const { getApiKey, setApiKey, hasApiKey } = require('./store')
const { dshHome } = require('./paths')

const BALANCE_URL = 'https://api.deepseek.com/user/balance'

async function getBalance() {
  const key = getApiKey()
  if (!key) return { ok: false, error: '未配置 DeepSeek API Key(请到设置中配置)' }
  let res
  try {
    res = await fetch(BALANCE_URL, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    })
  } catch (e) {
    return { ok: false, error: `请求失败: ${e.message}` }
  }
  if (!res.ok) {
    let detail = ''
    try {
      const j = await res.json()
      detail = j?.error?.message || JSON.stringify(j).slice(0, 200)
    } catch { /* ignore */ }
    return { ok: false, error: `余额接口返回 HTTP ${res.status}${detail ? ' — ' + detail : ''}` }
  }
  let data
  try { data = await res.json() } catch (e) { return { ok: false, error: '响应解析失败' } }
  return { ok: true, data }
}

function summarize(data) {
  if (!data || data.is_available === false) return { available: false }
  const infos = Array.isArray(data.balance_infos) ? data.balance_infos : []
  const total = infos.reduce((s, i) => s + (Number(i.total_balance) || 0), 0)
  return {
    available: true,
    total,
    currency: infos[0]?.currency || 'CNY',
    infos,
  }
}

function importFromDshCredentials() {
  const f = path.join(dshHome, '.credentials.yaml')
  if (!fs.existsSync(f)) return { ok: false, error: `未找到 DSH 凭据文件: ${f}` }
  try {
    const j = yaml.load(fs.readFileSync(f, 'utf8')) || {}
    let key = j.DEEPSEEK_API_KEY || j.deepseek_api_key
    if (!key && typeof j === 'object') {
      const found = Object.values(j).find((v) => typeof v === 'string' && /^sk-[A-Za-z0-9_-]{8,}$/.test(v))
      if (found) key = found
    }
    if (!key) return { ok: false, error: 'DSH 凭据中未找到 API Key 字段' }
    const r = setApiKey(String(key).trim())
    return r.ok ? { ok: true } : r
  } catch (e) {
    return { ok: false, error: `读取失败: ${e.message}` }
  }
}

module.exports = { getBalance, summarize, importFromDshCredentials, setApiKey, hasApiKey }
