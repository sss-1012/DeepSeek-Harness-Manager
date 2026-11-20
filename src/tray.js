'use strict'
// 系统托盘:与任务栏一致的应用图标 + 动态状态提示 + 快捷菜单
const path = require('node:path')
const { Tray, Menu, nativeImage } = require('electron')
const { ICONS } = require('./icons')
const { t } = require('./i18n')

let tray = null

// 优先内嵌图标(不依赖磁盘);磁盘文件存在时兜底
function appIcon() {
  const embedded = nativeImage.createFromDataURL(`data:image/png;base64,${ICONS['icon.png']}`)
  if (!embedded.isEmpty()) return embedded.resize({ width: 16, height: 16 })
  const file = path.join(__dirname, '..', 'assets', 'icon.png')
  const img = nativeImage.createFromPath(file)
  return img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 16, height: 16 })
}

function createTray({ onStart, onStop, onShow, onResetWindow, onReloadUi, onSoftwareRestart, onQuit, isAnyRunning }) {
  tray = new Tray(appIcon())
  tray.setToolTip(t('DeepSeek Harness 管理器'))
  const buildMenu = () => {
    const running = isAnyRunning()
    return Menu.buildFromTemplate([
      { label: t('DeepSeek Harness 管理器'), enabled: false },
      { type: 'separator' },
      { label: running ? t('停止所有 harness') : t('启动 web profile'), click: running ? onStop : onStart },
      { type: 'separator' },
      { label: t('打开管理器'), click: onShow },
      { label: t('重置窗口尺寸'), click: onResetWindow },
      { label: t('重载界面'), click: onReloadUi },
      { label: t('以软件渲染重启(界面空白时用)'), click: onSoftwareRestart },
      { label: t('退出'), click: onQuit },
    ])
  }
  tray.setContextMenu(buildMenu())
  tray.on('click', onShow)
  return {
    update(running) {
      try {
        tray.setImage(appIcon())
        tray.setToolTip(`${t('DeepSeek Harness 管理器')} — ${running ? t('运行中') : t('已停止')}`)
        tray.setContextMenu(buildMenu())
      } catch { /* ignore */ }
    },
    destroy() { try { tray.destroy() } catch { /* ignore */ } },
  }
}

module.exports = { createTray }
