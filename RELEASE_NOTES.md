## DeepSeek Harness Manager

由 GitHub Actions 自动构建发布的 Windows 桌面版。

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
