'use strict'
// 插件来源适配层入口:统一 search,按选中的来源分发
const npm = require('./npm')
const github = require('./github')
const local = require('./local')

async function search(query, selected, { githubToken, insecureGitHub } = {}) {
  const results = []
  const errors = []
  const jobs = []
  if (selected?.npm) {
    jobs.push(npm.search(query).then((r) => results.push(...r)).catch((e) => errors.push({ source: 'npm', error: e.message })))
  }
  if (selected?.github) {
    jobs.push(github.search(query, { token: githubToken, insecure: insecureGitHub }).then((r) => results.push(...r)).catch((e) => errors.push({ source: 'github', error: e.message })))
  }
  if (selected?.local && query) {
    jobs.push(Promise.resolve().then(() => local.search(query)).then((r) => results.push(...r)).catch((e) => errors.push({ source: 'local', error: e.message })))
  }
  if (!jobs.length) return { results: [], errors: [{ source: 'all', error: '未选择任何来源' }] }
  await Promise.all(jobs)
  return { results, errors }
}

module.exports = { search, npm, github, local }
