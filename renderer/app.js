'use strict'
/* DeepSeek Harness 管理器 — 渲染进程逻辑 */
const $ = (sel) => document.querySelector(sel)
const $$ = (sel) => [...document.querySelectorAll(sel)]

const state = {
  bootstrap: null,
  profiles: [],
  launch: { profile: 'web', args: '', port: null },
  updateInfo: null,
  desktop: null,
}

// ---------- 工具 ----------
function toast(msg, type = 'info') {
  const el = document.createElement('div')
  el.className = 'toast'
  el.textContent = msg
  el.style.cssText = 'position:fixed;right:16px;bottom:200px;z-index:999;padding:10px 16px;border-radius:10px;background:#fff;border:1px solid #d9dee8;color:#1e293b;box-shadow:0 4px 18px rgba(15,23,42,.12);font-size:13px;max-width:460px;white-space:pre-wrap'
  if (type === 'error') { el.style.borderColor = '#dc2626'; el.style.color = '#dc2626' }
  if (type === 'ok') el.style.borderColor = '#16a34a'
  document.body.appendChild(el)
  setTimeout(() => el.remove(), type === 'error' ? 6000 : 3500)
}

function modal(title, bodyHtml, buttons) {
  return new Promise((resolve) => {
    const root = $('#modal-root')
    root.innerHTML = `
      <div class="overlay">
        <div class="modal">
          <h3>${title}</h3>
          <div class="modal-body">${bodyHtml}</div>
          <div class="row" style="justify-content:flex-end">
            ${(buttons || [{ label: '取消', value: false, cls: '' }]).map((b) =>
              `<button class="btn ${b.cls || ''}" data-val="${String(b.value)}">${b.label}</button>`).join('')}
          </div>
        </div>
      </div>`
    root.querySelectorAll('.modal .btn').forEach((b) => {
      b.onclick = () => {
        const v = b.dataset.val
        // 先 resolve 再清 DOM:调用方的 .then 需要读弹窗里的表单值。
        // 旧代码先 root.innerHTML = '' 再 resolve,导致 $('#set-tray').checked 全部为 null
        // —— 所有设置项保存都会静默失败(用户报告「点了没反应」的另一个根因)。
        resolve(v === 'true' ? true : v === 'false' ? false : v)
        setTimeout(() => { try { root.innerHTML = '' } catch { /* ignore */ } }, 0)
      }
    })
  })
}


const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// ---------- 初始化 ----------
// 首屏:先用 bootstrap(很快)把界面画出来,慢的东西(更新检查 / 环境探测 / 桌面端探测)全部后台补
// 计时会写进日志:首屏 Xms / 全部数据就绪 Yms —— 以后疑似“变慢了”直接看日志
async function init() {
  const t0 = performance.now()
  // 主题先应用,避免白屏闪一下
  try { applyTheme((state.bootstrap && state.bootstrap.settings && state.bootstrap.settings.theme) || 'system') } catch { /* ignore */ }
  state.bootstrap = await window.dshm.bootstrap()
  state.profiles = state.bootstrap.profiles || []
  $('#dsh-version').textContent = `v${state.bootstrap.dshVersion || '?'}`
  state.launch = { profile: 'web', args: '', port: null, ...(state.bootstrap.settings.launch || {}) }
  renderLaunchPill()

  // 主题(设置里的值优先,支持跟随系统)
  applyTheme(state.bootstrap.settings.theme || 'system')
  state.placeholder = state.bootstrap.settings

  // ---- 事件先订阅,避免错过早期状态 ----
  window.dshm.onStatus((snap) => {
    state.profiles = snap
    if ($('.nav-item.active')?.dataset.view === 'overview') renderOverview()
  })
  window.dshm.onRefresh(() => { try { refreshCurrentView() } catch { /* ignore */ } })
  window.dshm.onThemeChanged((t) => applyTheme(t))
  // 启动后台预检发现问题时提醒(只在真有错误时)
  window.dshm.onCompatIssue((d) => {
    toast(`插件解析预检有问题:${d.summary || ''}`, 'error')
    appendLog(`[启动预检] ${d.summary || ''}`)
  })

  let lastSelfHeal = 0
  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev && ev.reason
    const msg = (reason && (reason.message || String(reason))) || 'unknown'
    appendLog(`[renderer] 未处理的 Promise 拒绝: ${msg}`)
    const now = Date.now()
    if (now - lastSelfHeal > 5000) {
      lastSelfHeal = now
      setTimeout(() => { try { refreshCurrentView() } catch { /* ignore */ } }, 0)
    }
  })
  window.dshm.onLog((line) => appendLog(line))
  window.dshm.onUpdateProgress((evt) => handleUpdateProgress(evt))
  window.dshm.onProfileFailed((d) => {
    const detail = d.summary || d.lines || ''
    toast(`「${d.profile}」启动失败(退出码 ${d.code})\n${detail}`, 'error')
  })
  bindNav()
  bindTopButtons()
  bindOverview()
  bindPlugins()
  bindSearch()
  bindDiagnose()
  bindBalance()
  bindSelfUpdate()
  bindLogBar()

  // 立即出卡片(骨架),不等任何网络/子进程
  refreshCurrentView()
  const firstMs = Math.round(performance.now() - t0)
  appendLog(`[启动] 首屏已渲染 ${firstMs}ms(卡片先出,数据后台补)`)

  // ---- 慢活全部后台进行,不再阻塞首屏 ----
  loadSidePanels().then(() => appendLog(`[启动] 全部数据就绪 ${Math.round(performance.now() - t0)}ms`))
}

// 启动时后台加载的慢数据:桌面端、更新、日志、环境(都有各自的超时/缓存)
async function loadSidePanels() {
  const tasks = [
    (async () => { try { state.desktop = await window.dshm.desktopInfo() } catch { state.desktop = null } refreshCurrentView() })(),
    (async () => { try { await refreshUpdate() } catch { /* ignore */ } })(),
    (async () => { try { const tail = await window.dshm.logTail(); tail.forEach((l) => appendLog(l)) } catch { /* ignore */ } })(),
    (async () => { try { await ensureEnv() } catch { /* ignore */ } })(),
    // 静默检查管理器自身有没有新版(不影响首屏;失败不打扰)
    (async () => {
      try {
        const r = await window.dshm.selfCheck()
        if (r && r.hasUpdate) {
          state.selfInfo = r
          appendLog(`[管理器更新] 发现新版本 v${r.latest}(当前 v${r.current}),可在左侧「更新管理器」里安装`)
          toast(`管理器有新版本 v${r.latest},可在左侧「更新管理器」里升级`, 'ok')
        }
      } catch { /* ignore */ }
    })(),
  ]
  await Promise.allSettled(tasks)
}

// ---- 主题 ----
const THEME_MODES = ['system', 'light', 'dark']
function systemPrefersDark() {
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches } catch { return false }
}
function applyTheme(mode) {
  const m = THEME_MODES.includes(mode) ? mode : 'system'
  state.theme = m
  const dark = m === 'dark' || (m === 'system' && systemPrefersDark())
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.documentElement.dataset.themeMode = m
}
// 跟随系统时,系统切换后界面立即跟着变
try {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => { if ((state.theme || 'system') === 'system') applyTheme('system') }
  if (mq.addEventListener) mq.addEventListener('change', onChange)
  else if (mq.addListener) mq.addListener(onChange)
} catch { /* ignore */ }

// 环境检查:带缓存后端 + 前端复用,避免每次切页都重新 spawn
async function ensureEnv(force = false) {
  if (!force && state.env && Date.now() - (state.envAt || 0) < 30000) return state.env
  state.env = await window.dshm.envCheck()
  state.envAt = Date.now()
  return state.env
}

function renderLaunchPill() {
  $('#launch-pill').textContent = `启动: ${state.launch.profile || '—'}`
}

function bindNav() {
  $$('.nav-item').forEach((b) => {
    b.onclick = () => {
      $$('.nav-item').forEach((x) => x.classList.remove('active'))
      b.classList.add('active')
      $$('.view').forEach((v) => v.classList.remove('active'))
      $(`#view-${b.dataset.view}`).classList.add('active')
      refreshCurrentView()
    }
  })
}

function refreshCurrentView() {
  const active = $('.nav-item.active')?.dataset.view
  if (active === 'overview') renderOverview()
  if (active === 'plugins') renderPlugins()
  if (active === 'self') renderSelfUpdate()
}

// ---------- 管理器自更新 ----------
async function renderSelfUpdate() {
  const info = $('#self-info')
  if (!info) return
  let v
  try { v = await window.dshm.selfVersion() } catch { v = { version: state.bootstrap?.appVersion || '?' } }
  state.selfVersion = v.version
  info.innerHTML = `当前版本 <b>v${esc(v.version)}</b>`
  if (state.selfInfo) applySelfInfo(state.selfInfo)
}

function applySelfInfo(r) {
  state.selfInfo = r
  const info = $('#self-info')
  const dl = $('#btn-self-download')
  const pl = $('#btn-self-portable')
  const notes = $('#self-notes')
  if (!info) return
  if (r.error) {
    info.innerHTML = `当前版本 <b>v${esc(r.current)}</b> · <span style="color:var(--yellow)">检查失败:${esc(r.error)}</span>`
    if (dl) dl.disabled = true
    if (pl) pl.disabled = true
    return
  }
  if (r.hasUpdate) {
    info.innerHTML = `当前 <b>v${esc(r.current)}</b> → 最新 <b style="color:var(--green)">v${esc(r.latest)}</b>`
    if (dl) { dl.disabled = false; dl.textContent = `下载并安装 v${r.latest}` }
    if (pl) pl.disabled = false
  } else {
    info.innerHTML = `当前 <b>v${esc(r.current)}</b> · 已是最新版本`
    if (dl) { dl.disabled = true; dl.textContent = '下载并安装' }
    if (pl) pl.disabled = true
  }
  if (notes && r.notes) notes.textContent = r.notes
}

async function checkSelfUpdate(auto = false) {
  const dl = $('#btn-self-download')
  if (dl && !auto) { dl.disabled = true }
  const r = await window.dshm.selfCheck()
  applySelfInfo(r)
  if (!auto) {
    if (r.error) toast(`检查失败: ${r.error}`, 'error')
    else toast(r.hasUpdate ? `发现管理器新版本 v${r.latest}` : '管理器已是最新版本', r.hasUpdate ? 'ok' : 'ok')
  }
  return r
}

function bindSelfUpdate() {
  const check = $('#btn-self-check')
  if (check) check.onclick = () => checkSelfUpdate(false)
  const rel = $('#btn-self-release')
  if (rel) rel.onclick = () => window.dshm.selfOpenRelease()

  const startDownload = async (kind) => {
    const wrap = $('#self-progress-wrap')
    const bar = $('#self-progress-bar')
    const text = $('#self-progress')
    wrap.hidden = false
    bar.classList.add('indeterminate')
    text.textContent = '正在下载…'
    const r = await window.dshm.selfDownload(kind)
    bar.classList.remove('indeterminate')
    if (!r.ok) { text.textContent = `下载失败:${r.error}`; toast(`下载失败: ${r.error}`, 'error'); return }
    bar.style.width = '100%'
    text.textContent = `已下载 v${r.version}(${(r.size / 1048576).toFixed(1)} MB)`
    const go = await modal('下载完成', `已下载 <b>v${esc(r.version)}</b> ${kind === 'portable' ? '便携版' : '安装版'}。<br><br>` +
      (kind === 'portable'
        ? '便携版不会自动覆盖当前安装,会在下载目录里打开。'
        : '点击「立即安装」后管理器会退出,并运行安装程序完成替换(默认不停止 harness)。'), [
      { label: kind === 'portable' ? '打开文件' : '立即安装', value: true, cls: 'primary' }, { label: '稍后', value: false },
    ])
    if (!go) return
    if (kind === 'portable') { await window.dshm.openPath(r.path); return }
    const ir = await window.dshm.selfInstall(r.path)
    if (!ir.ok) toast(`启动安装程序失败: ${ir.error}`, 'error')
    else toast('安装程序已启动,管理器即将退出…', 'ok')
  }

  const dl = $('#btn-self-download')
  if (dl) dl.onclick = () => startDownload('setup')
  const pl = $('#btn-self-portable')
  if (pl) pl.onclick = () => startDownload('portable')

  window.dshm.onSelfProgress((evt) => {
    const wrap = $('#self-progress-wrap')
    if (!wrap) return
    wrap.hidden = false
    const bar = $('#self-progress-bar')
    if (evt.percent != null) { bar.classList.remove('indeterminate'); bar.style.width = `${evt.percent}%` }
    const text = $('#self-progress')
    if (text) text.textContent = evt.line || text.textContent
  })
}

