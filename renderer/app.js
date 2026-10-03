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
        root.innerHTML = ''
        resolve(v === 'true' ? true : v === 'false' ? false : v)
      }
    })
  })
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// ---------- 初始化 ----------
async function init() {
  state.bootstrap = await window.dshm.bootstrap()
  state.profiles = state.bootstrap.profiles || []
  $('#dsh-version').textContent = `v${state.bootstrap.dshVersion || '?'}`
  state.launch = { profile: 'web', args: '', port: null, ...(state.bootstrap.settings.launch || {}) }
  renderLaunchPill()

  // 状态轮询回调:渲染失败不能把界面弄成半空状态
  window.dshm.onStatus((snap) => {
    state.profiles = snap
    if ($('.nav-item.active')?.dataset.view === 'overview') renderOverview()
  })
  // 主进程从托盘恢复窗口时会要求重画一次(隐藏久了 Chromium 可能保留旧帧/空白帧)
  window.dshm.onRefresh(() => { try { refreshCurrentView() } catch { /* ignore */ } })
  // 兜底:任何未处理的 Promise 拒绝都不应该只是“界面停住”,记录并自愈重画(限频)
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
  bindLogBar()
  try { state.desktop = await window.dshm.desktopInfo() } catch { state.desktop = null }
  await refreshUpdate()
  const tail = await window.dshm.logTail()
  tail.forEach((l) => appendLog(l))
  refreshCurrentView()
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
}

