## DeepSeek Harness Manager

由 GitHub Actions 自动构建发布的 Windows 桌面版。

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