// ---------- 概览 ----------
// ---------- 自定义下拉(替代原生 select) ----------
// 原生 <select> 的弹层由系统绘制:高度不可控(40+ 个版本会撑成一长条),
// 下方放不下时还会自动向上翻。这里改成 body 级 fixed 弹层:
// 固定 5 行高、超出滚动、始终向下展开(下方太挤就先把按钮滚到视口中部)。
const DD_ROW = 30   // 单行高度,与 style.css 的 .dd-item 保持一致
const DD_ROWS = 5   // 可见行数
let ddOpen = null   // 同时只允许展开一个

function makeDropdown(root, opts = {}) {
  const onChange = opts.onChange || null
  const onOpen = opts.onOpen || null
  let items = Array.isArray(opts.items) ? opts.items.slice() : []
  let value = opts.value || (items[0] ? items[0].value : '')
  let hi = -1
  let placing = false

  root.classList.add('dd')
  root.innerHTML =
    '<button type="button" class="dd-btn" aria-haspopup="listbox" aria-expanded="false">' +
    '<span class="dd-label"></span>' +
    '<svg class="dd-caret" width="10" height="6" viewBox="0 0 10 6" aria-hidden="true">' +
    '<path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' +
    '</button>'
  const btn = root.querySelector('.dd-btn')
  const label = root.querySelector('.dd-label')
  const menu = document.createElement('div')
  menu.className = 'dd-menu'
  menu.setAttribute('role', 'listbox')
  menu.hidden = true
  document.body.appendChild(menu)

  function labelOf(v) {
    const hit = items.find((i) => i.value === v)
    return hit ? hit.label : (items[0] ? items[0].label : '—')
  }
  function render() {
    const text = labelOf(value)
    label.textContent = text
    btn.title = text
    menu.innerHTML = items.map((it, i) => {
      const cls = 'dd-item' + (it.value === value ? ' active' : '') + (i === hi ? ' hi' : '')
      return `<div class="${cls}" role="option" data-v="${esc(it.value)}" aria-selected="${it.value === value}"` +
        `${it.disabled ? ' aria-disabled="true"' : ''}>${esc(it.label)}</div>`
    }).join('')
  }
  function scrollHiIntoView() {
    const el = menu.children[hi]
    if (!el) return
    if (el.offsetTop < menu.scrollTop) menu.scrollTop = el.offsetTop
    else if (el.offsetTop + el.offsetHeight > menu.scrollTop + menu.clientHeight)
      menu.scrollTop = el.offsetTop + el.offsetHeight - menu.clientHeight
  }
  // 定位:永远从按钮下沿往下展开,高度最多 5 行
  function place(retried) {
    const r = btn.getBoundingClientRect()
    const gap = 4
    const space = window.innerHeight - r.bottom - gap - 10
    if (space < DD_ROW * 3 && !retried) {
      placing = true
      try { root.scrollIntoView({ block: 'center' }) } catch { /* ignore */ }
      placing = false
      return place(true)
    }
    const minW = Math.max(r.width, 190)
    const h = Math.max(DD_ROW * 2 + 8, Math.min(DD_ROW * DD_ROWS + 8, space))
    menu.style.maxHeight = `${Math.round(h)}px`
    menu.style.minWidth = `${Math.round(minW)}px`
    menu.style.left = `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - minW - 8)))}px`
    menu.style.top = `${Math.round(r.bottom + gap)}px`
  }
  function open() {
    if (ddOpen && ddOpen !== inst) ddOpen.close()
    if (onOpen) { try { onOpen() } catch { /* ignore */ } }
    const idx = items.findIndex((i) => i.value === value && !i.disabled)
    hi = idx >= 0 ? idx : items.findIndex((i) => !i.disabled)
    render()
    menu.hidden = false
    root.classList.add('open')
    btn.setAttribute('aria-expanded', 'true')
    place(false)
    scrollHiIntoView()
    ddOpen = inst
  }
  function close() {
    if (menu.hidden) return
    menu.hidden = true
    root.classList.remove('open')
    btn.setAttribute('aria-expanded', 'false')
    if (ddOpen === inst) ddOpen = null
  }
  function setValue(v, fire) {
    value = v
    render()
    if (fire && onChange) onChange(v)
  }
  function move(step) {
    if (!items.length) return
    let i = hi
    for (let n = 0; n < items.length; n++) {
      i = (i + step + items.length) % items.length
      if (!items[i].disabled) break
    }
    hi = i
    render()
    scrollHiIntoView()
  }
  btn.onclick = (e) => { e.stopPropagation(); menu.hidden ? open() : close() }
  btn.onkeydown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (menu.hidden) { open(); return }
      move(e.key === 'ArrowDown' ? 1 : -1)
    } else if (e.key === 'Enter' || e.key === ' ') {
      if (!menu.hidden) {
        e.preventDefault()
        const it = items[hi]
        if (it && !it.disabled) { setValue(it.value, true); close() }
      }
    }
  }
  menu.onclick = (e) => {
    const el = e.target.closest('.dd-item')
    if (!el || el.getAttribute('aria-disabled') === 'true') return
    setValue(el.dataset.v, true)
    close()
    btn.focus()
  }
  function onDocDown(e) {
    if (menu.hidden) return
    if (menu.contains(e.target) || root.contains(e.target)) return
    close()
  }
  function onKeyDown(e) {
    if (e.key === 'Escape' && !menu.hidden) { close(); btn.focus() }
  }
  function onViewportChange(e) {
    if (menu.hidden || placing) return
    if (e && e.target && (e.target === menu || menu.contains(e.target))) return
    place(true)
  }
  document.addEventListener('pointerdown', onDocDown, true)
  document.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('resize', onViewportChange)
  window.addEventListener('scroll', onViewportChange, true)

  const inst = {
    el: root,
    getValue: () => value,
    setValue,
    setItems(list, nextValue) {
      items = Array.isArray(list) ? list.slice() : []
      if (nextValue != null) value = nextValue
      if (!items.some((i) => i.value === value)) value = items[0] ? items[0].value : ''
      render()
      if (!menu.hidden) place(true)
    },
    close,
    destroy() {
      close()
      menu.remove()
      document.removeEventListener('pointerdown', onDocDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
    },
  }
  render()
  return inst
}

function bindOverview() {
  // 取消长任务(安装/更新/重装)
  const cancelBtn = $('#btn-cancel-install')
  if (cancelBtn) cancelBtn.onclick = async () => {
    const r = await window.dshm.cancelInstall()
    toast(r.ok ? '已请求取消…' : (r.error || '没有可取消的任务'), r.ok ? 'ok' : 'error')
  }
  $('#btn-do-update').onclick = doUpdate
  ensureVersionDd()   // 先把下拉控件画出来(默认 latest),版本列表等用户点开再拉
  // 按所选版本更新
  const verBtn = $('#btn-update-version')
  if (verBtn) verBtn.onclick = async () => {
    const v = pickedVersion()
    if (!v) return
    return doUpdate()
  }
  // 兼容性检查:先跑快速检查(秒回),用户可再点「深度检查」逐包验证能否加载
  $('#btn-compat-check').onclick = () => runCompatCheck(false, { deep: false })
  const reinst = $('#btn-reinstall-dsh')
  if (reinst) reinst.onclick = async () => {
    const go = await modal('强制重装 dsh CLI',
      '将执行 <code>npm install -g @deepseek-ai/dsh@latest --force</code>。<br>' +
      '适用于:npm 更新被 EBUSY 打断、安装树处于半更新状态、或插件兼容性检查报「全局 dsh 安装不完整」。<br>' +
      '预检会先确认没有 dsh 进程在占用文件。',
      [{ label: '开始重装', value: true, cls: 'primary' }, { label: '取消', value: false }])
    if (!go) return
    resetUpdateProgress()
    const r = await window.dshm.reinstallDsh()
    toast(r.ok ? `重装完成,当前版本 ${r.version}` : `重装失败: ${r.error || r.hint || ''}`, r.ok ? 'ok' : 'error')
    if (r.hint) toast(r.hint, 'error')
    refreshUpdate()
    runCompatCheck(true)
  }
}

// 官方桌面端卡片:显示版本与分工说明
function desktopCard() {
  const d = state.desktop
  if (!d || !d.installed) return null
  const running = d.running === true
  return `
    <div class="card">
      <div class="card-head">
        <h4>🪟 官方桌面端</h4>
        <span class="pill">${esc(d.version || '?')}</span>
      </div>
      <div class="kv">
        <span class="k">状态</span><span class="v"><span class="status-dot ${running ? 'on' : 'off'}"></span> ${d.running === null ? '无法确认' : running ? '运行中' : '未运行'}</span>
        <span class="k">安装位置</span><span class="v" style="word-break:break-all">${esc(d.location || '未记录')}</span>
        <span class="k">自带运行时</span><span class="v">${d.runtime?.node ? `Node ${esc(d.runtime.node)}` : '—'}${d.runtime?.pnpm ? ` · pnpm ${esc(d.runtime.pnpm)}` : ''}</span>
        <span class="k">desktop profile</span><span class="v">${d.profileExists ? '已存在(桌面端独占,管理器只读)' : '尚未创建'}</span>
      </div>
      <button class="btn sm" data-act="open-desktop">打开官方桌面端</button>
      <div class="muted" style="font-size:11px;margin-top:6px">
        分工:官方桌面端自带 dsh/Node/pnpm 运行时并独占 <code>profiles/desktop</code>;管理器负责 CLI / dsh web 侧的
        多 profile、插件、诊断、更新与回滚,不会去启动或修改 desktop profile。
      </div>
    </div>`
}

// 渲染失败时给一张看得见的错误卡片,而不是让卡片区变成空白(否则用户看到的是“所有卡片消失了”)
function renderCardsError(message) {
  const box = $('#status-cards')
  if (!box) return
  box.innerHTML = `<div class="card"><div class="card-head"><h4>⚠ 概览渲染失败</h4></div><div class="muted" style="font-size:12px">${esc(message)}</div><div class="row" style="margin-top:8px;flex-wrap:wrap;gap:6px"><button class="btn sm" id="btn-render-retry">重试</button><button class="btn sm ghost" id="btn-render-reset">重置窗口尺寸</button><button class="btn sm ghost" id="btn-render-reload">重载界面</button><button class="btn sm ghost" id="btn-render-software">以软件渲染重启</button></div><div class="muted" style="font-size:11px;margin-top:6px">若窗口整体空白(连侧边栏也没有),多半是显卡合成问题 —— 直接点「以软件渲染重启」。</div></div>`
  $('#btn-render-retry') && ($('#btn-render-retry').onclick = () => renderOverview())
  $('#btn-render-reset') && ($('#btn-render-reset').onclick = async () => { await window.dshm.resetWindow() })
  $('#btn-render-reload') && ($('#btn-render-reload').onclick = async () => { await window.dshm.reloadUi() })
  $('#btn-render-software') && ($('#btn-render-software').onclick = async () => {
    const ok = await modal('以软件渲染重启', '将关闭硬件加速(GPU)并重启管理器。<br>正在运行的 harness 与 3080 上的会话不受影响。', [
      { label: '重启', value: true, cls: 'primary' }, { label: '取消', value: false },
    ])
    if (ok) await window.dshm.softwareRestart()
  })
}