// ---------- 概览 ----------
function bindOverview() {
  $('#btn-check-update').onclick = refreshUpdate
  $('#btn-do-update').onclick = doUpdate
  $('#btn-compat-check').onclick = () => runCompatCheck(false)
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
  box.innerHTML = `<div class="card"><div class="card-head"><h4>⚠ 概览渲染失败</h4></div><div class="muted" style="font-size:12px">${esc(message)}</div><div class="row" style="margin-top:8px"><button class="btn sm" id="btn-render-retry">重试</button><button class="btn sm ghost" id="btn-render-reset">重置窗口尺寸</button></div></div>`
  $('#btn-render-retry') && ($('#btn-render-retry').onclick = () => renderOverview())
  $('#btn-render-reset') && ($('#btn-render-reset').onclick = async () => { await window.dshm.resetWindow() })
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

async function renderEnv() {
  const r = await window.dshm.envCheck()
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
  $('#env-actions').querySelectorAll('[data-env]').forEach((b) => {
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
        toast('正在执行,请稍候…(详情看日志)')
        const r2 = await window.dshm[`envUninstall${target[0].toUpperCase()}${target.slice(1)}`]()
        toast(r2.ok ? '已卸载' : `卸载失败: ${r2.error}`, r2.ok ? 'ok' : 'error')
      } else {
        toast('正在执行,请稍候…(详情看日志)')
        const r2 = kind === 'install'
          ? await window.dshm[`envInstall${target[0].toUpperCase()}${target.slice(1)}`]()
          : await window.dshm.envUpdateDsh()
        toast(r2.ok ? '完成' : `失败: ${r2.error}`, r2.ok ? 'ok' : 'error')
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
  if (evt.line) {
    text.textContent = evt.line.split('\n')[0]
    logEl.textContent += (logEl.textContent ? '\n' : '') + evt.line
    const lines = logEl.textContent.split('\n')
    if (lines.length > 300) logEl.textContent = lines.slice(-200).join('\n')
    logEl.scrollTop = logEl.scrollHeight
  }
}

function resetUpdateProgress() {
  $('#update-progress-wrap').hidden = false
  const bar = $('#update-progress-bar')
  bar.classList.add('indeterminate')
  bar.style.width = '0'
  $('#update-progress').textContent = '准备开始…'
  $('#update-log').textContent = ''
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

async function runCompatCheck(auto = false) {
  const r = await window.dshm.compatCheck()
  const skipped = (r.profiles || []).filter((p) => p.skipped)
  const bad = (r.profiles || []).filter((p) => !p.ok && !p.skipped)
  const infoCount = (r.profiles || []).reduce((n, p) => n + ((p.infoItems || []).length), 0)
  if (!bad.length && r.global?.ok) {
    if (!auto) {
      const extra = [skipped.length ? `已跳过官方桌面端独占的 ${skipped.map((s) => s.profile).join('、')}` : '', infoCount ? `${infoCount} 个插件仅在 profile 内(不影响运行)` : '']
        .filter(Boolean).join(';')
      toast(`插件解析检查通过 ✓${extra ? `(${extra})` : ''}`, 'ok')
    }
    return { ok: true }
  }
  const lines = compatIssueLines(r)
  const globalBroken = !r.global?.ok
  const body = `${globalBroken ? '<b>全局 dsh 安装不完整</b> —— 这种情况插件级修复救不了,需要重装 CLI。<br>' : ''}` +
    `以下问题会让 harness 启动失败:<pre class="update-log">${esc(lines.join('\n'))}</pre>` +
    `<span class="muted">修复方式:在全局 node_modules 建立目录联接(不复制文件、不下载、可逆),修完立即复验。</span>`
  const buttons = [{ label: '一键修复', value: 'fix', cls: 'primary' }]
  if (globalBroken) buttons.push({ label: '强制重装 dsh CLI', value: 'reinstall' })
  buttons.push({ label: '稍后', value: false })
  const choice = await modal('插件解析异常', body, buttons)
  if (!choice) return { ok: false }
  if (choice === 'reinstall') {
    resetUpdateProgress()
    const r2 = await window.dshm.reinstallDsh()
    toast(r2.ok ? `重装完成,当前版本 ${r2.version}` : `重装失败: ${r2.error || ''}`, r2.ok ? 'ok' : 'error')
    refreshUpdate()
    return { ok: Boolean(r2.ok) }
  }
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
}

async function renderBackups() {
  const list = await window.dshm.listBackups()
  const box = $('#backup-list')
  if (!list.length) { box.textContent = '暂无备份'; box.className = 'muted'; return }
  box.className = ''
  box.innerHTML = list.map((b) => `
    <div class="row" style="margin:4px 0">
      <span>${esc(b.id)} <span class="pill">v${esc(b.version)}</span></span>
      <button class="btn sm" data-rollback="${esc(b.id)}">回滚到此版本</button>
    </div>`).join('')
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
  resetUpdateProgress()
  const r = await window.dshm.doUpdate({ stopManaged })
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
  modal('设置', `
    <h4>通用</h4>
    <label class="chk" style="margin:6px 0"><input type="checkbox" id="set-tray" ${s.closeToTray ? 'checked' : ''}> 关闭窗口时最小化到托盘</label>
    <label class="chk" style="margin:6px 0"><input type="checkbox" id="set-stop-on-exit" ${s.stopProfilesOnExit ? 'checked' : ''}> 退出管理器时停止 harness</label>
    <div class="muted">默认<b>不停止</b>:管理器只是控制台,关掉它不应打断正在使用的 DSH 会话(如 3080 上的 GUI)。</div>
    <div class="row"><span style="width:120px">状态轮询(ms)</span><input type="text" id="set-poll" value="${s.pollIntervalMs || 2000}" style="max-width:120px"></div>

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

    <h4>窗口</h4>
    <div class="row">
      <button class="btn sm" id="set-reset-window">重置窗口尺寸</button>
      <span class="muted">窗口在托盘隐藏很久后、或内容显示不全时用(会把窗口尺寸恢复为 1360×880 并居中)</span>
    </div>

    <h4>数据目录</h4>
    <div class="muted">管理器数据: ${esc(state.bootstrap.managerHome)}<br>DSH_HOME: ${esc(state.bootstrap.dshHome)}</div>
  `, [
    { label: '保存', value: true, cls: 'primary' }, { label: '取消', value: false },
  ])
  // 重置窗口不等待确认:它是恢复手段,点完应立即生效
  setTimeout(() => {
    const btn = $('#set-reset-window')
    if (btn) btn.onclick = async () => { await window.dshm.resetWindow(); toast('窗口尺寸已重置', 'ok') }
  }, 0)
  settingsModal.then(async (ok) => {
    if (!ok) return
    await window.dshm.setSettings({
      closeToTray: $('#set-tray').checked,
      stopProfilesOnExit: $('#set-stop-on-exit').checked,
      pollIntervalMs: Math.max(500, Number($('#set-poll').value) || 2000),
      defaultInstallProfile: $('#set-install-profile').value || null,
      insecureGitHub: $('#set-gh-insecure').checked,
    })
    await window.dshm.setGithubToken($('#set-token').value.trim() || null)
    const key = $('#set-apikey').value.trim()
    if (key) {
      const kr = await window.dshm.setApiKey(key)
      if (!kr.ok) { toast(`API Key 保存失败: ${kr.error}`, 'error'); return }
    }
    toast('设置已保存', 'ok')
    renderOverview()
  })
}

// ---------- 日志 ----------
function bindLogBar() {
  $('#btn-log-toggle').onclick = () => {
    const bar = $('#logbar')
    bar.classList.toggle('collapsed')
    $('#btn-log-toggle').textContent = bar.classList.contains('collapsed') ? '展开' : '收起'
  }
  $('#btn-log-clear').onclick = () => { $('#log-console').textContent = '' }
}

function appendLog(line) {
  const el = $('#log-console')
  const autoScroll = el.scrollTop + el.clientHeight >= el.scrollHeight - 40
  el.textContent += line + '\n'
  const lines = el.textContent.split('\n')
  if (lines.length > 2200) el.textContent = lines.slice(-2000).join('\n')
  if (autoScroll) el.scrollTop = el.scrollHeight
}

init()

// 供截图模式/脚本切换视图使用
window.__switchView = (name) => {
  const btn = document.querySelector(`.nav-item[data-view="${name}"]`)
  if (btn) btn.click()
}
