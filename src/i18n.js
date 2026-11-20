'use strict'
/**
 * 界面语言:i18n(中文 = 源语言,英文 = 翻译)。
 *
 * 设计取舍:**以中文原文作 key**,不用人造 key。
 *  - 查不到就原样返回中文 —— 缺词不会白屏、不会抛错,覆盖率只影响"这一句还是中文";
 *  - 新增界面文案不必先改字典,`npm run i18n:check` 会把缺口列出来;
 *  - 中文模式下 `t()` 直接返回原文,不碰 DOM,保证中文界面与历史版本逐字节一致。
 *
 * 语言值:`system`(跟随系统,非中文系统回落英文) | `zh` | `en`。
 * 中文用 `{0}`、`{1}` 占位;英文可在句子里调整占位顺序。
 */

const MESSAGES = {
  en: {
    // ---- 窗口 / 导航 ----
    'DeepSeek Harness 管理器': 'DeepSeek Harness Manager',
    '🐳 DSH 管理器': '🐳 DSH Manager',
    '启动: —': 'Launch: —',
    '⚙ 设置': '⚙ Settings',
    '📊 概览': '📊 Overview',
    '🧩 插件': '🧩 Plugins',
    '🩺 诊断': '🩺 Diagnostics',
    '💰 余额': '💰 Balance',
    '⬆ 更新管理器': '⬆ Update manager',

    // ---- 概览 ----
    '概览': 'Overview',
    '更新 harness': 'Update harness',
    '检查更新': 'Check for updates',
    '更新到最新版': 'Update to latest',
    '插件兼容性检查': 'Plugin compatibility',
    '强制重装 dsh CLI': 'Reinstall dsh CLI',
    '目标版本:': 'Target version:',
    '更新到该版本': 'Update to this version',
    '检查中…': 'Checking…',
    '更新/回滚会先做<b>进程预检</b>:检测到 harness、CLI 或官方桌面端在运行时会阻止操作,避免 npm 因文件占用而 EBUSY 失败。':
      'Updates and rollbacks run a <b>process pre-flight</b> first: while a harness, the CLI or the official desktop app is running, the operation is blocked so npm cannot fail with EBUSY on locked files.',
    '备份与回滚': 'Backups & rollback',
    '暂无备份': 'No backups yet',
    '取消': 'Cancel',

    // ---- 更新管理器 ----
    '更新管理器': 'Update manager',
    '当前版本 —': 'Current version —',
    '下载并安装': 'Download and install',
    '下载便携版': 'Download portable',
    '打开发布页': 'Open releases page',
    '只会替换<b>管理器自身</b>,不会动 dsh、profile、插件或正在运行的 harness。':
      'Only the <b>manager itself</b> is replaced — dsh, profiles, plugins and a running harness are untouched.',
    '安装时会退出管理器(默认不停止 harness)。': 'Installation quits the manager (the harness is not stopped by default).',

    // ---- 插件页 ----
    '插件管理': 'Plugins',
    '开关仅修改管理器自有补丁(不卸载包,可随时恢复);卸载才会彻底移除依赖。修改后重启 profile 生效。':
      'Toggling only edits the manager’s own patch layer (nothing is uninstalled and it is reversible); uninstalling removes the dependency. Restart the profile to apply.',
    '🧩 已安装插件': '🧩 Installed plugins',
    '搜索已安装插件…': 'Search installed plugins…',
    '🧹 删除对话记录(官方界面内)': '🧹 Delete conversations (inside the official UI)',
    '官方 dsh 只提供「归档会话」(仅隐藏),没有删除。': 'Official dsh only archives sessions (hides them); it cannot delete.',
    '删除会话': 'Delete session',
    '由社区插件': 'is provided by the community plugin',
    '提供:安装后会在 DSH 界面里加入': ': once installed it adds, inside the DSH UI,',
    '会话头部垃圾桶按钮': 'a trash button in the conversation header',
    '与': 'and',
    '侧栏会话行「…」菜单里的「删除会话」': 'a “Delete session” entry in the sidebar row “…” menu',
    ',带风险确认弹窗;': ', with a risk-confirmation dialog;',
    '确认后会停止运行中的会话,并删除会话日志、投影缓存与工作区记账。适用于 web 与官方桌面端。':
      'confirming stops a running session and deletes its session log, projection cache and workspace bookkeeping. Works for web and the official desktop app.',
    '目标 profile:': 'Target profile:',
    '安装删除会话插件': 'Install the delete-session plugin',
    '卸载': 'Uninstall',
    '🔍 搜索与安装插件': '🔍 Search & install plugins',
    '插件名 / 关键词,如 dsh-tool-*、RAG、git;本地来源时填目录路径':
      'Plugin name / keywords, e.g. dsh-tool-*, RAG, git; for the local source, a directory path',
    '本地': 'Local',
    '搜索': 'Search',
    '安装目标 profile:': 'Install into profile:',
    '结果筛选:': 'Filter results:',
    '全部来源': 'All sources',

    // ---- 诊断 ----
    '诊断中心': 'Diagnostics',
    '开始诊断': 'Run diagnostics',
    '🔒 收紧密钥文件权限': '🔒 Harden credential file permissions',
    '排查「为什么突然不能用了」的第一步': 'The first step when “it suddenly stopped working”',

    // ---- 余额 ----
    '账户余额': 'Account balance',
    '保存 Key': 'Save key',
    '从 DSH 凭据导入': 'Import from DSH credentials',
    '清除': 'Clear',
    'Key 使用 Windows 系统凭据加密存储,仅本机可解密,日志中不显示。':
      'The key is encrypted with Windows credential storage; only this machine can decrypt it and it never appears in logs.',
    '余额': 'Balance',
    '刷新': 'Refresh',

    // ---- 日志条 ----
    '📜 日志': '📜 Log',
    '清空': 'Clear',
    '收起': 'Collapse',
    '展开': 'Expand',

    // ---- 托盘 ----
    '停止所有 harness': 'Stop all harnesses',
    '启动 web profile': 'Start the web profile',
    '打开管理器': 'Open manager',
    '重置窗口尺寸': 'Reset window size',
    '重载界面': 'Reload UI',
    '以软件渲染重启(界面空白时用)': 'Restart with software rendering (when the UI is blank)',
    '退出': 'Quit',
    '运行中': 'running',
    '已停止': 'stopped',

    // ---- 设置弹窗 ----
    '设置': 'Settings',
    '保存': 'Save',
    '外观': 'Appearance',
    '主题': 'Theme',
    '跟随系统': 'Follow system',
    '浅色': 'Light',
    '深色': 'Dark',
    '切换到「跟随系统」后,Windows 切换深浅色时界面会自动跟随。':
      'With “Follow system”, the UI follows the Windows light/dark switch automatically.',
    '界面语言': 'Language',
    '中文': 'Chinese',
    '英文': 'English',
    '语言立即生效(会重新加载界面)。': 'Applied immediately (the UI reloads).',
    '通用': 'General',
    '关闭窗口时最小化到托盘': 'Minimise to tray when the window is closed',
    '退出管理器时停止 harness': 'Stop the harness when quitting the manager',
    '默认<b>不停止</b>:管理器只是控制台,关掉它不应打断正在使用的 DSH 会话(如 3080 上的 GUI)。':
      'By default it does <b>not</b> stop: the manager is only a console, closing it must not interrupt a DSH session you are using (e.g. the GUI on :3080).',
    '状态轮询(ms)': 'Status polling (ms)',
    '回滚备份': 'Rollback backups',
    '自动清理': 'Auto-prune',
    '关闭(不自动删除)': 'Off (never delete)',
    '超过 7 天删除': 'Delete after 7 days',
    '超过 1 个月(30 天)删除': 'Delete after 1 month (30 days)',
    '超过 3 个月(90 天)删除': 'Delete after 3 months (90 days)',
    '按保留期删除更老的备份;无论怎么选,<b>永远保留最新 1 份</b>,不会把自己删空。启动时与修改设置后自动执行。':
      'Prunes backups older than the retention period; whatever you pick, <b>the newest one is always kept</b>. Runs at startup and after saving settings.',
    'npm 下载源': 'npm registry',
    '安装/更新 dsh': 'Install/update dsh',
    '官方 registry.npmjs.org': 'Official registry.npmjs.org',
    '国内镜像 registry.npmmirror.com': 'China mirror registry.npmmirror.com',
    '国内网络直连官方源可能长时间无响应(看起来像「没反应」)。安装/更新/强制重装都会按这里的选择加 <code>--registry</code>。':
      'From mainland China the official registry can hang for a long time (it looks like “no response”). Install/update/reinstall pass <code>--registry</code> according to this choice.',
    '插件安装位置': 'Plugin install location',
    '默认安装 profile': 'Default install profile',
    '搜索安装时自动选中的目标 profile。': 'The profile pre-selected when installing from search.',
    '使用 Windows 系统凭据加密存储,仅本机可解密;留空表示不修改。':
      'Encrypted with Windows credential storage, decryptable only on this machine; leave blank to keep the current key.',
    '(已配置,留空则不变)': '(configured — leave blank to keep)',
    'GitHub 请求跳过证书校验(代理/证书拦截网络)': 'Skip certificate validation for GitHub (proxy / TLS-intercepting networks)',
    'GitHub Token': 'GitHub token',
    '可选,提升搜索限额': 'optional, raises the search rate limit',
    '窗口与显示': 'Window & display',
    '重载界面': 'Reload UI',
    '以软件渲染重启': 'Restart with software rendering',
    '窗口在托盘隐藏很久后显示空白、或内容显示不全时用。当前渲染模式:':
      'Use when the window shows blank or partially painted content after sitting in the tray. Current render mode:',
    '读取中…': 'reading…',
    '关闭硬件加速(软件渲染;显卡合成异常导致界面空白时勾选,下次启动生效)':
      'Disable hardware acceleration (software rendering; tick when GPU compositing leaves the UI blank — applies on next start)',
    '数据目录': 'Data directories',
    '窗口尺寸已重置': 'Window size reset',
    '界面已重新加载': 'UI reloaded',
    '将关闭硬件加速并重启管理器(运行中的 harness 不受影响)。':
      'Hardware acceleration will be disabled and the manager restarted (a running harness is not affected).',
    '重启': 'Restart',
    '软件渲染(命令行参数)': 'software rendering (command line)',
    '软件渲染(设置)': 'software rendering (setting)',
    '默认(硬件加速)': 'default (hardware acceleration)',
  },
}