async function renderOverview() {
  const name = state.launch.profile
  if (!name) return
  let p, settings
  try {
    ;[p, settings] = await Promise.all([window.dshm.getProfile(name), window.dshm.getSettings()])
  } catch (e) {
    renderCardsError(`读取 profile「${name}」信息失败:${e.message}`)
    return
  }
  if (!p || !p.info) {
    renderCardsError(`profile「${name}」信息不可用(可能已被删除,或主进程暂时不可用)`)
    return
  }
  const pset = (settings && settings.profiles && settings.profiles[name]) || {}
  const snap = state.profiles.find((s) => s.name === name)
  const running = snap ? snap.running : false
  const cards = [
    { body: p.info.external ? `
      <div class="card-head">
        <h4>🐳 Harness</h4>
        <span class="pill" style="border-color:rgba(217,119,6,.5);color:#b45309">官方桌面端独占</span>
      </div>
      <div class="kv">
        <span class="k">启动项</span><span class="v">${esc(name)} <span class="tag">${esc(p.info.type)}</span></span>
        <span class="k">状态</span><span class="v"><span class="status-dot ${running ? 'on' : 'off'}"></span> ${snap?.running === null ? '无法确认' : running ? '运行中' : '未运行'}</span>
        <span class="k">bundles</span><span class="v">${p.info.bundles.length} 个</span>
      </div>
      <div class="muted" style="font-size:12px">${esc(p.info.externalReason || '该 profile 由官方桌面端管理')}</div>
      <div class="muted" style="font-size:11px;margin-top:6px">要在官方桌面端里使用 DSH,请从上面的「官方桌面端」卡片打开它;管理器不会启动/停止/改插件。</div>
    ` : `
      <div class="card-head">
        <h4>🐳 Harness</h4>
        <button class="btn sm ghost" data-act="config">⚙ 配置启动项</button>
      </div>
      <div class="kv">
        <span class="k">启动项</span><span class="v">${esc(name)} <span class="tag">${esc(p.info.type)}</span></span>
        <span class="k">状态</span><span class="v"><span class="status-dot ${running ? 'on' : 'off'}"></span> ${running ? '运行中' : '已停止'}</span>
        <span class="k">PID</span><span class="v">${snap?.pid || '-'}</span>
        <span class="k">端口</span><span class="v">${snap?.port || (p.info.type === 'web' ? '3080' : pset.port || '-')}</span>
        <span class="k">bundles</span><span class="v">${p.info.bundles.length} 个</span>
      </div>
      ${running
        ? `<button class="btn danger-ghost" data-act="stop">停止 harness</button>`
        : `<button class="btn primary" data-act="start">启动 harness</button>`}
      ${p.info.type === 'custom' && !running
        ? `<div class="muted" style="font-size:11px;margin-top:6px">💡 命令行型 profile 需在「配置启动项」里填启动参数(如 --probe)</div>`
        : ''}
    ` },
    { body: `
      <div class="card-head"><h4>🖥 DSH 环境</h4></div>
      <div id="env-rows"></div>
      <div id="env-actions"></div>
    ` },
  ]
  const dc = desktopCard()
  if (dc) cards.push({ body: dc })
  $('#status-cards').innerHTML = cards.map((c) => `<div class="card">${c.body}</div>`).join('')

  $('#status-cards').querySelectorAll('[data-act]').forEach((b) => {
    b.onclick = async () => {
      const act = b.dataset.act
      if (act === 'config') { openLaunchConfig(); return }
      if (act === 'open-desktop') {
        const r = await window.dshm.desktopOpen()
        toast(r.ok ? '已打开官方桌面端' : `打开失败: ${r.error || ''}`, r.ok ? 'ok' : 'error')
        return
      }
      if (act === 'start') {
        if (name === 'web') {
          const ok = await modal('启动 web profile', '将启动 dsh web 服务(http://127.0.0.1:3080)。<br>⚠ 注意:web profile 就是当前浏览器正在使用的 DSH GUI 服务。', [
            { label: '启动', value: true, cls: 'primary' }, { label: '取消', value: false },
          ])
          if (!ok) return
        }
        toast('正在启动…')
        const r = await window.dshm.startProfile(name, {})
        if (!r.ok) toast(`启动失败: ${r.error}`, 'error')
        else toast(`已启动 (PID ${r.pid})${r.port ? `, 等待端口 ${r.port} 就绪` : ''}`, 'ok')
      } else {
        const ok = await modal('停止 harness', name === 'web'
          ? '停止 web 会关闭当前浏览器正在使用的 DSH GUI 服务(3080 端口)。确定停止?'
          : `确定停止 profile「${esc(name)}」?`, [
          { label: '停止', value: true, cls: 'primary' }, { label: '取消', value: false },
        ])
        if (!ok) return
        const r = await window.dshm.stopProfile(name, {})
        toast(r.ok ? '已停止' : `停止失败: ${r.error}`, r.ok ? 'ok' : 'error')
      }
    }
  })

  renderEnv()
}

// 环境卡片:先画缓存值(有的话),没有就画占位,数据到了再回填 —— 不再阻塞首屏
async function renderEnv() {
  let r = state.env
  const cached = Boolean(r)
  if (!r) {
    $('#env-rows').innerHTML = `<div class="env-row"><span class="k">环境检测</span><span class="v muted">检测中…</span><span class="acts"></span></div>`
    $('#env-actions').innerHTML = ''
    try { r = await ensureEnv() } catch (e) {
      $('#env-rows').innerHTML = `<div class="env-row"><span class="k">环境检测</span><span class="v" style="color:var(--red)">检测失败:${esc(e.message)}</span><span class="acts"></span></div>`
      return
    }
  }
  const icon = (ok) => ok ? '<span style="color:var(--green)">✓</span>' : '<span style="color:var(--red)">✗</span>'
  const btn = (data, label, cls = 'sm') => `<button class="btn ${cls}" data-env="${data}">${label}</button>`
  const rows = [
    { label: 'Node.js', v: r.node, install: r.node.ok ? null : 'node', uninstall: r.node.ok ? 'node' : null },
    {
      label: 'npm', v: r.npm,
      note: r.npm.bundled ? '(随 Node.js 安装)' : (r.node.ok ? '' : '(需先安装 Node.js)'),
      install: r.npm.needed ? 'npm' : null,
    },
    { label: 'pnpm', v: r.pnpm, uninstall: r.pnpm.ok ? 'pnpm' : null },
    { label: 'dsh CLI', v: r.dsh, install: r.dsh.ok ? null : 'dsh', update: r.dsh.ok ? 'dsh' : null, uninstall: r.dsh.ok ? 'dsh' : null },
  ]
  $('#env-rows').innerHTML = rows.map((row) => {
    const actions = []
    if (!row.v.ok && row.install) actions.push(btn(`install:${row.install}`, '一键安装', 'sm primary'))
    if (row.update && row.v.ok) actions.push(btn(`update:${row.update}`, '更新'))
    if (row.uninstall && row.v.ok) actions.push(btn(`uninstall:${row.uninstall}`, '卸载', 'sm danger-ghost'))
    const display = row.label === 'npm' && row.v.bundled
      ? `已安装`
      : `${icon(row.v.ok)} ${esc(row.v.version || '未安装')}`
    return `<div class="env-row">
      <span class="k">${row.label} ${row.note ? `<span class="muted" style="font-size:11px">${row.note}</span>` : ''}</span>
      <span class="v">${display}</span>
      <span class="acts">${actions.join('')}</span>
    </div>`
  }).join('')
  const footer = r.configured
    ? `<button class="btn" data-env="checkupdate">检查更新</button>`
    : `<span class="muted">环境未就绪,请先安装缺失项</span>`
  $('#env-actions').innerHTML = `<div class="row">${footer}</div>`
  // 行内按钮(一键安装/更新/卸载)与 footer 按钮都要绑定 —— 之前只绑了 #env-actions,
  // 导致卡片里点「一键安装」「卸载」完全没反应(用户报告的问题)
  document.querySelectorAll('#status-cards [data-env]').forEach((b) => {
    b.onclick = async () => {
      const [kind, target] = b.dataset.env.split(':')
      if (kind === 'checkupdate') {
        await refreshUpdate()
        toast(state.updateInfo?.hasUpdate ? `发现新版本 ${state.updateInfo.latest},可到下方更新面板升级` : '已是最新版本', 'ok')
        return
      }
      if (kind === 'uninstall') {
        const names = { node: 'Node.js', pnpm: 'pnpm', dsh: '@deepseek-ai/dsh' }
        const ok = await modal('卸载确认', `将卸载 <b>${names[target]}</b>。${target === 'dsh' ? '<br>⚠ 卸载后管理器将无法启停 harness,需重新一键安装。' : target === 'node' ? '<br>⚠ 卸载 Node.js 会同时移除 npm/pnpm/dsh 的运行环境!' : ''}`, [
          { label: '卸载', value: true, cls: 'primary' }, { label: '取消', value: false },
        ])
        if (!ok) return
        resetUpdateProgress(`正在卸载 ${target}…`)
        const r2 = await window.dshm[`envUninstall${target[0].toUpperCase()}${target.slice(1)}`]()
        setInstallRunning(false)
        toast(r2.ok ? '已卸载' : `卸载失败: ${r2.error}`, r2.ok ? 'ok' : 'error')
      } else {
        // 走进度面板:流式输出 + 心跳 + 可取消(以前只有一句 toast,看起来像没反应)
        const label = kind === 'install' ? `正在安装 ${target}…` : '正在更新 dsh…'
        resetUpdateProgress(label)
        const r2 = kind === 'install'
          ? await window.dshm[`envInstall${target[0].toUpperCase()}${target.slice(1)}`]()
          : await window.dshm.envUpdateDsh()
        setInstallRunning(false)
        if (r2.cancelled) toast('已取消', 'ok')
        else toast(r2.ok ? '完成' : `失败: ${r2.error}`, r2.ok ? 'ok' : 'error')
        // 失败时给一条明路:国内网络常见就是 registry 连不上
        if (!r2.ok && !r2.cancelled && /ECONN|ETIMEDOUT|ENOTFOUND|timeout|network|EAI_AGAIN|socket/i.test(String(r2.error || ''))) {
          const goMirror = await modal('网络连接失败', '连接 npm 官方源失败或超时。<br>可以改用国内镜像(npmmirror)重试。', [
            { label: '改用镜像重试', value: true, cls: 'primary' }, { label: '取消', value: false },
          ])
          if (goMirror) {
            await window.dshm.setSettings({ npmRegistry: 'npmmirror' })
            state.bootstrap.settings = { ...(state.bootstrap.settings || {}), npmRegistry: 'npmmirror' }
            resetUpdateProgress(`${label}(镜像)`)
            const r3 = kind === 'install'
              ? await window.dshm[`envInstall${target[0].toUpperCase()}${target.slice(1)}`]()
              : await window.dshm.envUpdateDsh()
            setInstallRunning(false)
            toast(r3.ok ? '完成(已使用镜像)' : `仍然失败: ${r3.error}`, r3.ok ? 'ok' : 'error')
          }
        }
        state.envAt = 0   // 安装/更新后强制重新探测
      }
      renderEnv()
    }
  })
}

