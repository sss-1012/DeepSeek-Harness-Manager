'use strict'
// 插件来源适配器:GitHub(仓库搜索,可配置 token 提升限额)
// 网络存在代理/证书拦截时,可开启 insecure(跳过证书校验)以正常工作。
// 跳过校验走 node:https(跨 undici 版本稳定);正常路径用全局 fetch。
const https = require('node:https')

function httpsJson(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers, rejectUnauthorized: false }, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => {
        let json = null
        try { json = JSON.parse(data) } catch { /* 非 JSON 响应 */ }
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json })
      })
    })
    req.on('error', reject)
  })
}

async function fetchJson(url, headers, insecure) {
  if (insecure) return httpsJson(url, headers)
  const res = await fetch(url, { headers })
  let json = null
  try { json = await res.json() } catch { /* ignore */ }
  return { ok: res.ok, status: res.status, json }
}

async function search(query, { token, insecure } = {}) {
  const q = query ? `${query} deepseek harness` : 'deepseek harness plugin'
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=30&sort=stars`
  const headers = { 'User-Agent': 'deepseek-harness-manager', Accept: 'application/vnd.github+json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetchJson(url, headers, insecure)
  if (!res.ok) throw new Error(`GitHub 搜索失败(HTTP ${res.status}${res.status === 403 ? ',未配置 token 可能超出限额' : ''})`)
  const data = res.json || {}
  return (data.items || []).map((r) => ({
    source: 'github',
    name: r.full_name,
    version: r.default_branch || 'HEAD',
    description: (r.description || '').slice(0, 300),
    meta: { stars: r.stargazers_count, url: r.html_url, updated: r.updated_at },
  }))
}

async function getPackageJson(repo, { insecure } = {}) {
  const clean = repo.replace(/^github:/, '').replace(/^https?:\/\/github\.com\//, '').replace(/#.*$/, '').replace(/\.git$/, '')
  const [owner, name] = clean.split('/')
  const url = `https://raw.githubusercontent.com/${owner}/${name}/HEAD/package.json`
  const res = await fetchJson(url, { 'User-Agent': 'deepseek-harness-manager' }, insecure)
  if (!res.ok) throw new Error(`获取 ${repo} package.json 失败(HTTP ${res.status})`)
  return res.json || {}
}

module.exports = { search, getPackageJson }
