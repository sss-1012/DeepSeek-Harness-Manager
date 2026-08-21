'use strict'
// 打包前准备:重新生成图标(WriteAllBytes 方式)→ 提取 base64 → 内嵌到 src/icons.js
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '..')

for (const script of ['gen-icons.ps1', 'gen-ico.ps1']) {
  execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts', script)], {
    stdio: 'inherit', windowsHide: true,
  })
}

const icons = {}
for (const f of ['icon.png', 'tray-green.png', 'tray-gray.png']) {
  icons[f] = fs.readFileSync(path.join(root, 'assets', f)).toString('base64')
}
fs.writeFileSync(path.join(root, 'src', 'icons.js'),
  "'use strict'\n" +
  '// 内嵌图标(base64),由 scripts/prepack.js 生成,应用不依赖磁盘文件\n' +
  'const ICONS = ' + JSON.stringify(icons, null, 2) + '\n\n' +
  'module.exports = { ICONS }\n')
console.log('✔ prepack: 图标已重建并内嵌到 src/icons.js')
