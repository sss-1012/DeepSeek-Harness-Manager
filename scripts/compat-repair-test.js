'use strict'
/*
 * 一键修复的回归测试(2026-11-20 事故):
 *   dsh 0.2.2-rc.5 把 @deepseek-ai/dsh-experimental-agent-team-profile 并入 dsh-base 后,
 *   旧版管理器只会说「找不到包,需先安装该插件」——而它已经没有可安装的版本;一键修复对
 *   state=missing 直接跳过,唯一真正会导致启动失败的问题反而修不了。
 *   同时旧版一键修复还会为「仅存在于 profile 内」的健康插件往全局 node_modules 建联接,
 *   而全局 dsh 一更新这些联接就断,等于亲手制造下一轮故障。
 *
 * 这里用隔离的 DSH_HOME 验证:
 *   1. 上游已撤销的官方 bundle 被判为 retired-bundle;
 *   2. repair() 会把它从 dsh.profile.bundles 删掉(保留原排版、留备份、JSON 仍合法);
 *   3. 删的是数组最后一条时,尾逗号被正确收掉;
 *   4. 仅 profile 内的健康插件不会被改动,也不会被焊进全局 node_modules。
 *
 * 绝不触碰真实 ~/.dsh。
 */
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const TMP = path.join(ROOT, '.compat-repair-test')

const RETIRED = '@deepseek-ai/dsh-experimental-agent-team-profile'
const OPTIONAL = 'fake-profile-only'

let failures = 0
function check(label, cond, extra) {
  if (cond) { console.log(`  ✔ ${label}`) } else { failures++; console.log(`  ✘ ${label}${extra ? ` — ${extra}` : ''}`) }
}

function writeProfile(name, bundles) {
  const dir = path.join(TMP, 'profiles', name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: `dsh-profile-${name}`,
    private: true,
    dependencies: {},
    dsh: { profile: { bundles } },
  }, null, 2) + '\n')
  return path.join(dir, 'package.json')
}

function readBundles(pkgPath) {
  return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).dsh.profile.bundles
}

async function main() {
  fs.rmSync(TMP, { recursive: true, force: true })
  fs.mkdirSync(path.join(TMP, 'profiles', 'node_modules', OPTIONAL), { recursive: true })
  fs.writeFileSync(path.join(TMP, 'profiles', 'node_modules', OPTIONAL, 'package.json'),
    JSON.stringify({ name: OPTIONAL, version: '1.0.0' }, null, 2))

  // npm 元数据查询要写缓存:隔离到临时目录,避免污染/被沙箱拦
  process.env.DSH_HOME = TMP
  process.env.DSH_MANAGER_HOME = path.join(TMP, 'manager')
  process.env.npm_config_cache = path.join(TMP, 'npm-cache')

  const compat = require('../src/compat')

  // registry 探测在这里用桩:沙箱/CI 里子进程拿不到管道(EPERM),网络不可用时真实探测只能返回
  // unknown(不能用 unknown 下"已废弃"结论)。真实探测逻辑另有手动验证:
  //   npm view '@deepseek-ai/dsh-experimental-agent-team-profile@0.2.2-rc.5' version --json  → E404
  const registryProbe = async () => 'no'

  // a: 已撤销的在最前;b: 已撤销的是最后一条(空格逗号处理)
  const pkgA = writeProfile('a', [RETIRED, OPTIONAL])
  const pkgB = writeProfile('b', [OPTIONAL, RETIRED])

  console.log('=== 1. 分档:上游已撤销 vs 仅 profile 内 ===')
  const checkA = await compat.checkBundles('a', { deep: false, registryProbe })
  const byName = new Map(checkA.items.map((i) => [i.name, i]))
  const retiredItem = byName.get(RETIRED)
  const optionalItem = byName.get(OPTIONAL)
  check(`${RETIRED} → retired-bundle`, retiredItem && retiredItem.state === 'retired-bundle', retiredItem && retiredItem.state)
  check('retired 项是 error 级', retiredItem && retiredItem.severity === 'error')
  check(`${OPTIONAL} → profile-only(info)`, optionalItem && optionalItem.state === 'profile-only' && optionalItem.severity === 'info', optionalItem && optionalItem.state)
  check('整体判为不通过', checkA.ok === false)

  console.log('=== 2. repair():删除已撤销条目 + 复验 ===')
  const fixedA = await compat.repair('a', { deep: false, registryProbe })
  check('repair 报成功', fixedA.ok === true, JSON.stringify(fixedA.verify))
  check('removed 含已撤销条目', (fixedA.removed || []).includes(RETIRED), JSON.stringify(fixedA.removed))
  check('a 的 bundles 只剩 profile-only 项', JSON.stringify(readBundles(pkgA)) === JSON.stringify([OPTIONAL]), JSON.stringify(readBundles(pkgA)))
  check('留下 package.json 备份', Boolean(fixedA.backup) && fs.existsSync(fixedA.backup))

  console.log('=== 3. 删除的是最后一条时尾逗号正确 ===')
  const fixedB = await compat.repair('b', { deep: false, registryProbe })
  check('repair 报成功', fixedB.ok === true, JSON.stringify(fixedB.verify))
  check('b 的 package.json 仍是合法 JSON 且只剩一项', JSON.stringify(readBundles(pkgB)) === JSON.stringify([OPTIONAL]), JSON.stringify(readBundles(pkgB)))
  const rawB = fs.readFileSync(pkgB, 'utf8')
  check('原排版(2 空格缩进 + 结尾换行)未被重写', rawB.includes('\n  "dsh": {') && rawB.endsWith('\n'), JSON.stringify(rawB.slice(-60)))

  console.log('=== 4. 健康插件不被焊进全局 node_modules ===')
  const globalNM = compat.globalNodeModules()
  check('找到全局 node_modules', Boolean(globalNM), globalNM || '')
  if (globalNM) {
    check(`全局 node_modules 里没有 ${OPTIONAL} 的联接`, !fs.existsSync(path.join(globalNM, OPTIONAL)))
  }

  fs.rmSync(TMP, { recursive: true, force: true })
  console.log(failures ? `\nFAILED: ${failures} 项` : '\nALL COMPAT REPAIR TESTS PASSED')
  process.exit(failures ? 1 : 0)
}

main().catch((e) => {
  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch { /* ignore */ }
  console.error('TEST CRASHED:', e)
  process.exit(1)
})
