// dsh-harness-manager 客户端插件入口(官方 client-modules 协议)
//
// 与 lib/panel.js 的关系:
//   panel.js  = 「HTTP 注入」回退路径(宿主用 tapIndex 往 index.html 里插 <script>,仅 web 载体有效)
//   本文件    = 官方 dsh.client 机制(宿主把本文件作为 client bundle 提供,web 载体与官方桌面端壳都能加载)
//   两者用同一个 window.__dshManagerPanel 守卫,先到先得 —— 因此不会出现两个胶囊。
//   ⚠ 改动胶囊外观/行为时,两个文件要同步(它们各自独立,没有构建步骤把它们合并)。
//
// 载体差异:
//   · 浏览器里的 dsh web:能访问宿主注册的 /dsh-manager/* 路由 → 显示实时状态并一键启动管理器
//   · 官方桌面端壳:不提供 webServer(官方已知限制),也不向页面暴露启动外部程序的能力
//     → 胶囊仍会显示,但点击只能打开下载页(诚实降级,不做假象)
window.__ModuleLoader__.load({
  id: 'dsh-harness-manager',
  factory: (require) => {
    const HIDE_KEY = 'dshm.panel.hidden'
    const API = '/dsh-manager'
    const DOWNLOAD_URL = 'https://github.com/sss-1012/DeepSeek-Harness-Manager/releases/latest'

    let state = null // { installed, version, exe, downloadUrl } 或 { hostless: true }
    let wrapEl = null

    function el(tag, style, text) {
      const node = document.createElement(tag)
      if (style) node.setAttribute('style', style)
      if (text != null) node.textContent = text
      return node
    }

    function toast(message) {
      const box = el('div',
        'position:fixed;left:18px;bottom:74px;z-index:2147482000;max-width:320px;' +
        'padding:10px 14px;border-radius:10px;font:13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;' +
        'background:rgba(17,24,39,.94);color:#f9fafb;box-shadow:0 8px 24px rgba(0,0,0,.28);' +
        'opacity:0;transition:opacity .18s ease;pointer-events:none;')
      box.textContent = message
      document.body.appendChild(box)
      requestAnimationFrame(() => { box.style.opacity = '1' })
      setTimeout(() => {
        box.style.opacity = '0'
        setTimeout(() => { if (box.parentNode) box.parentNode.removeChild(box) }, 220)
      }, 2600)
    }

    function build() {
      const wrap = el('div',
        'position:fixed;left:18px;bottom:18px;z-index:2147482000;display:flex;align-items:center;gap:8px;')
      wrap.id = 'dshm-panel'

      const installed = Boolean(state && state.installed)
      const hostless = Boolean(state && state.hostless)
      const btn = el('button',
        'display:inline-flex;align-items:center;gap:8px;padding:9px 14px;' +
        'border:1px solid rgba(148,163,184,.45);border-radius:999px;cursor:pointer;' +
        'font:600 13px/1 system-ui,-apple-system,"Segoe UI",sans-serif;' +
        'background:rgba(255,255,255,.94);color:#111827;backdrop-filter:blur(8px);' +
        'box-shadow:0 6px 18px rgba(15,23,42,.16);')
      const dot = el('span',
        'width:8px;height:8px;border-radius:50%;flex:0 0 auto;background:' +
        (installed ? '#16a34a' : hostless ? '#94a3b8' : '#f59e0b') + ';')
      btn.appendChild(dot)
      btn.appendChild(el('span', null, installed ? '管理器' : '安装管理器'))

      btn.addEventListener('mouseenter', () => { btn.style.boxShadow = '0 10px 24px rgba(15,23,42,.24)' })
      btn.addEventListener('mouseleave', () => { btn.style.boxShadow = '0 6px 18px rgba(15,23,42,.16)' })

      btn.title = hostless
        ? '当前载体(官方桌面端)不提供本机路由,无法从这里启动管理器\n请用 Windows 开始菜单/任务栏打开 DeepSeek Harness Manager\n点击可前往下载页'
        : installed
          ? '打开 DeepSeek Harness Manager' + (state.version ? ' v' + state.version : '') + '\n' + (state.exe || '')
          : '尚未检测到管理器,点击前往下载'

      btn.addEventListener('click', () => {
        const url = (state && state.downloadUrl) || DOWNLOAD_URL
        if (hostless || !state || !state.installed) {
          window.open(url, '_blank', 'noopener')
          if (hostless) toast('官方桌面端内无法启动外部程序,已打开下载页;请从 Windows 任务栏打开管理器')
          return
        }
        btn.disabled = true
        fetch(API + '/launch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
          .then((r) => r.json())
          .then((data) => {
            if (data && data.ok) { toast('DeepSeek Harness Manager 已启动'); return }
            if (data && data.code === 'NOT_INSTALLED') {
              state.installed = false
              toast('未找到管理器程序,正在打开下载页')
              window.open((data && data.downloadUrl) || url, '_blank', 'noopener')
              return
            }
            toast('启动失败:' + ((data && data.error) || '未知错误'))
          })
          .catch((err) => { toast('启动失败:' + (err && err.message ? err.message : err)) })
          .then(() => { btn.disabled = false })
      })

      const close = el('button',
        'width:26px;height:26px;line-height:1;padding:0;border:1px solid rgba(148,163,184,.45);' +
        'border-radius:50%;cursor:pointer;background:rgba(255,255,255,.9);color:#64748b;' +
        'font:14px/1 system-ui,sans-serif;box-shadow:0 4px 12px rgba(15,23,42,.12);',
        '×')
      close.title = '隐藏(在控制台执行 localStorage.removeItem("' + HIDE_KEY + '") 可恢复)'
      close.addEventListener('click', () => {
        try { localStorage.setItem(HIDE_KEY, '1') } catch { /* 忽略 */ }
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap)
      })

      wrap.appendChild(btn)
      wrap.appendChild(close)
      return wrap
    }

    function remove() {
      if (wrapEl && wrapEl.parentNode) wrapEl.parentNode.removeChild(wrapEl)
      wrapEl = null
    }

    function mount() {
      const old = document.getElementById('dshm-panel')
      if (old && old.parentNode) old.parentNode.removeChild(old)
      wrapEl = build()
      document.body.appendChild(wrapEl)
    }

    function boot() {
      let hidden = false
      try { hidden = localStorage.getItem(HIDE_KEY) === '1' } catch { /* 忽略 */ }
      if (hidden) return
      fetch(API + '/status.json', { headers: { Accept: 'application/json' } })
        .then((r) => {
          if (!r.ok) throw new Error('HTTP ' + r.status)
          return r.json()
        })
        .then((data) => { state = data || { installed: false }; mount() })
        .catch(() => {
          // 没有宿主路由(官方桌面端等载体):降级为"下载页"入口,而不是假装已安装
          state = { hostless: true, installed: false, downloadUrl: DOWNLOAD_URL }
          mount()
        })
    }

    function apply(ctx) {
      if (window.__dshManagerPanel) return // panel.js 已经挂过
      window.__dshManagerPanel = true
      const start = () => {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
        else boot()
      }
      start()
      if (ctx && typeof ctx.effect === 'function') ctx.effect(() => () => remove())
    }

    return { apply, inject: [] }
  },
})
