'use strict'
/* 补充端到端测试:卸载插件 + 更新备份/回滚清单(隔离环境) */
process.env.DSH_HOME = require('node:path').join(__dirname, '..', '.dsh-e2e-home2')
process.env.DSH_MANAGER_HOME = require('node:path').join(__dirname, '..', '.dsh-manager-test2')
const fs = require('node:fs')
const path = require('node:path')
const profiles = require('../src/profiles')
const plugins = require('../src/plugins')
const update = require('../src/update')
const history = require('../src/history')

const NAME = 'e2e2'
const ROOT = path.join(__dirname, '..', '.dsh-e2e-home2', 'profiles')

async function main() {
  fs.rmSync(ROOT, { recursive: true, force: true })
  fs.rmSync(path.join(__dirname, '..', '.dsh-manager-test2'), { recursive: true, force: true })

  console.log('=== 1. 创建 + 安装 ===')
  profiles.createProfile(NAME)
  await plugins.installWithDeps(NAME, '@deepseek-ai/cordis-plugin-timer', { withDeps: false })
  let pkg = JSON.parse(fs.readFileSync(path.join(ROOT, NAME, 'package.json'), 'utf8'))
  console.log('installed deps:', Object.keys(pkg.dependencies))

  console.log('=== 2. 卸载 ===')
  const r = await plugins.uninstall(NAME, '@deepseek-ai/cordis-plugin-timer')
  console.log('uninstall ok:', r.ok)
  pkg = JSON.parse(fs.readFileSync(path.join(ROOT, NAME, 'package.json'), 'utf8'))
  console.log('deps after uninstall:', Object.keys(pkg.dependencies || {}))
  console.log('node_modules 残留:', fs.existsSync(path.join(ROOT, NAME, 'node_modules', '@deepseek-ai', 'cordis-plugin-timer')))

  console.log('=== 3. 更新备份 ===')
  const backup = await update.createBackup()
  console.log('backup id:', backup.id, '| version:', backup.version)
  const manifest = JSON.parse(fs.readFileSync(path.join(backup.dir, 'manifest.json'), 'utf8'))
  console.log('manifest profiles:', manifest.profiles.map((p) => `${p.name}(${p.bundles.length} bundles)`) )
  const backups = update.listBackups()
  console.log('listBackups:', backups.length, '条, 最新:', backups[0]?.id, 'v' + backups[0]?.version)

  console.log('=== 4. 历史 ===')
  history.record(NAME, { action: 'start', pid: 1, plugins: [], durationMs: 100 })
  console.log('history:', history.listHistory(NAME).length, '条')

  console.log('\nE2E2 DONE')
  process.exit(0)
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1) })
