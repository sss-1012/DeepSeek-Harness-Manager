# dsh-harness-manager — 开发与发布

面向要改这个插件的人。只想装来用 → 看 [README.md](README.md)。

插件没有构建步骤、没有运行时依赖(要求 Node.js ≥ 20),`lib/` 里就是发布出去的东西。

## 本地开发安装

直接链接仓库里的 `plugin/` 目录,改动即时可见:

```bash
dsh plugin --profile web add link:<仓库路径>/plugin
```

卸载:

```bash
dsh plugin --profile web remove dsh-harness-manager
```

## 目录结构

```text
plugin/
  package.json         # dsh.bundle + dsh.client 声明 + keywords(dsh-plugin)
  cordis.patch.yml     # 把插件挂进 profile 配置树
  lib/index.js         # 宿主侧:路由 + tapIndex 注入(webServer 可选)
  lib/client.js        # 客户端插件入口(官方 client-modules 协议)
  lib/panel.js         # HTTP 注入回退实现
  test/host.test.js    # 无依赖自检(mock ctx + mock __ModuleLoader__,15 项)
  test/boot-check.mjs  # 真实启动自检(隔离环境,11 项,含 client-modules 启动图校验)
  test/resolve-check.mjs  # 只读:bundle 解析 + 依赖树完整度
```

## 自检

```bash
node plugin/test/host.test.js                          # 快:mock 宿主上下文,校验路由/注入/分支
node plugin/test/boot-check.mjs --spec dsh-harness-manager   # 慢(约 1 分钟):真实 dsh web 端到端
node plugin/test/resolve-check.mjs web --deep          # 只读:检查某 profile 的 bundle 是否都能解析、依赖树是否完整
```

`boot-check.mjs` 会在 `.dshm-plugin-check/` 下**用独立的 `DSH_HOME` 与非默认端口**(默认 3099)
创建测试 profile,不读写真实的 `~/.dsh`、`~/.dsh-manager`,也不影响正在运行的服务;
结束时会自动清理(若目录仍被刚退出的子进程占用,会交给后台进程稍后删除)。

## 实现要点

- 宿主侧拿不到 `ctx.webServer` 时**静默退出** —— 永远不会拖垮 profile 启动。
- 回退路径用 `ctx.webServer.tapIndex` 往首页追加 `<script defer src="/dsh-manager/panel.js">`;
  页面里已存在该脚本就跳过,不重复注入。
- `lib/client.js` 与 `lib/panel.js` 是两份独立实现(本仓库没有构建步骤把它们合并),共用
  `window.__dshManagerPanel` 守卫、**先到先得**;改胶囊外观或行为时**两处都要改**。
- 启动管理器前必须删掉继承来的 `ELECTRON_RUN_AS_NODE`:带上它的话管理器会被 Electron 当成普通
  Node 进程运行,`require('electron')` 拿不到 `app`,在单实例检查处抛错后静默退出(用户看到的就是
  「闪一下就没了」,而且不留日志)。

## 发布到 npm

版本号与桌面端保持一致(发布脚本会校验),**已发布的版本不能覆盖**,所以要改 README 也得先升版本。

仓库根目录有条半自动入口(`scripts/publish-plugin.js`):

```bash
npm run publish:plugin             # 预检 → 认证 → 冲突检查 → 发布 → 校验
npm run publish:plugin -- --dry-run  # 只看要发什么,不需要登录
```

它会检查版本与桌面端是否一致、打印 `npm pack --dry-run` 的实际打包清单、跑插件测试,并拒绝重复发布
已存在的版本;登录和 2FA 都按「等人」处理而不是直接失败(`--no-login` / `--wait=<秒>` / `--otp=` 可调)。
`npm run release` 的 npm 阶段也走这个脚本。

想手动发布:

```bash
cd plugin
npm login
npm publish --access public
```

若账号开启了 2FA,npm 会要求一次性验证码,否则报
`E403 ... Two-factor authentication or granular access token with bypass 2fa enabled is required`。两种解法:

1. 带验证码发布:`npm publish --access public --otp=<验证器里的 6 位码>`;
   若提示需要 web 认证,先执行 `npm login --auth-type=web` 再发布。
2. 生成**勾选 Bypass 2FA** 的 granular token(包权限 Read and write),设置
   `npm config set //registry.npmjs.org/:_authToken <token>` 后再发布。
   该 token 等同免 2FA 的发布权限,不要提交进仓库,用完可撤销。

发布后即可 `dsh plugin --profile web add dsh-harness-manager`,不必再用 `link:`。
包的 `files` 白名单只包含 `LICENSE`、`lib`、`cordis.patch.yml`、`README.md`,
所以本文件不会进入 npm 包。

## 提交到 awesome-dsh-plugin

上游要求(见其 `contributing.md`):`package.json` 声明 `dsh.bundle` 且同级有 `cordis.patch.yml`、
仓库创建满 1 天、仓库带 [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic、描述必须与代码相符。
本插件位于子目录,按「monorepo 子包」形式提交:`url` 指向子目录,`name` 用 `owner/repo#subname`,
文件名 `owner__repo--<子路径>.yml`。

在 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 添加**一个文件**
`data/plugins/sss-1012__DeepSeek-Harness-Manager--plugin.yml`:

```yaml
url: https://github.com/sss-1012/DeepSeek-Harness-Manager/tree/main/plugin
name: sss-1012/DeepSeek-Harness-Manager#plugin
category: dev
description:
  en: "Launcher pill in the DSH web UI that opens DeepSeek Harness Manager, a Windows desktop app which installs Node/pnpm/dsh, manages plugins and profiles, diagnoses failures, and updates or rolls back the dsh CLI."
  zh: "DSH 界面左下角的入口胶囊,一键打开 DeepSeek Harness Manager —— Windows 控制中心:装环境(Node/pnpm/dsh)、管插件与 profile、诊断故障,以及 dsh CLI 的更新与回滚。"
```

上游的 README 由脚本从这些条目生成,不要手改生成出来的文件;`category` 只能取上游列出的固定值之一
(`dev` 为同类启动器常用的分类)。

## License

MIT
