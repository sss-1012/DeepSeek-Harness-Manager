# 更新日志

本项目遵循[语义化版本](https://semver.org/lang/zh-CN/);版本号与 GitHub Release 的 tag 一致。
安装版 / 绿色免安装版构建产物见 [Releases](https://github.com/sss-1012/DeepSeek-Harness-Manager/releases)。

## [0.1.4] - 2026-09-10

### 新增

- 🧩 **DSH 入口插件**(`plugin/`):在 DSH Web 界面左下角加一个「管理器」胶囊按钮。
  **绿点** = 已检测到管理器,点击即启动(管理器是单实例,已在运行会前置窗口);
  **黄点** = 未检测到,点击前往下载页。插件只提供入口、不含业务逻辑,缺失时不影响 DSH 启动。
  已发布到 npm:`dsh plugin --profile web add dsh-harness-manager`。
- 🪪 **打包版自注册**:管理器启动时写入 `~/.dsh-manager/install.json`(`exe` / `version` / `updatedAt`),
  供入口插件定位你实际在用的那一份;也可用环境变量 `DSH_MANAGER_EXE` 覆盖。
- 🔁 **`npm run sync-releases`**:把 GitHub Releases 上的安装版 / 绿色版下载到本地归档目录
  `<归档根>/<tag>/`,支持 `--only <tag>` 与 `--force`;与本地打包产物共用同一套归档结构,按文件大小幂等。
- 🤖 **CI 工作流**(`.github/workflows/ci.yml`):push / PR 自动执行核心模块冒烟测试、
  文档相对链接检查、入口插件自检。
- 📚 **仓库文档**:README(中英)新增「配套插件」「相关项目」「上游变化很快」重要提示与免责声明;
  新增 `CONTRIBUTING.md`、`PRIVACY.md`、`AGENTS.md`、`CHANGELOG.md`。

### 变更

- `scripts/check-docs.js` 支持 `--offline`:CI 上跳过外部链接探测,避免外部站点抖动让构建变红。

## [0.1.3] - 2026-09-10

### 新增

- 🔐 **密钥安全审计**:诊断中心新增「DSH 凭据文件内容 / 管理器密钥存储 / 文件权限」三项检查。
- 🔒 **一键收紧文件权限**:「🔒 收紧密钥文件权限」按钮(断开权限继承,仅 当前用户 / SYSTEM / Administrators 可读),
  可随时重跑(dsh 更新重建凭据文件后权限可能回退)。

### 说明

- 管理器的密钥使用 **Windows DPAPI 加密**(仅本机本账户可解密);而 **dsh 自身的 `~/.dsh/.credentials.yaml` 是明文存储**,
  管理器不向其写入,但会在诊断中提示该风险。

## [0.1.2] - 2026-09-10

### 修复

- 🐞 **管理器启动 harness 失败**:此前用 Electron 内建 Node 启动 dsh,会触发
  `hmr: --expose-internals is required` 并导致 profile 启动崩溃;现改为**用真实 `node.exe` 启动**(实测通过)。
- 🐞 **插件解析兼容性**:新版 dsh 从全局 loader 位置解析 bundle 插件,新增自检与一键修复(目录联接,不复制文件)。

### 新增

- ✨ 更新进度条 + 安装输出实时滚动;启动失败原因提炼(插件名 / 端口占用一目了然)。

## [0.1.1] - 2026-09-10

### 新增

- ✨ 更新进度条与实时输出回显。
- 🧷 更新完成后的插件解析自检与一键修复。
- 🩺 启动失败原因提炼(缺失包名、端口占用等)。

## [0.1.0] - 2026-08-21

首个可用版本:

- 📊 **概览**:harness 一键启停、配置启动项(默认 web)、DSH 环境检测与一键安装。
- 🧩 **插件管理**:已安装列表(默认前 5 个可展开)、启用/禁用(不卸载包)、更新、GitHub 详情跳转、卸载。
- 🔍 **搜索与安装**:npm / GitHub / 本地三来源,依赖自动解析,支持「跳过证书校验」。
- 🕘 **运行历史**:启停记录(耗时 / 退出码)。
- 🩺 **诊断中心**:一键检查环境,生成 Markdown 报告。
- 💰 **账户余额**:DeepSeek API 余额,Key 以系统凭据加密存储。
- 🪟 **系统托盘** + 实时日志。