async function openLaunchConfig() {
  const profiles = await window.dshm.listProfiles()
  const s = await window.dshm.getSettings()
  const cur = s.launch || { profile: 'web', args: '', port: null }
  const pset = s.profiles?.[cur.profile] || {}
  const ok = await modal('配置启动项', `
    <div class="row"><span style="width:92px">启动 profile</span>
      <select id="cfg-profile" style="flex:1">
        ${profiles.map((p) => `<option value="${esc(p.name)}" ${p.name === cur.profile ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
      </select>
    </div>
    <div class="row"><span style="width:92px">启动参数</span><input type="text" id="cfg-args" value="${esc(pset.args || '')}" placeholder="命令行型 profile 需要,如 --probe"></div>
    <div class="row"><span style="width:92px">检测端口</span><input type="text" id="cfg-port" value="${esc(pset.port || '')}" placeholder="web 默认 3080;自定义服务填端口"></div>
    <div class="muted">默认 web 启动。保存后概览页 Harness 卡片即管理该 profile。</div>
  `, [{ label: '保存', value: true, cls: 'primary' }, { label: '取消', value: false }])
  if (!ok) return
  const profile = $('#cfg-profile').value
  const args = $('#cfg-args').value.trim()
  const port = Number($('#cfg-port').value.trim()) || null
  await window.dshm.setSettings({ launch: { profile, args, port } })
  await window.dshm.setProfileSetting(profile, { args, port })
  state.launch = { profile, args, port }
  renderLaunchPill()
  toast(`已切换启动项: ${profile}`, 'ok')
  renderOverview()
}

// ---------- 更新 ----------
// 结构化进度:{ phase, percent, line },percent 为 null 时显示不确定进度动画
function handleUpdateProgress(evt) {
  const wrap = $('#update-progress-wrap')
  const bar = $('#update-progress-bar')
  const text = $('#update-progress')
  const logEl = $('#update-log')
  if (!wrap || !bar) return
  wrap.hidden = false
  // 只要还在进行中就显示「取消」——不依赖某一条调用路径手动开关(以前会漏)
  if (evt && typeof evt === 'object' && evt.phase) {
    setInstallRunning(evt.phase !== 'done' && evt.phase !== 'failed')
  } else if (typeof evt === 'string') {
    setInstallRunning(true)
  }
  if (typeof evt === 'string') {
    text.textContent = evt
    logEl.textContent += (logEl.textContent ? '\n' : '') + evt
    return
  }
  if (evt.percent == null) {
    bar.classList.add('indeterminate')
  } else {
    bar.classList.remove('indeterminate')
    bar.style.width = `${Math.max(0, Math.min(100, evt.percent))}%`
  }
  if (evt.heartbeat) {
    // 心跳:只刷新状态行 + 就地替换日志最后一行(不累积刷屏)
    text.textContent = evt.line
    const lines = logEl.textContent.split('\n')
    if (lines.length && lines[lines.length - 1].startsWith('⏳')) {
      lines[lines.length - 1] = evt.line
      logEl.textContent = lines.join('\n')
    }
  } else if (evt.line) {
    text.textContent = evt.line.split('\n')[0]
    logEl.textContent += (logEl.textContent ? '\n' : '') + evt.line
    const lines = logEl.textContent.split('\n')
    if (lines.length > 300) logEl.textContent = lines.slice(-200).join('\n')
    logEl.scrollTop = logEl.scrollHeight
  }
  // 结束态:关掉「取消」按钮,避免用户误以为还能取消
  const phase = typeof evt === 'object' && evt ? evt.phase : null
  if (phase === 'done' || phase === 'failed') setInstallRunning(false)
}

// 运行中显示「取消」按钮:长任务不能没有出口
function setInstallRunning(running) {
  const cancelBtn = $('#btn-cancel-install')
  if (cancelBtn) cancelBtn.hidden = !running
  state.installRunning = Boolean(running)
}

function resetUpdateProgress(label = '准备开始…') {
  $('#update-progress-wrap').hidden = false
  const bar = $('#update-progress-bar')
  bar.classList.add('indeterminate')
  bar.style.width = '0'
  $('#update-progress').textContent = label
  $('#update-log').textContent = ''
  setInstallRunning(true)
}

// 插件解析兼容性:检查 / 一键修复
// 结果分档(见 src/compat.js):ok / profile-only / link-dangling / missing / load-failed / loader-missing
const COMPAT_STATE_TEXT = {
  ok: '正常',
  'profile-only': '仅存在于 profile 内(dsh 0.2.x 可直接解析,无需处理)',
  'link-dangling': '全局联接已断链,需重建',
  missing: '找不到包,需先安装该插件',
  'load-failed': '可解析但加载失败',
  'loader-missing': '全局 dsh 安装不完整(需重装 CLI)',
  unknown: '未知',
}

// 真错误(会导致启动失败)与信息项(仅 profile 内,不影响运行)分开列
function compatIssueLines(all) {
  const lines = []
  for (const p of all.profiles || []) {
    if (p.skipped) continue
    for (const it of p.items || []) {
      if (it.state === 'ok') continue
      const mark = it.severity === 'info' ? 'ℹ' : '✘'
      lines.push(`${mark} ${p.profile} / ${it.name} [${COMPAT_STATE_TEXT[it.state] || it.state}]\n    ${it.detail || ''}${it.loadError ? `\n    ${it.loadError}` : ''}`)
    }
  }
  for (const g of (all.global && all.global.problems) || []) lines.push(`✘ 全局 dsh:${g}`)
  return lines
}

// 兼容性检查:结果直接渲染在面板里(可反复看、可复制),而不是只弹一个 modal
async function runCompatCheck(auto = false, opts = {}) {
  const deep = opts.deep !== false
  const box = $('#compat-results')
  if (box && !auto) box.innerHTML = `<div class="muted">${deep ? '深度检查中(逐包验证能否加载)…' : '快速检查中…'}</div>`
  let r
  try {
    r = await window.dshm.compatCheck({ deep })
  } catch (e) {
    if (box) box.innerHTML = `<div class="warn-box">检查失败:${esc(e.message)}</div>`
    return { ok: false, error: e.message }
  }
  const skipped = (r.profiles || []).filter((p) => p.skipped)
  const bad = (r.profiles || []).filter((p) => !p.ok && !p.skipped)
  const infoCount = (r.profiles || []).reduce((n, p) => n + ((p.infoItems || []).length), 0)
  const globalBroken = !r.global?.ok
  const ok = !bad.length && !globalBroken

  // ---- 汇总 ----
  const errItems = bad.reduce((n, p) => n + ((p.badItems || []).length), 0) + ((r.global?.problems || []).length)
  const summary = ok
    ? `✓ 全部通过${infoCount ? `(${infoCount} 个插件仅在 profile 内,不影响运行)` : ''}${skipped.length ? ` · 跳过 ${skipped.map((p) => p.profile).join('、')}` : ''}`
    : `✘ 发现 ${errItems} 个会导致启动失败的问题${infoCount ? ` · 另有 ${infoCount} 个信息项` : ''}`

  if (box) {
    const groups = []
    for (const p of r.profiles || []) {
      if (p.skipped) continue
      const rows = (p.items || []).filter((it) => it.state !== 'ok')
      if (!rows.length) continue
      groups.push(`<div class="compat-group">${esc(p.profile)} <span class="muted" style="font-weight:400">(${esc(p.type || 'profile')})</span></div>` +
        rows.map((it) => {
          const sev = it.severity === 'info' ? 'info' : 'error'
          const icon = sev === 'info' ? 'ℹ' : '✘'
          return `<div class="compat-item ${sev}">
            <span class="ci-icon">${icon}</span>
            <div class="ci-main">
              <div class="ci-name">${esc(it.name)} <span class="tag ${sev === 'error' ? 'missing' : ''}">${esc(COMPAT_STATE_TEXT[it.state] || it.state)}</span></div>
              ${it.detail ? `<div class="ci-detail">${esc(it.detail)}</div>` : ''}
              ${it.loadError ? `<div class="ci-detail">${esc(it.loadError)}</div>` : ''}
            </div>
          </div>`
        }).join(''))
    }
    for (const g of (r.global && r.global.problems) || []) groups.push(`<div class="compat-item error"><span class="ci-icon">✘</span><div class="ci-main"><div class="ci-name">全局 dsh</div><div class="ci-detail">${esc(g)}</div></div></div>`)

    box.innerHTML = `
      <div class="compat-summary">
        <span class="muted">${esc(summary)}</span>
        <button class="btn sm ghost" id="compat-copy">复制结果</button>
        ${!ok ? `<button class="btn sm primary" id="compat-fix">一键修复</button>` : ''}
        <button class="btn sm ghost" id="compat-deep" ${deep ? 'disabled' : ''}>${deep ? '已深度检查' : '深度检查'}</button>
        ${globalBroken ? `<button class="btn sm ghost" id="compat-reinstall">强制重装 dsh CLI</button>` : ''}
        <button class="btn sm ghost" id="compat-toggle-info" hidden></button>
      </div>
      <div id="compat-body">${groups.length ? groups.join('') : '<div class="muted">没有发现问题。</div>'}</div>`

    const copyBtn = $('#compat-copy')
    if (copyBtn) copyBtn.onclick = async () => {
      const text = [`插件兼容性检查 · ${new Date().toLocaleString()}`, `dsh ${r.global?.version || '?'}`, summary, '', ...compatIssueLines(r)].join('\n')
      try { await navigator.clipboard.writeText(text); toast('结果已复制到剪贴板', 'ok') }
      catch { await modal('检查结果', `<pre class="update-log">${esc(text)}</pre>`, [{ label: '关闭', value: true, cls: 'primary' }]) }
    }
    const fixBtn = $('#compat-fix')
    if (fixBtn) fixBtn.onclick = () => doCompatFix()
    const deepBtn = $('#compat-deep')
    if (deepBtn && !deep) deepBtn.onclick = () => runCompatCheck(false, { deep: true })
    const reBtn = $('#compat-reinstall')
    if (reBtn) reBtn.onclick = async () => {
      const yes = await modal('强制重装 dsh CLI', '将执行 <code>npm install -g @deepseek-ai/dsh@latest</code> 修复安装树。<br>运行中的 harness 会阻塞 npm(EBUSY),需先停。', [
        { label: '重装', value: true, cls: 'primary' }, { label: '取消', value: false },
      ])
      if (!yes) return
      resetUpdateProgress()
      const r2 = await window.dshm.reinstallDsh()
      toast(r2.ok ? `重装完成,当前版本 ${r2.version}` : `重装失败: ${r2.error || ''}`, r2.ok ? 'ok' : 'error')
      refreshUpdate()
      runCompatCheck(false, { deep: true })
    }
  }

  if (ok) {
    if (!auto) toast(`插件解析检查通过 ✓`, 'ok')
    return { ok: true }
  }
  if (auto) return { ok: false, summary }
  // 手动检查时不再弹 modal —— 结果就在面板里,用户可直接点「一键修复」
  return { ok: false, summary }
}

// 一键修复(建目录联接 → 立即复验)
async function doCompatFix() {
  const fixed = await window.dshm.compatFix()
  const okLines = []
  const failLines = []
  for (const x of fixed.results || []) {
    if (x.skipped) { okLines.push(`${x.profile}: 跳过(${x.reason || '外部 profile'})`); continue }
    for (const y of x.results || []) {
      const text = `${x.profile} / ${y.pkg}: ${y.status}${y.verify && y.verify !== 'ok' ? `(复验仍失败:${COMPAT_STATE_TEXT[y.verify] || y.verify})` : ''}`
      if (y.status === 'linked' || y.status === 'ok') okLines.push(text); else failLines.push(text)
    }
  }
  appendLog('[compat] ' + [...okLines, ...failLines].join(' | '))
  if (failLines.length) {
    toast(`修复后仍有 ${failLines.length} 项未通过`, 'error')
    await modal('仍有未通过项', `<pre class="update-log">${esc(failLines.join('\n'))}</pre>`, [{ label: '知道了', value: true, cls: 'primary' }])
  } else {
    toast(`修复完成并复验通过(${okLines.length} 项)✓`, 'ok')
  }
  runCompatCheck(false, { deep: true })
  return { ok: failLines.length === 0 }
}

async function refreshUpdate() {
  $('#update-info').textContent = '检查中…'
  const r = await window.dshm.checkUpdate()
  state.updateInfo = r
  const badge = $('#update-badge')
  if (r.hasUpdate) {
    badge.textContent = `发现新版本 ${r.latest}`
    badge.className = 'pill'
    badge.style.cssText = 'background:rgba(220,38,38,.08);border-color:rgba(220,38,38,.45);color:#dc2626'
    $('#btn-do-update').disabled = false
  } else {
    badge.textContent = '已是最新版本'
    badge.className = 'pill'
    badge.style.cssText = ''
    $('#btn-do-update').disabled = true
  }
  $('#update-info').innerHTML = r.error
    ? `⚠ 检查失败: ${esc(r.error)}`
    : `当前 <b>${esc(r.current || '?')}</b> → 最新 <b>${esc(r.latest || '?')}</b>`
  renderBackups()
  // 版本列表改为懒加载:用户点开下拉时才去 registry 取,
  // 启动时不再白花一次网络往返
}

// 目标版本下拉:列 registry 上的版本(ETARGET 时用来回退到已知可用版本)
let versionOptionsLoadedAt = 0
let versionItems = [{ value: 'latest', label: '最新版(latest)' }]
let versionDd = null

function ensureVersionDd() {
  if (versionDd) return versionDd
  const box = $('#update-version-dd')
  if (!box) return null
  versionDd = makeDropdown(box, { items: versionItems, value: 'latest', onOpen: () => { loadVersionOptions() } })
  return versionDd
}

// 当前选中的目标版本('latest' 表示跟随 latest 标签)
function pickedVersion() {
  return versionDd ? versionDd.getValue() : 'latest'
}

function setVersionItems(items, value) {
  versionItems = items
  const dd = ensureVersionDd()
  if (dd) dd.setItems(items, value)
}

async function loadVersionOptions(force = false) {
  const dd = ensureVersionDd()
  const btn = $('#btn-update-version')
  if (!dd) return
  if (!force && Date.now() - versionOptionsLoadedAt < 60000 && versionItems.length > 1) return
  const hint = $('#update-version-hint')
  const cur = state.updateInfo?.current || ''
  const keep = dd.getValue()
  if (hint) hint.textContent = '正在获取版本列表…'
  try {
    const r = await window.dshm.listVersions()
    const latest = (r && r.distTags && r.distTags.latest) || state.updateInfo?.latest || ''
    if (!r || !r.ok || !r.versions || !r.versions.length) {
      // 拿不到列表:下拉只留「最新版」,并在旁边直接报错(不做其它兜底)
      setVersionItems([{ value: 'latest', label: `最新版 latest${latest ? ` (${latest})` : ''}` }], 'latest')
      if (btn) btn.disabled = false
      if (hint) hint.innerHTML = `<span style="color:var(--yellow)">版本列表获取失败:${esc((r && r.error) || '未知错误')}</span>`
      return
    }
    versionOptionsLoadedAt = Date.now()
    const items = [{ value: 'latest', label: `最新版 latest${latest ? ` (${latest})` : ''}` }]
    for (const v of r.versions) {
      const marks = []
      if (v === latest) marks.push('latest')
      if (v === cur) marks.push('当前')
      items.push({ value: v, label: `${v}${marks.length ? ` (${marks.join(' / ')})` : ''}`, disabled: v === cur })
    }
    setVersionItems(items, keep)
    if (btn) btn.disabled = false
    if (hint) hint.textContent = `共 ${r.versions.length} 个版本${r.via === 'npm' ? '(经 npm 获取)' : ''}`
  } catch (e) {
    if (hint) hint.innerHTML = `<span style="color:var(--yellow)">版本列表获取失败:${esc(e.message)}</span>`
  }
}

// 备份列表:带时间/体积,可逐个删除、可清空;顶部显示保留策略
function fmtTime(ts) {
  if (!ts) return '未知时间'
  const d = new Date(ts)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

async function renderBackups() {
  let stats
  try { stats = await window.dshm.backupStats() } catch (e) { stats = { count: 0, totalMb: 0, items: [] } }
  const s = state.bootstrap?.settings || {}
  const retention = String(s.backupRetention || 'off')
  const retentionText = retention === 'off' ? '关闭(不自动删除)' : `超过 ${retention} 天自动删除(保留最新 1 份)`
  const box = $('#backup-list')
  if (!stats.count) {
    box.className = 'muted'
    box.innerHTML = `<div class="empty-state">暂无备份<br><span style="font-size:11.5px">每次更新/回滚前会自动创建一份</span></div>`
    return
  }
  box.className = ''
  box.innerHTML = `
    <div class="compat-summary">
      <span class="muted">共 <b>${stats.count}</b> 份,占用 <b>${stats.totalMb}</b> MB</span>
      <span class="pill" title="在设置里修改">自动清理:${esc(retentionText)}</span>
      <button class="btn sm ghost" id="btn-prune-backups" ${retention === 'off' ? 'disabled title="请先在设置里开启自动清理"' : ''}>立即清理</button>
      <button class="btn sm ghost danger-ghost" id="btn-clear-backups">清空全部</button>
    </div>
    ${stats.items.map((b) => `
      <div class="backup-row">
        <div class="bk-main">
          <span class="bk-ver">v${esc(b.version || '?')}</span>
          <span class="bk-time">${esc(fmtTime(b.createdAt))}</span>
          <span class="bk-size">${b.sizeMb} MB</span>
          <span class="muted" style="font-size:11px">${esc(b.id)}</span>
        </div>
        <div class="bk-acts">
          <button class="btn sm" data-rollback="${esc(b.id)}">回滚到此版本</button>
          <button class="btn sm ghost danger-ghost" data-delbackup="${esc(b.id)}">删除</button>
        </div>
      </div>`).join('')}`

  const pruneBtn = $('#btn-prune-backups')
  if (pruneBtn) pruneBtn.onclick = async () => {
    const r = await window.dshm.pruneBackups()
    const n = (r.removed || []).length
    toast(r.skipped ? '自动清理当前为关闭,未删除任何备份' : (n ? `已清理 ${n} 份旧备份` : '没有超过保留期的备份'), r.skipped ? 'error' : 'ok')
    renderBackups()
  }
  const clearBtn = $('#btn-clear-backups')
  if (clearBtn) clearBtn.onclick = async () => {
    const ok = await modal('清空全部备份', `将永久删除 <b>${stats.count}</b> 份回滚备份(共 ${stats.totalMb} MB),<br>删除后<b>无法再回滚到旧版本</b>。确定吗?`, [
      { label: '全部删除', value: true, cls: 'primary' }, { label: '取消', value: false },
    ])
    if (!ok) return
    const r = await window.dshm.clearBackups()
    toast(`已删除 ${(r.removed || []).length} 份备份`, 'ok')
    renderBackups()
  }
  box.querySelectorAll('[data-delbackup]').forEach((el) => {
    el.onclick = async () => {
      const id = el.dataset.delbackup
      const ok = await modal('删除备份', `将删除备份 <b>${esc(id)}</b>。<br>删除后无法再用它回滚。`, [
        { label: '删除', value: true, cls: 'primary' }, { label: '取消', value: false },
      ])
      if (!ok) return
      const r = await window.dshm.removeBackup(id)
      toast(r.ok ? '已删除该备份' : `删除失败: ${r.error || ''}`, r.ok ? 'ok' : 'error')
      renderBackups()
    }
  })
  box.querySelectorAll('[data-rollback]').forEach((b) => {
    b.onclick = async () => {
      const choice = await modal('回滚确认', `将全局重装 dsh 到备份 <b>${esc(b.dataset.rollback)}</b> 记录的版本,并恢复各 profile 配置。<br>` +
        `回滚同样会被运行中的 dsh 进程阻塞(npm EBUSY),因此会先做进程预检;官方桌面端独占的 profile 永远不会被写入。`,
        [{ label: '预检并回滚', value: 'pre', cls: 'primary' }, { label: '取消', value: false }])
      if (!choice) return
      const pre = await window.dshm.updatePreflight()
      let stopManaged = false
      if (pre?.blocking) {
        const go = await modal('检测到 dsh 正在运行',
          `以下进程会阻塞回滚(EBUSY):<pre class="update-log">${esc((pre.detail || []).join('\n'))}</pre>是否先停止管理器托管的 profile 再回滚?`,
          [{ label: '停止并回滚', value: true, cls: 'primary' }, { label: '取消', value: false }])
        if (!go) return
        stopManaged = true
      }
      const r = await window.dshm.rollback(b.dataset.rollback, { stopManaged })
      if (r.steps?.length) {
        const lines = r.steps.map((s) => `${s.ok ? '✔' : '✘'} ${s.name}${s.detail ? ': ' + s.detail : ''}`).join('\n')
        appendLog('[rollback] ' + r.steps.map((s) => `${s.ok ? 'ok' : 'fail'}:${s.name}`).join(' | '))
        await modal('回滚结果', `<pre class="update-log">${esc(lines)}</pre>`, [{ label: '关闭', value: true, cls: 'primary' }])
      }
      toast(r.ok ? `回滚完成,当前版本 ${r.version}` : `回滚失败: ${r.error || ''}`, r.ok ? 'ok' : 'error')
      if (r.hint) toast(r.hint, 'error')
      if (r.warning) toast(r.warning, 'error')
      refreshUpdate()
    }
  })
}

async function doUpdate() {
  // 强预检:有 dsh 进程在跑就拒绝更新(2026-09-10 那次 EBUSY 的根因就是文件被占用)
  let pre = null
  try { pre = await window.dshm.updatePreflight() } catch { pre = null }
  let stopManaged = false
  if (pre && pre.blocking) {
    const choice = await modal('检测到 dsh 正在运行',
      `更新会替换全局 dsh 的安装文件,以下进程占用了这些文件,会让 <b>npm 以 EBUSY 失败</b>:<pre class="update-log">${esc((pre.detail || []).join('\n'))}</pre>` +
      `点「全部停止并继续」会先停止<b>管理器托管的 profile</b>;<b>官方桌面端与外部 CLI 进程需要你手动关闭</b>(管理器不强杀)。<br>更新前会自动备份当前版本与各 profile 配置,失败可回滚。`,
      [{ label: '全部停止并继续', value: 'stop', cls: 'primary' }, { label: '取消', value: false }])
    if (!choice) return
    stopManaged = true
  } else {
    const ok = await modal('更新 dsh',
      `将全局更新 <b>@deepseek-ai/dsh</b> 到最新版。<br>预检:${esc((pre?.detail || ['没有 dsh 进程占用文件']).join(';'))}<br>` +
      `更新前会自动备份当前版本与各 profile 配置,失败可回滚。`,
      [{ label: '开始更新', value: true, cls: 'primary' }, { label: '取消', value: false }])
    if (!ok) return
  }

  $('#btn-do-update').disabled = true
  const target = pickedVersion()
  const targetVersion = target && target !== 'latest' ? target : null
  resetUpdateProgress(targetVersion ? `正在更新到 ${targetVersion}…` : '正在更新到最新版…')
  const r = await window.dshm.doUpdate({ stopManaged, targetVersion })
  if (r.code === 'RUNNING') {
    $('#update-progress').textContent = `✘ ${r.error}`
    toast('已阻止更新:还有 dsh 进程在运行', 'error')
    $('#btn-do-update').disabled = false
    return
  }
  $('#update-progress').textContent = r.ok ? `✔ 更新完成:${r.version}` : `✘ 更新失败${r.code ? `[${r.code}]` : ''}:${r.error || ''}`
  if (r.ok) {
    $('#update-progress-bar').classList.remove('indeterminate')
    $('#update-progress-bar').style.width = '100%'
  }
  toast(r.ok ? `更新完成: v${r.version}` : '更新失败', r.ok ? 'ok' : 'error')
  if (r.hint) toast(r.hint, 'error')
  // ETARGET 常见于上游 latest 的依赖没发全:直接把版本选择器推到用户面前
  if (r.code === 'ETARGET' && !r.ok) {
    await loadVersionOptions(true)
    // modal 的 DOM 是同步插入的:先拿 promise 挂下拉,再等用户选择
    const pickP = modal('该版本装不上',
      `${esc(r.hint || '')}<br><br>可改选一个已知可用的版本重试(已自动列出 npm 上的版本)。` +
      `<div class="row" style="margin-top:10px"><span class="muted">目标版本:</span>` +
      `<div id="etarget-dd"></div></div>`,
      [{ label: '用该版本重试', value: true, cls: 'primary' }, { label: '稍后', value: false }])
    const eddBox = $('#etarget-dd')
    const edd = eddBox ? makeDropdown(eddBox, { items: versionItems, value: pickedVersion() }) : null
    const pick = await pickP
    const chosen = edd ? edd.getValue() : 'latest'
    if (edd) edd.destroy()
    if (pick) {
      if (versionDd) versionDd.setValue(chosen)
      if (chosen && chosen !== 'latest') {
        resetUpdateProgress(`正在更新到 ${chosen}…`)
        const r2 = await window.dshm.doUpdate({ stopManaged, targetVersion: chosen })
        toast(r2.ok ? `更新完成: v${r2.version}` : `仍然失败: ${r2.error || ''}`, r2.ok ? 'ok' : 'error')
        if (r2.ok) { refreshUpdate(); return }
      }
    }
  }
  if (r.needsReinstall) {
    const go = await modal('建议强制重装 dsh CLI',
      `${esc(r.hint || '安装树可能不完整')}<br>强制重装会用 <code>npm install -g @deepseek-ai/dsh@latest --force</code> 覆盖安装树。`,
      [{ label: '强制重装', value: true, cls: 'primary' }, { label: '稍后', value: false }])
    if (go) {
      resetUpdateProgress()
      const r2 = await window.dshm.reinstallDsh()
      toast(r2.ok ? `重装完成,当前版本 ${r2.version}` : `重装失败: ${r2.error || ''}`, r2.ok ? 'ok' : 'error')
    }
  } else if (r.ok && r.compatOk === false) {
    const bad = (r.compat?.profiles || []).filter((p) => !p.ok && !p.skipped)
    const lines = bad.map((i) => `${i.profile}: ${i.bad.join('、')}`).join('\n')
    const fix = await modal('更新后自检发现问题',
      `新版 dsh 下以下插件无法解析,启动 harness 会失败:<pre class="update-log">${esc(lines)}</pre>是否立即一键修复?`,
      [{ label: '一键修复', value: true, cls: 'primary' }, { label: '稍后', value: false }])
    if (fix) await runCompatCheck(true)
  }
  refreshUpdate()
}

// ---------- 插件 ----------
const DEFAULT_PLUGIN_SHOW = 5
let pluginShowAll = false
const detailUrlCache = new Map()

async function getDetailUrl(name) {
  if (detailUrlCache.has(name)) return detailUrlCache.get(name)
  try {
    const d = await window.dshm.pluginDetail(name)
    detailUrlCache.set(name, d?.url || null)
  } catch { detailUrlCache.set(name, null) }
  return detailUrlCache.get(name)
}

// 提取作者:优先 GitHub 仓库 owner,其次 npm scope
function authorOf(name, url) {
  if (url) {
    const m = url.match(/github\.com\/([^/]+)\//)
    if (m) return m[1]
  }
  const m = name.match(/^@([^/]+)\//)
  return m ? m[1] : null
}

// ---------- 删除会话插件(社区实现,官方只有归档没有删除) ----------
const SESSION_DELETE_PKG = '@huanlin/dsh-plugin-session-delete'

async function renderSessionHelper() {
  const name = $('#plugins-select').value || state.launch.profile
  const status = $('#session-helper-status')
  const profEl = $('#session-helper-profile')
  if (!name || !status) return
  profEl.textContent = name
  const readOnly = Boolean((state.profiles || []).find((p) => p.name === name)?.readOnly)
  let installed = null
  try {
    const r = await window.dshm.listPlugins(name)
    installed = (r.plugins || []).find((p) => p.name === SESSION_DELETE_PKG) || null
  } catch { /* ignore */ }
  if (readOnly) {
    status.textContent = '该 profile 由官方桌面端独占,不能安装插件'
  } else if (installed) {
    status.textContent = `已安装 ${installed.version || ''}${installed.enabled === false ? '(已禁用)' : ''} — 重启该 profile 后,DSH 界面里出现删除入口`
  } else {
    status.textContent = '未安装'
  }
  $('#btn-session-helper-install').disabled = readOnly || Boolean(installed)
  $('#btn-session-helper-remove').disabled = readOnly || !installed
}

async function installSessionHelper() {
  const name = $('#plugins-select').value || state.launch.profile
  if (!name) return
  const ok = await modal('安装删除会话插件',
    `将向 profile「${esc(name)}」安装 <code>${esc(SESSION_DELETE_PKG)}</code>。<br>` +
    `安装后需要<b>重启该 profile</b> 才会在 DSH 界面出现入口。<br>` +
    `<span class="muted">这是社区插件(独立开源项目),删除链路包含会话日志、投影缓存与工作区记账。</span>`,
    [{ label: '安装', value: true, cls: 'primary' }, { label: '取消', value: false }])
  if (!ok) return
  toast('正在安装…')
  const r = await window.dshm.installPlugin(name, SESSION_DELETE_PKG, { withDeps: true })
  if (r && r.ok === false) toast(`安装失败: ${r.error || '见日志'}`, 'error')
  else toast('安装完成,重启该 profile 后生效', 'ok')
  renderSessionHelper()
}

async function removeSessionHelper() {
  const name = $('#plugins-select').value || state.launch.profile
  if (!name) return
  const ok = await modal('卸载删除会话插件', `将从 profile「${esc(name)}」移除 ${esc(SESSION_DELETE_PKG)},DSH 界面里的删除入口随之消失。`, [
    { label: '卸载', value: true, cls: 'primary' }, { label: '取消', value: false }])
  if (!ok) return
  const r = await window.dshm.uninstallPlugin(name, SESSION_DELETE_PKG)
  if (r && r.ok === false) toast(`卸载失败: ${r.error || '见日志'}`, 'error')
  else toast('已卸载(重启该 profile 后生效)', 'ok')
  renderSessionHelper()
}

async function bindPlugins() {
  const sel = $('#plugins-select')
  if (!sel.options.length) {
    const profiles = await window.dshm.listProfiles()
    sel.innerHTML = profiles.map((p) => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('')
    if (profiles.length) sel.value = state.launch.profile
  }
  sel.onchange = () => { pluginShowAll = false; renderPlugins(); renderSessionHelper() }
  $('#plugin-filter').addEventListener('input', renderPlugins)
  $('#btn-session-helper-install').onclick = installSessionHelper
  $('#btn-session-helper-remove').onclick = removeSessionHelper
}

async function renderPlugins() {
  const name = $('#plugins-select').value || state.launch.profile
  if (!name) { $('#plugins-table').innerHTML = '<div class="muted">没有可用的 profile</div>'; return }
  // 预填搜索安装的目标 profile(优先用户设置的安装位置)
  const target = $('#search-target')
  if (target && !target.options.length) {
    const profiles = (await window.dshm.listProfiles()).filter((p) => !p.readOnly)
    const settings = await window.dshm.getSettings()
    const defInstall = settings.defaultInstallProfile || name
    target.innerHTML = profiles.map((p) => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('')
    if (profiles.length) target.value = defInstall
  }
  // 首次进入插件页自动做一次默认搜索(空关键词,展示前 4 个)
  if (!state.searchAutoDone) {
    state.searchAutoDone = true
    doSearch()
  }
  const filter = ($('#plugin-filter').value || '').trim().toLowerCase()
  const readOnly = Boolean((state.profiles || []).find((p) => p.name === name)?.readOnly)
  const r = await window.dshm.listPlugins(name)
  let list = r.plugins
  if (filter) list = list.filter((pl) => pl.name.toLowerCase().includes(filter) || (pl.description || '').toLowerCase().includes(filter))
  // 批量解析详情 URL(缓存),用于展示作者并支持点击跳转
  const urls = {}
  await Promise.all(list.map(async (pl) => { urls[pl.id] = await getDetailUrl(pl.id) }))
  const total = r.plugins.length
  const show = pluginShowAll || filter ? list.length : Math.min(DEFAULT_PLUGIN_SHOW, list.length)
  $('#plugin-count').textContent = `共 ${total} 个${filter ? `,筛选出 ${list.length} 个` : ''}`
  const rows = list.slice(0, show).map((pl) => {
    const url = urls[pl.id]
    const author = authorOf(pl.name, url)
    const short = pl.name.replace(/^@[^/]+\//, '')
    const nameHtml = url
      ? `<a class="plugin-link" href="#" data-openurl="${esc(url)}" title="点击打开 GitHub 页面"><b>${esc(author || '—')}</b> / ${esc(short)}</a>`
      : `<b>${esc(author ? author + ' / ' : '')}${esc(short)}</b>`
    return `
    <tr>
      <td style="max-width:360px">
        ${nameHtml}${pl.kind === 'bundle' ? '<span class="tag bundle">bundle</span>' : '<span class="tag">依赖</span>'}${pl.installState === 'missing' ? '<span class="tag missing">未安装</span>' : ''}
        ${pl.description ? `<div class="muted" style="font-size:12px">${esc(pl.description.slice(0, 120))}</div>` : ''}
      </td>
      <td><span class="pill">${esc(pl.version)}</span></td>
      <td>
        ${pl.kind === 'bundle' ? `
          <label class="switch"><input type="checkbox" data-toggle="${esc(pl.id)}" ${pl.enabled ? 'checked' : ''} ${readOnly ? 'disabled' : ''}><span class="slider"></span></label>
        ` : '<span class="muted">—</span>'}
      </td>
      <td style="white-space:nowrap">
        ${pl.installState === 'installed' ? `<button class="btn sm" data-update="${esc(pl.id)}" ${readOnly ? 'disabled' : ''}>更新</button>` : ''}
        <button class="btn sm ghost" data-detail="${esc(pl.id)}">详情</button>
        ${pl.kind === 'bundle' ? `<button class="btn sm danger-ghost" data-uninstall="${esc(pl.id)}" ${readOnly ? 'disabled' : ''}>卸载</button>` : ''}
      </td>
    </tr>`
  }).join('')
  const banner = readOnly
    ? `<div class="warn-box">🔒 「${esc(name)}」由官方 DeepSeek Harness 桌面端独占(官方文档:CLI 不得启动或修改它)。本页对它只做只读展示 —— 不启停插件、不卸载、不更新,也不会对它执行兼容性修复。</div>`
    : ''
  $('#plugins-table').innerHTML = banner + (list.length
    ? `<table><thead><tr><th>插件</th><th>版本</th><th>启用</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<div class="muted">${filter ? '没有匹配的插件' : '该 profile 还没有安装插件,去下方「搜索与安装插件」添加。'}</div>`)
  $('#plugins-expand').innerHTML = (!filter && list.length > DEFAULT_PLUGIN_SHOW)
    ? `<button class="btn sm" id="btn-plugins-expand">${pluginShowAll ? '收起' : `展开全部 (${list.length})`}</button>`
    : ''

  $('#btn-plugins-expand')?.addEventListener('click', () => { pluginShowAll = !pluginShowAll; renderPlugins() })

  $('#plugins-table').querySelectorAll('[data-toggle]').forEach((s) => {
    s.onchange = async () => {
      const res = await window.dshm.setPluginEnabled(name, s.dataset.toggle, s.checked)
      toast(res.needRestart ? '已保存(重启 profile 后生效)' : '已生效', 'ok')
    }
  })
  $('#plugins-table').querySelectorAll('[data-update]').forEach((b) => {
    b.onclick = async () => {
      toast(`正在更新 ${b.dataset.update} …`)
      const r = await window.dshm.updatePlugin(name, b.dataset.update)
      toast(r.ok ? '更新完成' : `更新失败: ${r.stderr || r.error}`, r.ok ? 'ok' : 'error')
      renderPlugins()
    }
  })
  $('#plugins-table').querySelectorAll('.plugin-link').forEach((a) => {
    a.onclick = (e) => {
      e.preventDefault()
      window.dshm.openExternal(a.dataset.openurl)
    }
  })
  $('#plugins-table').querySelectorAll('[data-detail]').forEach((b) => {
    b.onclick = async () => {
      const d = await window.dshm.pluginDetail(b.dataset.detail)
      if (d.url) {
        const ok = await modal('插件详情', `<b>${esc(b.dataset.detail)}</b><br>将用浏览器打开: ${esc(d.url)}`, [
          { label: '打开', value: true, cls: 'primary' }, { label: '取消', value: false },
        ])
        if (ok) window.dshm.openExternal(d.url)
      } else {
        toast('未找到该插件的 GitHub/npm 详情页(本地或私有包)', 'error')
      }
    }
  })
  $('#plugins-table').querySelectorAll('[data-uninstall]').forEach((b) => {
    b.onclick = async () => {
      const ok = await modal('卸载插件', `将彻底移除 <b>${esc(b.dataset.uninstall)}</b> 及其依赖(不可撤销,重新启用需重新安装)。确定?`, [
        { label: '卸载', value: true, cls: 'primary' }, { label: '取消', value: false },
      ])
      if (!ok) return
      const r = await window.dshm.uninstallPlugin(name, b.dataset.uninstall)
      toast(r.ok ? '已卸载' : `卸载失败: ${r.stderr || r.error}`, r.ok ? 'ok' : 'error')
      renderPlugins()
    }
  })
  renderSessionHelper()
}

// ---------- 搜索安装 ----------
const DEFAULT_SEARCH_SHOW = 4
let searchResultsCache = []
let searchShowAll = false

function bindSearch() {
  $('#btn-search').onclick = doSearch
  $('#search-query').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch() })
  // GitHub 勾选时自动展示插件
  $('#src-github').addEventListener('change', () => { if ($('#src-github').checked) doSearch() })
  $('#search-source-filter').addEventListener('change', () => { searchShowAll = false; renderSearchResults() })
}

function selectedSources() {
  return { npm: $('#src-npm').checked, github: $('#src-github').checked, local: $('#src-local').checked }
}

async function doSearch() {
  const q = $('#search-query').value.trim()
  const sel = selectedSources()
  searchShowAll = false
  $('#search-results').innerHTML = '<div class="muted">搜索中…</div>'
  $('#search-errors').textContent = ''
  const r = await window.dshm.searchPlugins(q, sel)
  if (r.errors.length) {
    const ghErr = r.errors.some((e) => e.source === 'github')
    $('#search-errors').innerHTML = r.errors.map((e) => `⚠ ${e.source}: ${esc(e.error)}`).join('<br>') +
      (ghErr ? `<div class="row" style="margin-top:6px"><button class="btn sm" id="btn-gh-insecure">开启「跳过证书校验」并重试</button><span class="muted">适用于代理/证书拦截网络</span></div>` : '')
    $('#btn-gh-insecure')?.addEventListener('click', async () => {
      await window.dshm.setSettings({ insecureGitHub: true })
      toast('已开启 GitHub 跳过证书校验,重新搜索…', 'ok')
      doSearch()
    })
  }
  const target = $('#search-target')
  const settings = await window.dshm.getSettings()
  const defInstall = settings.defaultInstallProfile || state.launch.profile
  target.innerHTML = (await window.dshm.listProfiles()).map((p) => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('')
  if (target.options.length) target.value = defInstall
  searchResultsCache = r.results
  renderSearchResults()
}

function renderSearchResults() {
  const filter = $('#search-source-filter').value
  const list = filter === 'all' ? searchResultsCache : searchResultsCache.filter((i) => i.source === filter)
  if (!list.length) {
    $('#search-results').innerHTML = '<div class="muted">没有结果,换个关键词试试</div>'
    $('#search-expand').innerHTML = ''
    return
  }
  const show = searchShowAll ? list.length : Math.min(DEFAULT_SEARCH_SHOW, list.length)
  $('#search-results').innerHTML = list.slice(0, show).map((item) => `
    <div class="result-item">
      <div style="flex:1">
        <div><span class="r-name">${esc(item.name)}</span><span class="src-tag src-${item.source}">${item.source}</span> <span class="pill">v${esc(item.version)}</span></div>
        <div class="r-desc">${esc(item.description)}</div>
        <div class="r-meta">${item.source === 'npm' ? `作者 ${esc(item.meta.author)}` : item.source === 'github' ? `⭐ ${item.meta.stars}` : `路径 ${esc(item.meta.path)}`}</div>
      </div>
      <div style="display:flex;gap:6px;align-self:center">
        <button class="btn sm ghost" data-sdetail="${esc(item.name)}" data-spec="${esc(item.source === 'local' ? 'local' : item.source)}">详情</button>
        <button class="btn sm primary" data-install='${JSON.stringify({ spec: item.source === 'local' ? `link:${item.meta.path}` : item.source === 'github' ? `github:${item.name}` : item.name, name: item.name })}'>安装</button>
      </div>
    </div>`).join('')
  $('#search-expand').innerHTML = list.length > DEFAULT_SEARCH_SHOW
    ? `<button class="btn sm" id="btn-search-expand">${searchShowAll ? '收起' : `展开全部 (${list.length})`}</button>`
    : ''
  $('#btn-search-expand')?.addEventListener('click', () => { searchShowAll = !searchShowAll; renderSearchResults() })
  $('#search-results').querySelectorAll('[data-install]').forEach((b) => {
    b.onclick = () => doInstall(JSON.parse(b.dataset.install))
  })
  $('#search-results').querySelectorAll('[data-sdetail]').forEach((b) => {
    b.onclick = async () => {
      const d = await window.dshm.pluginDetail(b.dataset.sdetail)
      if (d.url) {
        const ok = await modal('插件详情', `<b>${esc(b.dataset.sdetail)}</b><br>将用浏览器打开: ${esc(d.url)}`, [
          { label: '打开', value: true, cls: 'primary' }, { label: '取消', value: false },
        ])
        if (ok) window.dshm.openExternal(d.url)
      } else {
        toast('未找到该插件的 GitHub/npm 详情页(本地或私有包)', 'error')
      }
    }
  })
}

async function doInstall({ spec, name }) {
  const profile = $('#search-target').value
  if (!profile) return toast('请先选择目标 profile', 'error')
  let deps = []
  try { deps = await window.dshm.resolveDeps(spec) } catch { deps = [] }
  const depHtml = deps.length
    ? `<div class="dep-list">检测到插件依赖,将一并安装:<ul>${deps.map((d) => `<li>${esc(d.name)} @ ${esc(d.version)} <span class="muted">(由 ${esc(d.parent || '主包')})</span></li>`).join('')}</ul></div>`
    : '<div class="muted">未检测到插件类依赖</div>'
  const ok = await modal('确认安装', `将安装 <b>${esc(name)}</b>(${esc(spec)}) 到 profile <b>${esc(profile)}</b><br>${depHtml}`, [
    { label: '安装(含依赖)', value: 'deps', cls: 'primary' }, { label: '仅安装本体', value: 'alone' }, { label: '取消', value: false },
  ])
  if (!ok) return
  const r = await window.dshm.installPlugin(profile, spec, { withDeps: ok === 'deps' })
  if (r.ok) {
    toast('安装完成', 'ok')
    $('#search-results').innerHTML = `<div class="panel"><h3>安装输出</h3><pre class="log-out">${esc(r.logs.join('\n\n'))}</pre></div>`
  } else {
    toast(`安装失败: ${r.error || '未知错误'}`, 'error')
  }
  if ($('#plugins-select').value === profile) renderPlugins()
}

// ---------- 诊断 ----------
function bindDiagnose() {
  $('#btn-harden').onclick = async () => {
    const ok = await modal('收紧密钥文件权限',
      '将对以下文件断开权限继承,并只允许 <b>当前用户 / SYSTEM / Administrators</b> 访问:<br>· DSH 凭据文件 <span class="muted">~/.dsh/.credentials.yaml</span><br>· 管理器配置 <span class="muted">~/.dsh-manager/config.json</span><br><br>继续?',
      [{ label: '收紧权限', value: true, cls: 'primary' }, { label: '取消', value: false }])
    if (!ok) return
    const r = await window.dshm.securityHarden()
    const lines = r.results.map((x) => `${x.file}: ${x.status}${x.error ? ' — ' + x.error : ''}`)
    toast(`权限处理完成:\n${lines.join('\n')}`, r.ok ? 'ok' : 'error')
    appendLog('[security] ' + lines.join(' | '))
  }
  $('#btn-diagnose').onclick = async () => {
    const box = $('#diagnose-results')
    box.innerHTML = '<div class="muted">诊断中…</div>'
    const r = await window.dshm.runDiagnostics()
    const icon = { ok: '✓', warn: '⚠', error: '✗' }
    box.innerHTML = r.checks.map((c) => `
      <div class="diag-item diag-${c.status}">
        <span class="diag-status">${icon[c.status] || '?'}</span>
        <span><b>${esc(c.label)}</b>: ${esc(c.detail || '')}</span>
      </div>`).join('')
    $('#diagnose-report').innerHTML = `报告已生成: ${esc(r.reportPath)} <button class="btn sm" data-open-report>打开</button>`
    $('#diagnose-report').querySelector('[data-open-report]').onclick = () => window.dshm.openPath(r.reportPath)
  }
}

// ---------- 余额 ----------
async function bindBalance() {
  $('#btn-save-key').onclick = async () => {
    const key = $('#api-key').value.trim()
    const r = await window.dshm.setApiKey(key)
    if (!r.ok) { toast(`保存失败: ${r.error}`, 'error'); return }
    toast(key ? 'Key 已加密保存' : '已清除', 'ok')
    $('#api-key').value = ''
  }
  $('#btn-clear-key').onclick = async () => { await window.dshm.setApiKey(null); toast('已清除 Key', 'ok') }
  $('#btn-import-key').onclick = async () => {
    const r = await window.dshm.importDshKey()
    toast(r.ok ? '已从 DSH 凭据导入' : r.error, r.ok ? 'ok' : 'error')
  }
  $('#btn-refresh-balance').onclick = refreshBalance
  if (await window.dshm.hasApiKey()) refreshBalance()
}

async function refreshBalance() {
  const box = $('#balance-display')
  box.innerHTML = '<div class="muted">查询中…</div>'
  const r = await window.dshm.getBalance()
  if (!r.ok) { box.innerHTML = `<div style="color:var(--red)">${esc(r.error)}</div>`; return }
  const infos = Array.isArray(r.data.balance_infos) ? r.data.balance_infos : []
  const total = infos.reduce((s, i) => s + (Number(i.total_balance) || 0), 0)
  box.innerHTML = `
    <div>总余额 <span class="big">${total.toFixed(2)} ${esc(infos[0]?.currency || 'CNY')}</span></div>
    <div class="infos">${infos.map((i) =>
      `<div>${esc(i.currency)}: 总额 ${Number(i.total_balance).toFixed(2)} = 赠送 ${Number(i.granted_balance).toFixed(2)} + 充值 ${Number(i.topped_up_balance).toFixed(2)}</div>`).join('') || '—'}</div>
    <div class="muted" style="margin-top:6px">更新于 ${new Date().toLocaleTimeString()}</div>`
}

// ---------- 设置 ----------
function bindTopButtons() {
  $('#btn-settings').onclick = openSettings
}

async function openSettings() {
  const s = await window.dshm.getSettings()
  const token = await window.dshm.getGithubToken()
  const hasKey = await window.dshm.hasApiKey()
  const profiles = await window.dshm.listProfiles()
  const defInstall = s.defaultInstallProfile || state.launch.profile
  const settingsModal = modal('设置', `
    <h4>外观</h4>
    <div class="row">
      <span style="width:120px">主题</span>
      <div class="seg" id="set-theme-seg">
        <button data-theme-val="system" class="${(s.theme || 'system') === 'system' ? 'active' : ''}">跟随系统</button>
        <button data-theme-val="light" class="${s.theme === 'light' ? 'active' : ''}">浅色</button>
        <button data-theme-val="dark" class="${s.theme === 'dark' ? 'active' : ''}">深色</button>
      </div>
    </div>
    <div class="muted">切换到「跟随系统」后,Windows 切换深浅色时界面会自动跟随。</div>

    <h4>通用</h4>
    <label class="chk" style="margin:6px 0"><input type="checkbox" id="set-tray" ${s.closeToTray ? 'checked' : ''}> 关闭窗口时最小化到托盘</label>
    <label class="chk" style="margin:6px 0"><input type="checkbox" id="set-stop-on-exit" ${s.stopProfilesOnExit ? 'checked' : ''}> 退出管理器时停止 harness</label>
    <div class="muted">默认<b>不停止</b>:管理器只是控制台,关掉它不应打断正在使用的 DSH 会话(如 3080 上的 GUI)。</div>
    <div class="row"><span style="width:120px">状态轮询(ms)</span><input type="text" id="set-poll" value="${s.pollIntervalMs || 2000}" style="max-width:120px"></div>

    <h4>回滚备份</h4>
    <div class="row">
      <span style="width:120px">自动清理</span>
      <select id="set-backup-retention" style="flex:1">
        ${[['off', '关闭(不自动删除)'], ['7', '超过 7 天删除'], ['30', '超过 1 个月(30 天)删除'], ['90', '超过 3 个月(90 天)删除']]
          .map(([v, label]) => `<option value="${v}" ${String(s.backupRetention || 'off') === v ? 'selected' : ''}>${label}</option>`).join('')}
      </select>
    </div>
    <div class="muted">按保留期删除更老的备份;无论怎么选,<b>永远保留最新 1 份</b>,不会把自己删空。启动时与修改设置后自动执行。</div>

    <h4>npm 下载源</h4>
    <div class="row">
      <span style="width:120px">安装/更新 dsh</span>
      <select id="set-npm-registry" style="flex:1">
        ${[['', '官方 registry.npmjs.org'], ['npmmirror', '国内镜像 registry.npmmirror.com']]
          .map(([v, label]) => `<option value="${v}" ${String(s.npmRegistry || '') === v ? 'selected' : ''}>${label}</option>`).join('')}
      </select>
    </div>
    <div class="muted">国内网络直连官方源可能长时间无响应(看起来像「没反应」)。安装/更新/强制重装都会按这里的选择加 <code>--registry</code>。</div>

    <h4>插件安装位置</h4>
    <div class="row"><span style="width:120px">默认安装 profile</span>
      <select id="set-install-profile" style="flex:1">
        ${profiles.map((p) => `<option value="${esc(p.name)}" ${p.name === defInstall ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
      </select>
    </div>
    <div class="muted">搜索安装时自动选中的目标 profile。</div>

    <h4>API Key</h4>
    <div class="row"><span style="width:120px">DeepSeek API Key</span><input type="password" id="set-apikey" placeholder="${hasKey ? '(已配置,留空则不变)' : 'sk-...'}" style="flex:1"></div>
    <div class="muted">使用 Windows 系统凭据加密存储,仅本机可解密;留空表示不修改。</div>

    <h4>GitHub</h4>
    <label class="chk" style="margin:6px 0"><input type="checkbox" id="set-gh-insecure" ${s.insecureGitHub ? 'checked' : ''}> GitHub 请求跳过证书校验(代理/证书拦截网络)</label>
    <div class="row"><span style="width:120px">GitHub Token</span><input type="password" id="set-token" value="${esc(token || '')}" placeholder="可选,提升搜索限额" style="flex:1"></div>

    <h4>窗口与显示</h4>
    <div class="row">
      <button class="btn sm" id="set-reset-window">重置窗口尺寸</button>
      <button class="btn sm ghost" id="set-reload-ui">重载界面</button>
      <button class="btn sm ghost" id="set-software-restart">以软件渲染重启</button>
    </div>
    <div class="muted" style="font-size:11px;margin-top:4px">
      窗口在托盘隐藏很久后显示空白、或内容显示不全时用。当前渲染模式:<b id="set-render-mode">读取中…</b>
    </div>
    <label class="chk" style="margin:6px 0"><input type="checkbox" id="set-software-rendering" ${s.softwareRendering ? 'checked' : ''}> 关闭硬件加速(软件渲染;显卡合成异常导致界面空白时勾选,下次启动生效)</label>
    <h4>数据目录</h4>
    <div class="muted">管理器数据: ${esc(state.bootstrap.managerHome)}<br>DSH_HOME: ${esc(state.bootstrap.dshHome)}</div>
  `, [
    { label: '保存', value: true, cls: 'primary' }, { label: '取消', value: false },
  ])
  // 重置窗口不等待确认:它是恢复手段,点完应立即生效
  setTimeout(() => {
    const btn = $('#set-reset-window')
    if (btn) btn.onclick = async () => { await window.dshm.resetWindow(); toast('窗口尺寸已重置', 'ok') }
    const bReload = $('#set-reload-ui')
    if (bReload) bReload.onclick = async () => { await window.dshm.reloadUi(); toast('界面已重新加载', 'ok') }
    const bSoft = $('#set-software-restart')
    if (bSoft) bSoft.onclick = async () => {
      const yes = await modal('以软件渲染重启', '将关闭硬件加速并重启管理器(运行中的 harness 不受影响)。', [
        { label: '重启', value: true, cls: 'primary' }, { label: '取消', value: false },
      ])
      if (yes) await window.dshm.softwareRestart()
    }
    // 主题分段按钮:点击立即预览(不等保存),保存后落盘
    let chosenTheme = s.theme || 'system'
    const seg = $('#set-theme-seg')
    if (seg) seg.querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        chosenTheme = b.dataset.themeVal
        seg.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b))
        applyTheme(chosenTheme)
      }
    })
    window.__settingsChosenTheme = () => chosenTheme
    window.dshm.windowInfo().then((w) => {
      const el = $('#set-render-mode')
      if (el) el.textContent = w && w.softwareRendering ? `软件渲染(${w.softwareSource === 'command-line' ? '命令行参数' : '设置'})` : '默认(硬件加速)'
    }).catch(() => {})
  }, 0)
  settingsModal.then(async (ok) => {
    if (!ok) return
    // 弹窗 DOM 在 resolve 后会被 setTimeout 清掉:先把所有值读出来再做 IPC。
    // 旧代码在 await setSettings 之后才读 $('#set-token'),此时元素已是 null,
    // 于是抛 Cannot read properties of null(设置其实存了,但提示和刷新全断了)。
    const theme = window.__settingsChosenTheme ? window.__settingsChosenTheme() : (s.theme || 'system')
    const patch = {
      closeToTray: $('#set-tray').checked,
      stopProfilesOnExit: $('#set-stop-on-exit').checked,
      softwareRendering: $('#set-software-rendering').checked,
      pollIntervalMs: Math.max(500, Number($('#set-poll').value) || 2000),
      defaultInstallProfile: $('#set-install-profile').value || null,
      insecureGitHub: $('#set-gh-insecure').checked,
      theme,
      backupRetention: $('#set-backup-retention').value || 'off',
      npmRegistry: $('#set-npm-registry').value || null,
    }
    const token = $('#set-token').value.trim() || null
    const key = $('#set-apikey').value.trim()
    try {
      await window.dshm.setSettings(patch)
      await window.dshm.setGithubToken(token)
      if (key) {
        const kr = await window.dshm.setApiKey(key)
        if (!kr.ok) { toast(`API Key 保存失败: ${kr.error}`, 'error'); return }
      }
      toast('设置已保存', 'ok')
      state.bootstrap.settings = { ...(state.bootstrap.settings || {}), ...patch }
      renderBackups()
      renderOverview()
    } catch (e) {
      toast(`保存设置失败: ${e.message}`, 'error')
    }
  })
}

