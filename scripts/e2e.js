'use strict'
/* 端到端测试(隔离环境):创建 profile → 装插件 → 禁用插件 → 启动(带补丁注入) → 停止 → 历史 */
process.env.DSH_HOME = require('node:path').join(__dirname, '..', '.dsh-e2e-home')
process.env.DSH_MANAGER_HOME = require('node:path').join(__dirname, '..', '.dsh-manager-test')
const fs = require('node:fs')
const path = require('node:path')
const profiles = require('../src/profiles')
const plugins = require('../src/plugins')
const overrides = require('../src/overrides')
const history = require('../src/history')
const status = require('../src/status')
const log = require('../src/log')

const NAME = 'e2e-test'
const PROFILE_ROOT = path.join(__dirname, '..', '.dsh-e2e-home', 'profiles')

async function main() {
  log.initLog()
  // 清理旧环境
  fs.rmSync(PROFILE_ROOT, { recursive: true, force: true })

  console.log('=== 1. 创建 profile ===')
  const info = profiles.createProfile(NAME)
  console.log(`created: ${info.name} (${info.type}), bundles=${JSON.stringify(info.bundles)}`)

  console.log('=== 2. 安装插件(含依赖解析) ===')
  const r = await plugins.installWithDeps(NAME, '@deepseek-ai/cordis-plugin-timer', { withDeps: true, onLog: (l) => console.log('  ', l.slice(0, 100)) })
  console.log('install ok:', r.ok, '| deps:', JSON.stringify(r.deps))
  const pkg = JSON.parse(fs.readFileSync(path.join(PROFILE_ROOT, NAME, 'package.json'), 'utf8'))
  console.log('package.json bundles:', JSON.stringify(pkg.dsh.profile.bundles), '| deps:', Object.keys(pkg.dependencies))

  console.log('=== 3. 插件列表 ===')
  const list1 = plugins.listPlugins(NAME)
  console.log(list1.plugins.map((p) => `${p.name} [${p.kind}/${p.installState}] ${p.enabled ? 'on' : 'off'}`).join('\n'))

  console.log('=== 4. 禁用 bundle ===')
  overrides.setEnabled(NAME, '@deepseek-ai/dsh-base', false)
  console.log('disabledIds:', overrides.disabledIds(NAME))
  console.log('state.yml:')
  console.log(fs.readFileSync(overrides.statePatchPath(NAME), 'utf8'))
  // 重新启用,避免启动时 base 被禁用导致无法启动
  overrides.setEnabled(NAME, '@deepseek-ai/dsh-base', true)
  console.log('re-enabled, disabledIds:', overrides.disabledIds(NAME))

  console.log('=== 5. 启动(注入 --patch) ===')
  const st = await status.start(NAME, { onLog: (l) => console.log('  ', l.slice(0, 140)) })
  console.log('start result:', JSON.stringify(st))

  console.log('=== 6. 等 6 秒观察状态 ===')
  await new Promise((res) => setTimeout(res, 6000))
  const snap = await status.snapshot()
  console.log('snapshot:', JSON.stringify(snap.find((s) => s.name === NAME)))

  console.log('=== 7. 停止 ===')
  const sp = await status.stop(NAME, { force: false })
  console.log('stop result:', JSON.stringify(sp))

  console.log('=== 8. 历史 ===')
  console.log(JSON.stringify(history.listHistory(NAME), null, 1))

  console.log('\nE2E DONE')
  process.exit(0)
}

main().catch((e) => { console.error('E2E FAILED:', e); process.exit(1) })
