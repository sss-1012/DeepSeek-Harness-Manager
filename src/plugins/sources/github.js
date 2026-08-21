'use strict'
// 插件来源适配器:GitHub(仓库搜索,可配置 token 提升限额)
// 网络存在代理/证书拦截时,可开启 insecure(跳过证书校验)以正常工作
const { Agent } = require('undici')

function fetchOpts(insecure) {
  const opts = { headers: { 'User-Agent': 'deepseek-harness-manager', Accept: 'application/vnd.github+json' } }
  if (insecure) {
    opts.dispatcher = new Agent({ connect: { rejectUnauthorized: false } })
  }
  return opts
}

async function search(query, { token, insecure } = {}) {
  const q = query ? `${query} deepseek harness` : 'deepseek harness plugin'
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=30&sort=stars`
  const opts = fetchOpts(insecure)
  if (token) opts.headers.Authorization = `Bearer ${token}`
  const res = await fetch(url, opts)
  if (!res.ok) throw new Error(`GitHub 搜索失败(HTTP ${res.status}${res.status === 403 ? ',未配置 token 可能超出限额' : ''})`)
  const data = await res.json()
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
  const res = await fetch(url, fetchOpts(insecure))
  if (!res.ok) throw new Error(`获取 ${repo} package.json 失败(HTTP ${res.status})`)
  return res.json()
}

module.exports = { search, getPackageJson }
