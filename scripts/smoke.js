'use strict'
/* 冒烟测试:验证主进程各模块(不依赖 Electron) */
process.env.DSH_MANAGER_HOME = process.env.DSH_MANAGER_HOME || require('node:path').join(__dirname, '..', '.dsh-manager-test')
const path = require('node:path')
const paths = require('../src/paths')
const store = require('../src/store')
const overrides = require('../src/overrides')
const profiles = require('../src/profiles')
const plugins = require('../src/plugins')
const dsh = require('../src/dsh')
const sources = require('../src/plugins/sources')
const resolver = require('../src/plugins/resolver')
const update = require('../src/update')
const history = require('../src/history')
const diagnose = require('../src/diagnose')

async function main() {
  paths.ensureManagerDirs()
  console.log('=== 1. store ===')
  store.setSettings({ closeToTray: true })
  store.setApiKey('sk-mock-0000000000000000') // 仅测试加密存储往返,非真实密钥
  console.log('hasApiKey:', store.hasApiKey(), '| settings:', JSON.stringify(store.getSettings().closeToTray))

  console.log('=== 2. overrides ===')
  overrides.setEnabled('web', 'dsh-whale-widget', false)
  console.log('disabledIds:', overrides.disabledIds('web'))
  overrides.setEnabled('web', 'dsh-whale-widget', true)
  console.log('after enable:', overrides.disabledIds('web'))
  console.log('state file:', require('node:fs').readFileSync(overrides.statePatchPath('web'), 'utf8'))

  console.log('=== 3. profiles ===')
  const plist = profiles.listProfiles()
  console.log('profiles:', plist.map((p) => `${p.name}(${p.type}, ${p.bundles.length} bundles)`))
  const web = plist.find((p) => p.name === 'web')
  console.log('web bundles:', web ? web.bundles : 'N/A')

  console.log('=== 4. plugins.list ===')
  const pl = plugins.listPlugins('web')
  console.log(`plugins: ${pl.plugins.length} (bundles=${pl.plugins.filter((p) => p.kind === 'bundle').length}, deps=${pl.plugins.filter((p) => p.kind === 'dependency').length})`)
  console.log('sample:', JSON.stringify(pl.plugins.slice(0, 3), null, 1))

  console.log('=== 5. dsh.version ===')
  console.log('dsh version:', await dsh.version())
  console.log('dsh bin:', dsh.dshBin())

  console.log('=== 6. sources.search (npm) ===')
  try {
    const r = await sources.search('dsh-tool', { npm: true, github: false, local: false })
    console.log(`npm results: ${r.results.length}`, r.results.slice(0, 3).map((x) => x.name).join(', '))
  } catch (e) { console.log('npm search error:', e.message) }

  console.log('=== 7. resolver ===')
  try {
    const deps = await resolver.resolveDeps('@deepseek-ai/cordis-plugin-hmr')
    console.log('deps found:', deps.map((d) => d.name).join(', ') || '(none)')
  } catch (e) { console.log('resolver error:', e.message) }

  console.log('=== 8. update.check ===')
  const u = await update.checkUpdate()
  console.log('update:', JSON.stringify(u))

  console.log('=== 9. history ===')
  history.record('web', { action: 'start', pid: 9999, plugins: ['x'], durationMs: 1234 })
  console.log('history entries:', history.listHistory('web').length)

  console.log('=== 10. diagnose ===')
  const diag = await diagnose.runDiagnostics()
  for (const c of diag.checks) console.log(`  [${c.status}] ${c.label}: ${c.detail}`)
  console.log('report:', diag.reportPath)

  console.log('\nALL SMOKE TESTS DONE')
}

main().catch((e) => { console.error('SMOKE FAILED:', e); process.exit(1) })
