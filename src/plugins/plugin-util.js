'use strict'
// 插件识别启发式:DSH 生态插件包名特征
const PLUGIN_HINT = /^(dsh-|cordis-plugin-|@deepseek-ai\/(dsh-|cordis-plugin)|@open-design\/)/

function isPluginLike(name) {
  if (typeof name !== 'string') return false
  return PLUGIN_HINT.test(name) || /dsh/i.test(name)
}

module.exports = { isPluginLike, PLUGIN_HINT }
