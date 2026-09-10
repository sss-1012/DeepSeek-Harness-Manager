# dsh-harness-manager

在 DSH 的 Web 界面左下角加一个「管理器」胶囊按钮,一键打开桌面版
[DeepSeek Harness Manager](https://github.com/sss-1012/DeepSeek-Harness-Manager)。

管理器是本仓库提供的 Windows 控制中心:环境检测与安装、插件搜索/安装/启停、
多 profile 启停、诊断中心、余额查询、版本更新与回滚。

- 已安装管理器 → 显示**绿点**,点击直接启动(管理器是单实例,已在运行会前置窗口)。
- 未检测到 → 显示**黄点**,点击前往 Releases 下载页。
- 胶囊可关闭,偏好记录在 `localStorage`(键 `dshm.panel.hidden`)。

## 安装

```bash
dsh plugin --profile web add dsh-harness-manager
```

安装后重启 `dsh web`(或在管理器里重启该 profile)生效。

本地开发安装(不发布 npm,直接链接目录):

```bash
dsh plugin --profile web add link:E:\Work\DeepSeek-Harness-Manager\plugin
```

卸载:

```bash
dsh plugin --profile web remove dsh-harness-manager
```

## 管理器程序是怎么找到的

按以下顺序探测,任一路径存在即可用:

1. 环境变量 `DSH_MANAGER_EXE`(指向 `DeepSeek-Harness-Manager.exe`)
2. `~/.dsh-manager/install.json` 中的 `exe` 字段 —— 管理器每次启动时自注册,
   同时写入 `version` 与 `updatedAt`
3. 常见安装位置:
   - `%LOCALAPPDATA%\Programs\DeepSeek-Harness-Manager\DeepSeek-Harness-Manager.exe`
   - `%LOCALAPPDATA%\DeepSeek-Harness-Manager\DeepSeek-Harness-Manager.exe`
   - `%ProgramFiles%\DeepSeek-Harness-Manager\DeepSeek-Harness-Manager.exe`

未安装也不影响 DSH 本身:插件只提供一个入口,不含任何业务逻辑。

## 提供的路由

宿主侧通过 `ctx.webServer` 注册三个只读/本地路由,不会向外发请求:

| 路径 | 方法 | 说明 |
| --- | --- | --- |
| `/dsh-manager/status.json` | GET | `{ installed, exe, version, source, downloadUrl }` |
| `/dsh-manager/launch` | POST | 以 detached 方式启动管理器进程 |
| `/dsh-manager/panel.js` | GET | 左下角入口的客户端脚本 |

## 目录结构

```
plugin/
  package.json         # dsh.bundle 声明 + keywords(dsh-plugin)
  cordis.patch.yml     # 把插件挂进 profile 配置树
  lib/index.js         # 宿主侧:路由 + tapIndex 注入
  lib/panel.js         # 客户端:左下角胶囊按钮
  test/host.test.js    # 无依赖自检(mock ctx,13 项)
  test/boot-check.mjs  # 真实启动自检(隔离环境,9 项)
  test/resolve-check.mjs  # 只读:bundle 解析 + 依赖树完整度
```

## 自检

```bash
node plugin/test/host.test.js        # 快:mock 宿主上下文,校验路由/注入/分支
node plugin/test/boot-check.mjs      # 慢(约 1 分钟):真实 dsh web 端到端
node plugin/test/resolve-check.mjs web --deep   # 只读:检查某 profile 的 bundle 是否都能解析、依赖树是否完整
```

`boot-check.mjs` 会在 `.dshm-plugin-check/` 下**用独立的 DSH_HOME 与非默认端口**(默认 3099)
创建测试 profile,不读写真实的 `~/.dsh`、`~/.dsh-manager`,也不影响正在运行的服务;
结束时会自动清理(若目录仍被刚退出的子进程占用,会交给后台进程稍后删除)。

## 发布到 npm(可选)

发布后即可 `dsh plugin --profile web add dsh-harness-manager`,不必再用 `link:`。

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

不要手改生成出来的两个 README;`category` 只能取上游列出的固定值之一(`dev` 为同类启动器常用的分类)。

## License

MIT
