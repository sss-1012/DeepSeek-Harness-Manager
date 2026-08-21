'use strict'
// 系统托盘:与任务栏一致的应用图标 + 动态状态提示 + 快捷菜单
const path = require('node:path')
const { Tray, Menu, nativeImage } = require('electron')
const { ICONS } = require('./icons')

let tray = null

// 优先内嵌图标(不依赖磁盘);磁盘文件存在时兜底
function appIcon() {
  const embedded = nativeImage.createFromDataURL(`data:image/png;base64,${ICONS['icon.png']}`)
  if (!embedded.isEmpty()) return embedded.resize({ width: 16, height: 16 })
  const file = path.join(__dirname, '..', 'assets', 'icon.png')
  const img = nativeImage.createFromPath(file)
  return img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 16, height: 16 })
}

function createTray({ onStart, onStop, onShow, onQuit, isAnyRunning }) {
  tray = new Tray(appIcon())
  tray.setToolTip('DeepSeek Harness 管理器')
  const buildMenu = () => {
    const running = isAnyRunning()
    return Menu.buildFromTemplate([
      { label: 'DeepSeek Harness 管理器', enabled: false },
      { type: 'separator' },
      { label: running ? '停止所有 harness' : '启动 web profile', click: running ? onStop : onStart },
      { type: 'separator' },
      { label: '打开管理器', click: onShow },
      { label: '退出', click: onQuit },
    ])
  }
  tray.setContextMenu(buildMenu())
  tray.on('click', onShow)
  return {
    update(running) {
      try {
        tray.setImage(appIcon())
        tray.setToolTip(`DeepSeek Harness 管理器 — ${running ? '运行中' : '已停止'}`)
        tray.setContextMenu(buildMenu())
      } catch { /* ignore */ }
    },
    destroy() { try { tray.destroy() } catch { /* ignore */ } },
  }
}

module.exports = { createTray }
