# DeepSeek Harness Manager

[English](README.md) · **简体中文**

> ### DeepSeek Harness 的 Windows 控制中心

启动、管理插件、诊断故障、更新与回滚你的 DSH 环境 —— 不必事事回到命令行。

[![下载 Windows 版本](https://img.shields.io/badge/下载-Windows%20发布版-2ea44f?logo=windows&logoColor=white)](https://github.com/sss-1012/DeepSeek-Harness-Manager/releases/latest)
[![最新发布](https://img.shields.io/github/v/release/sss-1012/DeepSeek-Harness-Manager?label=release)](https://github.com/sss-1012/DeepSeek-Harness-Manager/releases)
[![构建状态](https://img.shields.io/github/actions/workflow/status/sss-1012/DeepSeek-Harness-Manager/release.yml?label=build)](https://github.com/sss-1012/DeepSeek-Harness-Manager/actions)
[![GitHub stars](https://img.shields.io/github/stars/sss-1012/DeepSeek-Harness-Manager?style=flat)](https://github.com/sss-1012/DeepSeek-Harness-Manager/stargazers)
[![License](https://img.shields.io/github/license/sss-1012/DeepSeek-Harness-Manager)](LICENSE)
![平台](https://img.shields.io/badge/platform-Windows%2010%20%2F%2011-lightgrey)

![DeepSeek Harness Manager — 概览页](docs/screenshots/overview.png)

> [!IMPORTANT]
> **上游变化很快。** 本管理器面向当前 `@deepseek-ai/dsh` CLI(0.1.x)。DSH 迭代频繁:
> profile、插件 bundle、以及「插件从哪里解析」都可能随版本改变。管理器会尽力检测、
> 每次更新前自动备份、并提供一键插件兼容修复 —— 但无法预见上游的每一处改动。
> **在确认新版本可用之前,请保留自动备份。**

## 为什么需要它?

DeepSeek Harness 迭代很快:profile、插件 bundle、依赖关系乃至 CLI 本身都会在版本之间变化。全程靠终端手工处理,出问题时再手工抢救,既繁琐又容易出错。

DSH Manager 把整个生命周期收进一个窗口:

- **看状态**:Harness 是否在跑(状态 / PID / 端口),一键启停
- **管插件**:安装、启用/禁用、更新、卸载
- **查环境**:Node.js、npm、pnpm、dsh、profile 完整性、插件解析、端口占用
- **先备份再更新**,更新出问题可**一键回滚**
- **控安全**:凭据加密存储、明文审计、文件权限加固

> DSH 变得快,插件会坏,更新会出岔子。
> DSH Manager 帮你**诊断、恢复、把环境维持在有掌控的状态** —— 但它不承诺"包治百病"。

## 核心能力

| | 能力 | 它给你什么 |
|---|---|---|
| 🚀 | **启动与管理** | Harness 状态、PID、端口;一键启停;选择要启动的 profile |
| 🧩 | **插件管理** | 从 npm / GitHub / 本地安装,启用禁用(不卸载),更新、卸载,跳转插件源码 |
| 🩺 | **诊断中心** | 环境、profile、插件解析、端口、凭据与权限检查,并生成 Markdown 报告 |
| 🔄 | **更新与回滚** | 版本检测、更新前自动备份、实时进度、一键回滚 |
| 🧷 | **兼容性修复** | DSH 更新后自检插件是否还能解析,一键修复 |
| 🔐 | **凭据与权限** | Windows 加密存储、明文审计、一键收紧文件权限 |

### 完整功能表

| 功能 | 说明 |
|---|---|
| 概览 | Harness 状态(PID、端口)、启停、各 profile 的启动设置 |
| 环境 | 检测并一键安装/卸载 Node.js、npm、pnpm、dsh CLI |
| 插件管理 | 已安装插件列表(支持搜索过滤)、启用、禁用、更新、卸载 |
| 插件来源 | npm registry、GitHub 仓库、本地目录 |
| 依赖解析 | 安装时自动检测插件依赖 |
| 诊断中心 | Node/npm/pnpm/dsh、profile 完整性、插件解析、端口、凭据、文件权限 + Markdown 报告 |
| 更新 | 检测新版本、备份、带实时输出地更新、回滚到备份 |
| 兼容性 | 更新后插件解析自检 + 一键修复 |
| Profile | 列出 profile、选择启动目标、按 profile 管理插件 |
| 安全 | DPAPI 加密密钥、明文凭据审计、ACL 加固 |
| 托盘与日志 | 系统托盘快捷操作、实时日志面板 |
| 余额 | DeepSeek API 余额(可选,Phase 2) |

## 界面截图

### 概览 —— 状态、环境、更新

![概览](docs/screenshots/overview.png)

### 插件管理 —— 已安装插件与搜索安装

![插件管理](docs/screenshots/plugins.png)

### 诊断中心 —— 环境检查、插件解析、安全审计

![诊断中心](docs/screenshots/diagnose.png)

<sub>截图由应用自身通过 `npm run screenshots`(Electron `capturePage`)生成,可随时重制,不会与真实界面脱节。</sub>

## 下载

推荐直接下载最新的 Windows 发布版:

**[⬇ 下载最新版本](https://github.com/sss-1012/DeepSeek-Harness-Manager/releases/latest)**

发布两种形式:

| 构建 | 适用场景 |
|---|---|
| `DeepSeek-Harness-Manager-<version>-setup.exe` | **安装程序** —— 日常使用推荐。创建开始菜单/桌面快捷方式,支持卸载 |
| `DeepSeek-Harness-Manager-<version>-portable.exe` | **绿色免安装版** —— 适合测试、临时使用或放在 U 盘里 |

### 环境要求

- Windows 10 / 11(x64)
- 已全局安装 DeepSeek Harness(`@deepseek-ai/dsh`)

**你不需要手工准备环境**:如果缺少 Node.js 或 dsh CLI,概览页会提供一键安装。

> 想从源码构建?见 [docs/zh-CN/DEVELOPMENT.md](docs/zh-CN/DEVELOPMENT.md)。

## 配套插件:在 DSH 界面里打开管理器

仓库里还带了一个小型 DSH 插件(`plugin/`),会在 DSH Web 界面**左下角**放一个「管理器」胶囊按钮:

| 胶囊状态 | 点击后 |
|---|---|
| 绿点 —— 已找到管理器 | 直接启动;已在运行则前置已有窗口(单实例) |
| 黄点 —— 未找到 | 打开 Releases 页面供你下载 |

插件不含任何业务逻辑:三个本机路由(`/dsh-manager/status.json`、`/dsh-manager/launch`、
`/dsh-manager/panel.js`)加一段注入脚本。它读取打包版管理器自动写入的 `install.json`,
因此总是指向你实际在用的那一份。管理器没装也不影响 DSH 本身。

```bash
# 从 npm 安装
dsh plugin --profile web add dsh-harness-manager
# 之后重启 dsh web
dsh plugin --profile web remove dsh-harness-manager   # 卸载
```

如果你自己在改这个插件,可以改成链接本地目录安装:
`dsh plugin --profile web add link:/path/to/DeepSeek-Harness-Manager/plugin`。

胶囊可以关掉(× 按钮),偏好存在 `localStorage`。插件按 `DSH_MANAGER_EXE` →
`~/.dsh-manager/install.json` → 常见安装路径的顺序定位管理器,详见
[plugin/README.md](plugin/README.md)(含三条自检命令,以及 awesome-list 收录用的 YAML)。

## 使用流程

1. **打开应用** —— 概览页显示 Harness 是否在运行,以及 DSH 版本与环境状态
2. **补齐环境** —— 缺 Node.js / dsh 就在概览页一键安装,或点「检查更新」
3. **启动 Harness** —— 点「启动 harness」;命令行型 profile(如需要 `--probe` 的自定义 profile)先在「配置启动项」里填启动参数
4. **管理插件** —— 插件页:选来源搜索安装,再用开关启用/禁用。**禁用不会卸载**:管理器用自己的补丁记录状态,随时可切回
5. **DSH 更新之后** —— 管理器会自动自检插件解析,若有插件失效可一键修复
6. **出问题时** —— 跑一次「诊断中心」,生成的 Markdown 报告可直接附到 issue 里

## 安全说明

凭据处理刻意保守:

- DeepSeek API Key 与 GitHub Token 使用 **Windows 系统凭据加密**(Electron `safeStorage` / DPAPI)存储。解密需要**同一 Windows 账户 + 同一台机器**
- 系统加密不可用时,管理器**拒绝明文保存**(fail-closed);历史遗留的明文密钥会在启动时自动迁移为加密存储
- 密钥只由主进程持有,且只发往对应官方接口(`api.deepseek.com`、`api.github.com`)。**不会**写入日志、运行记录、备份或诊断报告
- 诊断中心会审计明文凭据与文件权限,并支持一键加固(断开权限继承,仅保留 *当前用户 / SYSTEM / Administrators*)
- 「GitHub 跳过证书校验」**默认关闭**,仅在存在 TLS 拦截的网络按需开启,且只影响 GitHub 请求
- ⚠️ **注意**:DeepSeek Harness 自身的凭据文件 `~/.dsh/.credentials.yaml` 由 dsh 以**明文**保存 provider 密钥。管理器从不写入该文件,但诊断中心会就此风险给出提示,并提供收紧密钥文件权限的操作

## 常见问题

### Harness 启动不起来

先跑**诊断中心**。管理器会从启动输出里提炼真正的原因,例如:

- **插件解析失败** —— `failed to import loader entry …` → 在更新面板点「插件兼容性检查」并一键修复。这通常发生在 DSH 新版本改变了插件解析位置之后
- **端口被占用** —— 已有另一个 Harness 实例在运行;先停掉它,或在「配置启动项」里改检测端口
- `--expose-internals is required for HMR service` —— 你用的是 **v0.1.2 之前**的管理器版本;请升级。(旧版本用 Electron 内建 Node 启动 DSH,会导致 profile 启动失败)

### 检测不到 Harness

概览页会显示它找到的 DSH 版本。如果为空,说明 CLI 不在 `PATH` 或未安装 —— 用概览页一键安装,或自行执行 `npm install -g @deepseek-ai/dsh`。

### 插件安装失败

- 先在普通终端确认 npm / pnpm 可用
- 在代理或存在 TLS 拦截的网络下,GitHub 搜索/安装可能出现 `fetch failed`;可在搜索面板开启「跳过证书校验」,或改用 npm / 本地来源
- profile 内的本地安装依赖 pnpm(`npm install -g pnpm`)

### 构建/下载时出现 HTTPS 证书错误

见 [docs/zh-CN/TROUBLESHOOTING.md](docs/zh-CN/TROUBLESHOOTING.md) —— 其中包含镜像源、`--use-system-ca` 与离线打包的说明。

### 日志在哪里?

`~/.dsh-manager/logs/`,以及窗口底部的内置日志面板。诊断报告输出到 `~/.dsh-manager/reports/`。

## 架构

```
┌─ Electron 主进程(Node.js)──────────────────────────────────┐
│  dsh.js        dsh CLI 封装(启动 / 停止 / 版本)            │
│  tool.js       npm / pnpm 执行器(shim 解析)                 │
│  profiles.js   profile 扫描与元数据                          │
│  plugins/      插件服务 + 来源适配层                          │
│  overrides.js  管理器自有的启停状态补丁                        │
│  status.js     进程监管与状态轮询                             │
│  update.js     版本检测 / 备份 / 更新 / 回滚                  │
│  diagnose.js   诊断中心                                      │
│  env.js        环境检测 / 安装 / 卸载                         │
│  compat.js     插件解析兼容性检测与修复                        │
│  security.js   凭据与文件权限审计                             │
│  balance.js    DeepSeek API 余额                             │
│  tray.js       系统托盘                                      │
└───────────────┬─────────────────────────────────────────────┘
                │ IPC(contextBridge,白名单 API)
┌───────────────▼─────────────────────────────────────────────┐
│ 渲染进程 —— 原生 HTML / CSS / JS,零构建步骤                  │
└─────────────────────────────────────────────────────────────┘
```

几个值得知道的设计决定:

- **启停状态归管理器所有**:写入 `~/.dsh-manager/plugins/<profile>/overrides/state.yml`,启动时通过 `dsh --patch` 注入。**不改 profile 自己的 `cordis.patch.yml`,也不动插件包**,因此 DSH 更新不会覆盖你的状态
- **DSH 始终用真实 `node.exe` 启动**,绝不用 Electron 内建的 Node —— 后者会触发 HMR 的 internals 检查并导致 profile 启动失败
- **`.cmd` shim 会被解析**成真实的 JS 入口后直接用 Node 执行,规避 Windows shell 引号问题与注入风险
- **来源适配层**(`src/plugins/sources/{npm,github,local}.js`)共享同一接口,新增一种来源只需加一个文件
- **运行数据在 `~/.dsh-manager/`**(配置、备份、历史、日志、报告)—— 删掉即重置

## 开发

```powershell
git clone https://github.com/sss-1012/DeepSeek-Harness-Manager.git
cd DeepSeek-Harness-Manager
npm install
npm start                 # 运行应用
node scripts/smoke.js     # 核心模块冒烟测试
npm run pack              # 打包安装程序 + 绿色版
npm run screenshots       # 重新生成 README 截图
```

完整的环境准备、镜像配置、打包与离线构建说明:**[docs/zh-CN/DEVELOPMENT.md](docs/zh-CN/DEVELOPMENT.md)**。

## Roadmap

- [ ] 插件详情内嵌浏览(目前是跳转浏览器)
- [ ] 英文界面(当前应用界面为中文,只有文档双语)
- [ ] 界面内的运行历史视图(数据已在本地记录)
- [ ] 更完善的跨 DSH 版本兼容性检测
- [ ] 更多插件来源(精选 registry)
- [ ] 新版本更新提醒

## 相关项目

DSH 生态长得很快,这些项目值得一看(均与本项目无隶属关系):

- [awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) —— DSH 插件精选列表([站点](https://awesome-dsh-plugin.com))
- [dsh-market/dsh-market](https://github.com/dsh-market/dsh-market) —— 长在 DSH 里的插件市场([站点](https://dshmarket.com))
- [anywhere-labs/deepseek-harness-desktop](https://github.com/anywhere-labs/deepseek-harness-desktop) —— 另一套 DSH 桌面外壳([站点](https://dshdesktop.cn))
- [dataelement/dsh-desktop](https://github.com/dataelement/dsh-desktop) —— 另一套桌面外壳([站点](https://dshdesktop.com))
- [hairyf/deepseek-harness-desktop](https://github.com/hairyf/deepseek-harness-desktop) —— Tauri 桌面版,安装包很小([站点](https://dshtauri.mintlifysite.com))
- [2768651338/dsh-plugin-manager](https://github.com/2768651338/dsh-plugin-manager) —— 在 DSH 内启停插件并写备注的插件

**本项目的差异**:它不是又一套 DSH 界面,而是围绕**环境**的 Windows 控制中心 ——
一键装 Node/pnpm/dsh、多来源插件搜索、管理器自有的启用/禁用状态、跨版本的插件解析修复、
全局 CLI 更新与备份回滚、凭据与权限审计。它也能和上面的外壳配合使用:界面用你顺手的,
出问题时再用管理器。

## 参与贡献

欢迎提交 bug、功能建议与 PR。

- 🐞 [报告问题](https://github.com/sss-1012/DeepSeek-Harness-Manager/issues/new)
- 💡 [功能建议](https://github.com/sss-1012/DeepSeek-Harness-Manager/issues/new)
- 🔧 [贡献代码](docs/zh-CN/CONTRIBUTING.md) —— 提 PR 前请先跑一遍 `node scripts/smoke.js`
  (构建细节见 [docs/zh-CN/DEVELOPMENT.md](docs/zh-CN/DEVELOPMENT.md))
- 🔒 [隐私说明](docs/zh-CN/PRIVACY.md) —— 无遥测,密钥加密留在本机
- 📋 [更新日志](CHANGELOG.md) · [版本说明](RELEASE_NOTES.md)
- 🤖 用 AI 助手改代码?让它先读 [AGENTS.md](AGENTS.md)

反馈问题时,附上诊断报告(`~/.dsh-manager/reports/`)通常能省一轮沟通。

## 许可证

[MIT](LICENSE)

<sub>本项目与 DeepSeek 官方无隶属关系;「DeepSeek」「DeepSeek Harness」仅用于说明本工具管理的对象。
DSH 迭代很快 —— 如果你需要稳定,请固定使用某个确认可用的 dsh 版本。
如果 DSH Manager 对你有用,欢迎给项目点个 Star —— 这能帮到更多 DSH 用户找到它。</sub>