function normalize(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
}

const INDEX = new Map()
for (const [k, v] of Object.entries(MESSAGES.en)) INDEX.set(normalize(k), v)

let current = 'zh'

/** 把设置里的语言值(system/zh/en)结合系统 locale 解析成 zh|en */
function resolveLanguage(setting, systemLocale) {
  const s = String(setting || 'system').toLowerCase()
  if (s === 'zh' || s === 'en') return s
  const locale = String(systemLocale || '').toLowerCase()
  return locale.startsWith('zh') ? 'zh' : 'en'
}

function setLanguage(lang) {
  current = lang === 'en' ? 'en' : 'zh'
  return current
}

function getLanguage() {
  return current
}

/**
 * 翻译一条文案。中文模式直接返回原文(不碰 DOM、不留痕迹)。
 * @param {string} source 中文原文(字典的 key)
 * @param  {...any} args {0}{1}… 占位参数
 */
function t(source, ...args) {
  if (current !== 'en') return source
  let out = INDEX.get(normalize(source))
  if (out === undefined) out = source
  for (let i = 0; i < args.length; i++) out = out.split(`{${i}}`).join(String(args[i]))
  return out
}

/** 供渲染层注入的字典(只发 en;中文是源语言,不需要表) */
function dictionary() {
  return MESSAGES.en
}

module.exports = { t, setLanguage, getLanguage, resolveLanguage, dictionary, MESSAGES }
