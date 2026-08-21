# 🐳 DeepSeek Harness Manager

> 一个开箱即用的 Windows 桌面管理器,帮你**启动/停止 DeepSeek Harness、管理插件、更新环境、排查问题、查看余额**。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2B-lightgrey.svg)](https://github.com/)
[![Electron](https://img.shields.io/badge/Electron-43-47848F.svg)](https://www.electronjs.org/)
[![Node](https://img.shields.io/badge/Node-%3E%3D20-339933.svg)](https://nodejs.org/)

---

## ✨ 功能特性

| 模块 | 说明 |
|---|---|
| 📊 **概览** | Harness 状态卡片(运行状态 / PID / 端口)、一键启停、**配置启动项**(默认 web 启动)、DSH 环境检测(未装 Node/dsh 可一键安装) |
| 🧩 **插件管理** | 已安装插件列表(**默认显示前 5 个,可展开**)、启用/禁用开关、**更新**、GitHub 详情跳转、卸载;列表内搜索过滤 |
| 🔍 **搜索与安装** | **npm / GitHub / 本地**三来源适配层,默认空搜索展示 4 个、结果来源筛选;安装时自动**解析并安装插件依赖**;支持「跳过证书校验」适配代理/拦截网络 |
| 🕘 **运行历史** | 每次启停记录(时间 / PID / 加载插件 / 启动耗时 / 退出码),排查「为什么变慢了」 |
| 🩺 **诊断中心** | 一键检查 Node / npm / pnpm / dsh / profile 完整性 / 插件冲突 / 端口占用 / API Key,生成 Markdown 报告 |
| 💰 **账户余额** | DeepSeek API 余额查询,Key 使用 **Windows 系统凭据加密存储**,支持一键从 DSH 凭据导入 |
| 🪟 **系统托盘** | 常驻托盘(与应用同款图标,悬停显示运行状态),右键快捷启停 |
| 📜 **日志面板** | 所有操作实时滚动日志,可导出 |

## 🖼 界面预览

*(在此添加截图:概览页 / 插件页 / 诊断页)*

## 🚀 快速开始

### 环境要求

- Windows 10 / 11
- [Node.js](https://nodejs.org/) ≥ 20(自带 npm)
- 已全局安装 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)(`npm install -g @deepseek-ai/dsh`)

### 运行(开发模式)

```powershell
git clone https://github.com/<your-name>/DeepSeek-Harness-Manager.git
cd DeepSeek-Harness-Manager
npm install
npm start
```

> 国内网络安装 Electron 二进制可先设置:`$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"`

### 打包

```powershell
npm run pack
```

产物在 `dist/`:`DeepSeek-Harness-Manager-<version>-setup.exe`(安装程序)+ `DeepSeek-Harness-Manager-<version>-portable.exe`(绿色免安装版)。
打包前自动执行 `scripts/prepack.js` 重建图标并内嵌到代码,应用不依赖磁盘图标文件。

国内网络打包需设置镜像:

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"   # 无签名证书时跳过签名
```

## 📖 使用指南

- **首次使用**:打开「概览」→ 若环境未就绪,按提示一键安装 Node.js / dsh;已就绪可点「检查更新」
- **启动 harness**:概览页 Harness 卡片点「启动 harness」;命令行型 profile(如 open-design)需先在「配置启动项」填启动参数
- **安装插件**:插件页 → 搜索(勾选来源)→ 详情/安装;安装时自动带上依赖
- **禁用插件**:插件列表开关——只改管理器自有补丁,**不卸载包、不改原文件**,重启 profile 生效
- **网络拦截环境**:GitHub 搜索失败时,点「开启跳过证书校验」一键重试,或在设置中手动开关
- **查余额**:余额页保存 API Key(系统凭据加密)或「从 DSH 凭据导入」→ 刷新

## 🏗 架构与设计要点

```
┌─ Electron 主进程 (Node.js) ────────────────────────────┐
│  dsh.js       dsh CLI 封装(启停/版本/定位全局安装)        │
│  tool.js      npm/pnpm 跨平台执行(shim 解析,防注入)       │
│  profiles.js  profile 扫描 / 创建 / 删除                 │
│  plugins/     插件服务 + 来源适配层 + 依赖解析             │
│  overrides.js 管理器自有启停状态补丁                      │
│  status.js    进程管理 / 状态轮询 / 运行历史              │
│  update.js    版本检测 / 备份 / 更新 / 回滚              │
│  diagnose.js  诊断中心                                   │
│  env.js       环境检测 / 一键安装 / 卸载                 │
│  balance.js   余额查询(Phase 2)                         │
└──────────────┬─────────────────────────────────────────┘
               │ IPC (contextBridge, 白名单 API)
┌──────────────▼─────────────────────────────────────────┐
│  渲染进程(原生 HTML/CSS/JS,零构建步骤)                     │
└────────────────────────────────────────────────────────┘
```

- **启停状态管理器所有**:启用/禁用写入 `~/.dsh-manager/plugins/<profile>/overrides/state.yml`,启动时经 `dsh --patch` 注入,**不修改 `cordis.patch.yml` 与插件包**,更新 harness 不会覆盖状态(类似 VSCode extensions.json 的思路)
- **插件来源适配层**:`src/plugins/sources/{npm,github,local}.js` 统一接口,新增来源只需加一个文件
- **数据目录**:`~/.dsh-manager/`(配置 / 备份 / 历史 / 日志 / 报告),与项目目录分离,可删除即重置

## 🔐 安全说明

- API Key / GitHub Token 使用 **Windows 系统凭据(safeStorage / DPAPI)加密**存储,磁盘无明文
- 系统加密不可用时**拒绝明文保存**(fail-closed);启动时自动检测并迁移历史明文数据
- 密钥仅主进程持有,只发送到对应官方接口;日志、备份、历史记录均不含密钥
- 「GitHub 跳过证书校验」默认关闭,仅在代理/证书拦截网络按需开启

## 📁 目录结构

```text
DeepSeek-Harness-Manager/
├── main.js                 # Electron 主进程 + IPC
├── preload.js              # contextBridge 白名单 API
├── renderer/               # 界面(原生 HTML/CSS/JS)
├── src/
│   ├── paths.js            # 路径(DSH_HOME / 管理器目录)
│   ├── store.js            # 配置存储(safeStorage 加密)
│   ├── log.js              # 日志(内存环形缓冲 + 文件)
│   ├── dsh.js              # dsh CLI 封装
│   ├── tool.js             # npm/pnpm 跨平台执行
│   ├── profiles.js         # profile 扫描/创建/删除
│   ├── overrides.js        # 启停状态补丁(管理器所有)
│   ├── plugins/            # 插件服务
│   │   ├── sources/        #   npm / github / local 来源适配器
│   │   └── resolver.js     #   插件依赖解析
│   ├── status.js           # 进程管理 / 状态轮询 / 历史
│   ├── history.js          # 运行记录
│   ├── diagnose.js         # 诊断中心
│   ├── update.js           # 版本检测/备份/更新/回滚
│   ├── env.js              # 环境检测/一键安装/卸载
│   ├── balance.js          # 余额查询
│   ├── icons.js            # 内嵌图标(打包时生成)
│   └── tray.js             # 系统托盘
├── scripts/
│   ├── smoke.js            # 模块冒烟测试
│   ├── e2e.js / e2e2.js    # 端到端测试(隔离环境)
│   ├── prepack.js          # 打包前图标重建/内嵌
│   └── gen-icons.ps1       # 图标生成
└── assets/                 # 图标(ico/png)
```

## 🛠 开发与测试

```powershell
node scripts/smoke.js      # 冒烟测试核心模块
npm start                  # 启动应用
npm run pack               # 打包
```

## 🗺 Roadmap

- [ ] 插件详情页内嵌浏览(不跳转浏览器)
- [ ] 多语言界面(EN)
- [ ] 更新日志查看
- [ ] 更多插件来源适配器

## 📄 License

[MIT](LICENSE)
