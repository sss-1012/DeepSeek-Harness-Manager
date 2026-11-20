// 渲染层 i18n:从主进程取 { lang, dict },提供 window.t 并把静态标记的文案换成当前语言。
//
// - 中文是源语言:中文模式下 t() 原样返回,t 不触碰任何 DOM,保证中文界面与历史版本一致。
// - 英文模式下,带 data-i18n / data-i18n-html / data-i18n-title / data-i18n-placeholder
//   的节点会被替换;字典里没有的句子保持中文(缺词不报错)。
(function () {
  var state = { lang: 'zh', dict: {} }
  var index = null
  var RELOAD_MARK = 'dshm.i18nReloaded'

  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim() }

  function buildIndex() {
    index = {}
    var dict = state.dict || {}
    for (var k in dict) {
      if (Object.prototype.hasOwnProperty.call(dict, k)) index[norm(k)] = dict[k]
    }
  }

  // t('中文原文', arg0, arg1…) —— 占位符用 {0} {1}
  function t(src) {
    if (state.lang !== 'en') return src
    if (!index) buildIndex()
    var hit = index[norm(src)]
    if (hit === undefined) return src
    for (var i = 1; i < arguments.length; i++) {
      hit = hit.split('{' + (i - 1) + '}').join(String(arguments[i]))
    }
    return hit
  }

  function applyStatic(root) {
    if (state.lang !== 'en') return
    var scope = root || document
    try {
      document.title = t('DeepSeek Harness 管理器')
      document.documentElement.lang = 'en'
    } catch (e) { /* ignore */ }

    var each = function (sel, fn) {
      var list = scope.querySelectorAll(sel)
      for (var i = 0; i < list.length; i++) fn(list[i])
    }
    each('[data-i18n]', function (el) {
      var key = el.getAttribute('data-i18n')
      el.textContent = t(key)
    })
    each('[data-i18n-html]', function (el) {
      el.innerHTML = t(el.getAttribute('data-i18n-html'))
    })
    each('[data-i18n-title]', function (el) {
      el.title = t(el.getAttribute('data-i18n-title'))
    })
    each('[data-i18n-placeholder]', function (el) {
      el.placeholder = t(el.getAttribute('data-i18n-placeholder'))
    })
  }

  function boot() {
    if (!window.dshm || typeof window.dshm.i18n !== 'function') {
      applyStatic(document)
      return
    }
    window.dshm.i18n().then(function (r) {
      state.lang = (r && r.lang) || 'zh'
      state.dict = (r && r.dict) || {}
      index = null
      if (state.lang === 'en') {
        applyStatic(document)
        // 静态文案能就地换,但卡片内容是 app.js 已按中文渲染好的 ——
        // 英文模式下首次进入会重载一次页面,让所有内容从英文状态重新渲染。
        try {
          if (!sessionStorage.getItem(RELOAD_MARK)) {
            sessionStorage.setItem(RELOAD_MARK, '1')
            window.location.reload()
            return
          }
        } catch (e) { /* 无 sessionStorage 时只换静态文案 */ }
      }
    }).catch(function () { /* 取不到语言就保持中文 */ })
  }

  window.t = t
  window.__i18n = {
    applyStatic: applyStatic,
    getLang: function () { return state.lang },
    // 动态插入的 DOM 可以再跑一次静态替换
    refresh: function (root) { applyStatic(root) },
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()
