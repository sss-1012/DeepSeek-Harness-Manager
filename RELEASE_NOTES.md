## DeepSeek Harness Manager

由 GitHub Actions 自动构建发布的 Windows 桌面版。

### v0.1.4 更新(融入 DSH 生态)
- 🧩 **DSH 入口插件**:在 DSH Web 界面**左下角**加一个「管理器」胶囊按钮。
  绿点 = 已检测到管理器(点击即启动,已在运行会前置窗口);黄点 = 未检测到(点击前往下载页)。
  插件只提供入口、不含业务逻辑,缺失时不影响 DSH 启动。安装:
  `dsh plugin --profile web add link:<仓库>/plugin`
- 🪪 **打包版自注册**:管理器启动时写入 `~/.dsh-manager/install.json`(`exe` / `version` / `updatedAt`),
  供入口插件定位你实际在用的那一份(也支持 `DSH_MANAGER_EXE` 覆盖)
- 🔁 **`npm run sync-releases`**:把 GitHub Releases 上的安装版 / 绿色版下载到本地归档目录,支持 `--only` / `--force`
- 🤖 **CI 工作流**:push / PR 自动跑核心模块冒烟测试、文档链接检查、入口插件自检
- 📚 文档:README(中英)新增「配套插件」「相关项目」「上游变化很快」提示与免责声明;
  新增 `CONTRIBUTING.md` / `PRIVACY.md` / `AGENTS.md` / `CHANGELOG.md`

### v0.1.3 更新(安全加固)
- 🔐 **密钥安全审计**:诊断中心新增「DSH 凭据文件内容 / 管理器密钥存储 / 文件权限」三项检查
- 🔒 **一键收紧文件权限**:新增「🔒 收紧密钥文件权限」按钮(断开权限继承,仅 当前用户 / SYSTEM / Administrators 可读),
  并可随时重跑(dsh 更新重建凭据文件后权限可能回退)
- ℹ️ 说明:管理器的密钥使用 **Windows DPAPI 加密**(仅本机本账户可解密);而 **dsh 自身的 `~/.dsh/.credentials.yaml` 是明文存储**,管理器不向其写入,但会在诊断中提示该风险

### v0.1.2 更新(重要修复)
- 🐞 **修复:管理器启动 harness 失败** —— 之前用 Electron 内建 Node 启动 dsh,会触发
  `hmr: --expose-internals is required` 导致 profile 启动崩溃;现改为**用真实 node.exe 启动**(实测通过)
- 🐞 修复:插件解析兼容性(dsh 新版从全局目录解析插件,新增自检与一键修复)
- ✨ 更新进度条 + npm 安装输出实时滚动;启动失败原因提炼(插件名/端口占用一目了然)

### 功能
- 📊 **概览**:harness 一键启停、配置启动项(默认 web)、DSH 环境检测与一键安装
- 🧩 **插件管理**:已安装列表(默认前 5 个可展开)、启用/禁用(不卸载包)、更新、GitHub 详情跳转、卸载
- 🔍 **搜索与安装**:npm / GitHub / 本地三来源,依赖自动解析,支持「跳过证书校验」
- 🕘 **运行历史**:启停记录(耗时/退出码)
- 🩺 **诊断中心**:一键检查环境,生成 Markdown 报告
- 💰 **账户余额**:DeepSeek API 余额,Key 系统凭据加密存储
- 🪟 **系统托盘** + 实时日志

### 安装
- `DeepSeek-Harness-Manager-<version>-setup.exe` — Windows 安装程序
- `DeepSeek-Harness-Manager-<version>-portable.exe` — 绿色免安装版

### 环境要求
- Windows 10 / 11
- Node.js ≥ 20(自带 npm)
- 已全局安装 DeepSeek Harness:`npm install -g @deepseek-ai/dsh`

### 数据目录
`~/.dsh-manager/`(配置 / 备份 / 历史 / 日志,删除即重置)
