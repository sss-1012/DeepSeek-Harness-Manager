'use strict'
// 插件来源适配器:npm registry
const REGISTRY = 'https://registry.npmjs.org'

async function search(query) {
  const text = query ? query : 'scope:@deepseek-ai'
  const url = `${REGISTRY}/-/v1/search?text=${encodeURIComponent(text)}&size=40`
  const res = await fetch(url, { headers: { 'User-Agent': 'deepseek-harness-manager' } })
  if (!res.ok) throw new Error(`npm 搜索失败(HTTP ${res.status})`)
  const data = await res.json()
  return (data.objects || []).map((o) => {
    const p = o.package
    const popularity = o.score?.detail?.popularity || 0
    return {
      source: 'npm',
      name: p.name,
      version: p.version,
      description: p.description || '',
      meta: {
        author: p.publisher?.username || p.author?.name || '',
        downloads: Math.round(popularity * 1e7),
        date: p.date,
      },
    }
  })
}

async function getPackageJson(name) {
  const res = await fetch(`${REGISTRY}/${encodeURIComponent(name).replace(/%2F/g, '/')}/latest`, {
    headers: { 'User-Agent': 'deepseek-harness-manager' },
  })
  if (!res.ok) throw new Error(`获取 ${name} 信息失败(HTTP ${res.status})`)
  return res.json()
}

// 解析 npm 规格:@scope/name@version / name@version / name
function parseSpec(spec) {
  let s = spec.trim()
  if (s.startsWith('npm:')) s = s.slice(4)
  let name, version
  if (s.startsWith('@')) {
    const m = s.match(/^(@[^/]+\/[^@]+)(?:@(.+))?$/)
    if (!m) return null
    name = m[1]; version = m[2] || null
  } else {
    const m = s.match(/^([^@]+)(?:@(.+))?$/)
    if (!m) return null
    name = m[1]; version = m[2] || null
  }
  return { name, version }
}

module.exports = { search, getPackageJson, parseSpec }
