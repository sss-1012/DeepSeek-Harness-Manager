// dsh-harness-manager 客户端脚本:在 DSH Web UI 左下角放一个管理器入口。
// 纯浏览器脚本,由宿主以 /dsh-manager/panel.js 提供。
(function () {
  if (window.__dshManagerPanel) return
  window.__dshManagerPanel = true

  var HIDE_KEY = 'dshm.panel.hidden'
  var API = '/dsh-manager'
  var state = null

  function el(tag, style, text) {
    var node = document.createElement(tag)
    if (style) node.setAttribute('style', style)
    if (text != null) node.textContent = text
    return node
  }

  function toast(message) {
    var box = el('div',
      'position:fixed;left:18px;bottom:74px;z-index:2147482000;max-width:320px;' +
      'padding:10px 14px;border-radius:10px;font:13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;' +
      'background:rgba(17,24,39,.94);color:#f9fafb;box-shadow:0 8px 24px rgba(0,0,0,.28);' +
      'opacity:0;transition:opacity .18s ease;pointer-events:none;')
    box.textContent = message
    document.body.appendChild(box)
    requestAnimationFrame(function () { box.style.opacity = '1' })
    setTimeout(function () {
      box.style.opacity = '0'
      setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box) }, 220)
    }, 2600)
  }

  function build(status) {
    var wrap = el('div',
      'position:fixed;left:18px;bottom:18px;z-index:2147482000;display:flex;align-items:center;gap:8px;')
    wrap.id = 'dshm-panel'

    var btn = el('button',
      'display:inline-flex;align-items:center;gap:8px;padding:9px 14px;' +
      'border:1px solid rgba(148,163,184,.45);border-radius:999px;cursor:pointer;' +
      'font:600 13px/1 system-ui,-apple-system,"Segoe UI",sans-serif;' +
      'background:rgba(255,255,255,.94);color:#111827;backdrop-filter:blur(8px);' +
      'box-shadow:0 6px 18px rgba(15,23,42,.16);')
    var dot = el('span',
      'width:8px;height:8px;border-radius:50%;flex:0 0 auto;background:' +
      (status.installed ? '#16a34a' : '#f59e0b') + ';')
    var text = el('span', null, status.installed ? '管理器' : '安装管理器')
    btn.appendChild(dot)
    btn.appendChild(text)

    btn.addEventListener('mouseenter', function () { btn.style.boxShadow = '0 10px 24px rgba(15,23,42,.24)' })
    btn.addEventListener('mouseleave', function () { btn.style.boxShadow = '0 6px 18px rgba(15,23,42,.16)' })

    btn.title = status.installed
      ? '打开 DeepSeek Harness Manager' + (status.version ? ' v' + status.version : '') + '\n' + (status.exe || '')
      : '尚未检测到管理器,点击前往下载'

    btn.addEventListener('click', function () {
      if (!state || !state.installed) {
        window.open((state && state.downloadUrl) || 'https://github.com/sss-1012/DeepSeek-Harness-Manager/releases/latest', '_blank', 'noopener')
        return
      }
      btn.disabled = true
      fetch(API + '/launch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        .then(function (r) { return r.json() })
        .then(function (data) {
          if (data && data.ok) { toast('DeepSeek Harness Manager 已启动'); return }
          if (data && data.code === 'NOT_INSTALLED') {
            state.installed = false
            toast('未找到管理器程序,正在打开下载页')
            window.open((data && data.downloadUrl) || (state && state.downloadUrl) || '', '_blank', 'noopener')
            return
          }
          toast('启动失败:' + ((data && data.error) || '未知错误'))
        })
        .catch(function (err) { toast('启动失败:' + (err && err.message ? err.message : err)) })
        .then(function () { btn.disabled = false })
    })

    var close = el('button',
      'width:26px;height:26px;line-height:1;padding:0;border:1px solid rgba(148,163,184,.45);' +
      'border-radius:50%;cursor:pointer;background:rgba(255,255,255,.9);color:#64748b;' +
      'font:14px/1 system-ui,sans-serif;box-shadow:0 4px 12px rgba(15,23,42,.12);',
      '×')
    close.title = '隐藏(在浏览器控制台执行 localStorage.removeItem("' + HIDE_KEY + '") 可恢复)'
    close.addEventListener('click', function () {
      try { localStorage.setItem(HIDE_KEY, '1') } catch (e) { /* 忽略 */ }
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap)
    })

    wrap.appendChild(btn)
    wrap.appendChild(close)
    return wrap
  }

  function mount(status) {
    state = status
    var old = document.getElementById('dshm-panel')
    if (old && old.parentNode) old.parentNode.removeChild(old)
    document.body.appendChild(build(status))
  }

  function boot() {
    try { if (localStorage.getItem(HIDE_KEY) === '1') return } catch (e) { /* 忽略 */ }
    fetch(API + '/status.json', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json() })
      .then(function (data) { mount(data || { installed: false }) })
      .catch(function () { mount({ installed: false, downloadUrl: 'https://github.com/sss-1012/DeepSeek-Harness-Manager/releases/latest' }) })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()
