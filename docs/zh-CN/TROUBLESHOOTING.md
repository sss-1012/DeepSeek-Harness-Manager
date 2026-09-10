# 常见问题排查

下面是实践中真正遇到过的故障与处理方式。拿不准时,先在应用里跑一次**诊断中心** —— 它会在
`~/.dsh-manager/reports/` 生成一份 Markdown 报告,可直接附到 issue 里。

## Harness 启动不起来

管理器会从 DSH 的启动输出里提炼出真正原因,以弹窗 + 日志面板的形式给出。实践中见过的三类:

| 日志中的症状 | 原因 | 处理 |
|---|---|---|
| `failed to import loader entry <包名>` / `plugin tree failed to load` | DSH 新版本从**与 profile 的 `node_modules` 不同的位置**解析 bundle 插件 | 更新面板 → **插件兼容性检查** → 一键修复。它会在全局 `node_modules` 里创建目录联接(不复制文件、可逆) |
| `EADDRINUSE` / 端口被占用 | 已有另一个 Harness 实例在运行 | 停掉那个实例,或在「配置启动项」里改检测端口 |
| `--expose-internals is required for HMR service` | 你用的管理器版本早于 **v0.1.2**,旧版本用 Electron 内建 Node 启动 DSH | 升级管理器 —— v0.1.2 起改为用真实 `node.exe` 启动 |

## 检测不到 Harness

概览页 `dsh CLI` 那一行会显示它能找到的版本。若为空:

1. 在终端执行 `dsh --version`。若命令不存在,说明 CLI 未安装(或不在 `PATH` 上)
2. 用概览页的一键安装,或手动执行 `npm install -g @deepseek-ai/dsh`
3. 若终端可用但管理器找不到,把 `DSH_CLI_BIN` 指向 `.../node_modules/@deepseek-ai/dsh/lib/bin.js` 的绝对路径

## 插件安装失败

- **npm/pnpm 本身有问题** —— 先在普通终端确认两者可用。profile 内的安装依赖 pnpm:`npm install -g pnpm`
- **受限网络下 GitHub 报 `fetch failed`** —— 很可能存在 TLS 拦截。在搜索面板点一次「跳过证书校验」后重试,
  或改用 npm / 本地来源。该开关默认关闭,且只影响 GitHub 请求
- **提示找不到包** —— 核对完整包名,带 scope 的需要写全(`@scope/pkg`)
- **装上了但插件没生效** —— 跑诊断中心:插件解析检查会明确指出哪个 bundle 解析失败

## HTTPS 证书错误

### 应用内使用 GitHub 功能时

在设置里打开「GitHub 请求跳过证书校验」(默认关闭)。

### 安装依赖或打包时

Node 默认不信任本机安装的拦截 CA。可选方案:

1. 让 Node 改用 Windows 证书库(Node ≥ 22.15):
   ```powershell
   $env:NODE_OPTIONS = "--use-system-ca"
   ```
2. 或改用可达的镜像:
   ```powershell
   $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
   $env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
   ```
3. 或把拦截 CA 加入 `NODE_EXTRA_CA_CERTS`

## 更新没走完 / 更新后 Harness 坏了

1. 打开**诊断中心**。每次更新后管理器都会自检插件解析,若失效可直接一键修复
2. 必要时回滚:更新面板会列出自动备份(含版本号与 profile 配置)。点「回滚到此版本」会重装记录的版本,
   并恢复各 profile 的 `package.json` / `cordis.patch.yml`
3. 回滚仍不够时,手动重装指定版本:`npm install -g @deepseek-ai/dsh@<版本>`

## 插件的启用/禁用没有生效

启停状态是在**启动时注入**的,所以正在运行的 profile 仍保持旧状态。停止后重新启动即可。
状态文件位于 `~/.dsh-manager/plugins/<profile>/overrides/state.yml`。

## 我的数据在哪?

| 路径 | 内容 |
|---|---|
| `~/.dsh/` | DSH 自身:profile、会话、凭据(`.credentials.yaml`) |
| `~/.dsh-manager/config.json` | 管理器设置与加密后的密钥 |
| `~/.dsh-manager/plugins/<profile>/overrides/` | 启停状态补丁 |
| `~/.dsh-manager/backups/` | 更新前备份(版本 + profile 配置) |
| `~/.dsh-manager/history/`、`logs/`、`reports/` | 运行记录、日志、诊断报告 |

删除 `~/.dsh-manager/` 即可重置管理器(不影响 DSH 的 profile 与会话)。

## 凭据与文件权限

- 管理器用 Windows DPAPI 加密保存密钥;系统加密不可用时**拒绝明文保存**
- **DSH 自身以明文保存 provider 密钥**(`~/.dsh/.credentials.yaml`)。诊断中心会就此告警,并可收紧该文件权限
  (断开继承,仅保留 当前用户 / SYSTEM / Administrators)
- DSH 更新后建议重跑一次「🔒 收紧密钥文件权限」—— 该文件可能被重建并恢复为继承权限
