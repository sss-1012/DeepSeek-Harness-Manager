'use strict'
// 插件来源适配器:本地目录(识别 package.json,以 link: 方式安装)
const fs = require('node:fs')
const path = require('node:path')

function search(dirPath) {
  const pkgPath = path.join(dirPath, 'package.json')
  if (!fs.existsSync(pkgPath)) throw new Error(`该目录没有 package.json:${dirPath}`)
  let j
  try { j = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) } catch { throw new Error('package.json 解析失败') }
  return [{
    source: 'local',
    name: j.name || path.basename(dirPath),
    version: j.version || '0.0.0',
    description: j.description || '',
    meta: { path: dirPath },
  }]
}

function getPackageJson(dirPath) {
  return JSON.parse(fs.readFileSync(path.join(dirPath, 'package.json'), 'utf8'))
}

module.exports = { search, getPackageJson }
