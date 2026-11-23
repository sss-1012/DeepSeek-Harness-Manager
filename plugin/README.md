# dsh-harness-manager

在 DSH 的 Web 界面左下角加一个「管理器」胶囊按钮,一键打开桌面版
[DeepSeek Harness Manager](https://github.com/sss-1012/DeepSeek-Harness-Manager)。

管理器是本仓库提供的 Windows 控制中心:环境检测与安装、插件搜索/安装/启停、
多 profile 启停、诊断中心、余额查询、版本更新与回滚。

> 管理器本体是 Windows 应用(Windows 10 / 11 x64)。插件本身与平台无关,但在 macOS / Linux
> 上找不到 exe,胶囊会一直是黄点,点开只是下载页。

## 安装

```bash
dsh plugin --profile web add dsh-harness-manager
```

装完重启 `dsh web`(或重启该 profile)生效。要求 Node.js ≥ 20,且 dsh CLI 已安装。

卸载:

```bash
dsh plugin --profile web remove dsh-harness-manager
```

## 胶囊的三种状态

| 状态 | 含义 | 点击之后 |
| --- | --- | --- |
| 🟢 绿点 | 已找到管理器 | 启动它;管理器是单实例,已经在运行就把窗口前置 |
| 🟡 黄点 | 没找到管理器 | 打开 Releases 下载页 |
| ⚪ 灰点 | 在官方桌面端壳里(见下文) | 打开 Releases 下载页;管理器请从开始菜单 / 任务栏打开 |

胶囊可以用 × 关掉,偏好记在 `localStorage`(键 `dshm.panel.hidden`)。

## 插件是怎么找到管理器的

按顺序探测,命中即用:

1. 环境变量 `DSH_MANAGER_EXE`(指向 `DeepSeek-Harness-Manager.exe`)
2. `~/.dsh-manager/install.json` 里的 `exe` 字段 —— 管理器每次启动时自注册,
   同时写入 `version` 与 `updatedAt`
3. 常见安装位置:
   - `%LOCALAPPDATA%\Programs\DeepSeek-Harness-Manager\DeepSeek-Harness-Manager.exe`
   - `%LOCALAPPDATA%\DeepSeek-Harness-Manager\DeepSeek-Harness-Manager.exe`
   - `%ProgramFiles%\DeepSeek-Harness-Manager\DeepSeek-Harness-Manager.exe`

找不到也不影响 DSH 本身:插件只提供一个入口,不含任何业务逻辑。

## 官方桌面端里为什么是灰点

插件内置两个入口,共用同一个 `window.__dshManagerPanel` 守卫,**先到先得,不会出现两个胶囊**:

| 入口 | 机制 | 生效载体 |
| --- | --- | --- |
| `lib/client.js` | 官方 `dsh.client` 客户端插件(client-modules 协议) | 浏览器里的 `dsh web` **与官方桌面端壳** |
| `lib/panel.js` | 宿主用 `tapIndex` 往首页注入 `<script>`(回退路径) | 只有 HTTP 服务的 web 载体 |

官方桌面端壳**不提供 `webServer`**,也不向页面暴露「启动外部程序」的能力,所以在桌面端里胶囊显示为
灰点、点击只能去下载页 —— 管理器请从 Windows 开始菜单 / 任务栏打开。

## 它在本机做了什么

宿主侧只注册三个本机路由,不向外发任何请求:

| 路径 | 方法 | 说明 |
| --- | --- | --- |
| `/dsh-manager/status.json` | GET | `{ installed, exe, version, source, downloadUrl }` |
| `/dsh-manager/launch` | POST | 以 detached 方式启动管理器进程 |
| `/dsh-manager/panel.js` | GET | 左下角入口的客户端脚本 |

启动时会清掉继承来的 `ELECTRON_RUN_AS_NODE`,否则管理器会被当成普通 Node 进程运行、闪一下就退出。

## 开发与发布

本地 `link:` 安装、目录结构、自检命令、npm 发布步骤和 awesome-list 收录用的 YAML,见
[plugin/DEVELOPMENT.md](https://github.com/sss-1012/DeepSeek-Harness-Manager/blob/main/plugin/DEVELOPMENT.md)。

## License

MIT