// ---------- 日志 ----------
function bindLogBar() {
  $('#btn-log-toggle').onclick = () => {
    const bar = $('#logbar')
    bar.classList.toggle('collapsed')
    $('#btn-log-toggle').textContent = bar.classList.contains('collapsed') ? '展开' : '收起'
  }
  $('#btn-log-clear').onclick = () => { $('#log-console').textContent = ''; logLineCount = 0 }
}

// 日志追加:O(1)。旧实现每行都 `textContent += line` 再整体 split,
// 2000 行时每行要复制 ~200KB 文本 —— 日志刷屏(安装/更新)时明显掉帧。
const LOG_MAX_LINES = 2200
const LOG_TRIM_TO = 2000
let logLineCount = 0
function appendLog(line) {
  const el = $('#log-console')
  if (!el) return
  const autoScroll = el.scrollTop + el.clientHeight >= el.scrollHeight - 40
  el.appendChild(document.createTextNode(line + '\n'))
  logLineCount++
  if (logLineCount > LOG_MAX_LINES) {
    let drop = logLineCount - LOG_TRIM_TO
    while (drop-- > 0 && el.firstChild) { el.removeChild(el.firstChild); logLineCount-- }
  }
  if (autoScroll) el.scrollTop = el.scrollHeight
}

init()

// 供截图模式/脚本切换视图使用
window.__switchView = (name) => {
  const btn = document.querySelector(`.nav-item[data-view="${name}"]`)
  if (btn) btn.click()
}
