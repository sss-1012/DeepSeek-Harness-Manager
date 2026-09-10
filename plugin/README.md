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
```

## 自检

```bash
node plugin/test/host.test.js     # 快:mock 宿主上下文,校验路由/注入/分支
node plugin/test/boot-check.mjs   # 慢(约 1 分钟):真实 dsh web 端到端
```

`boot-check.mjs` 会在 `.dshm-plugin-check/` 下**用独立的 DSH_HOME 与非默认端口**(默认 3099)
创建测试 profile,不读写真实的 `~/.dsh`、`~/.dsh-manager`,也不影响正在运行的服务;
结束时会自动清理(若目录仍被刚退出的子进程占用,会交给后台进程稍后删除)。

## 提交到 awesome-dsh-plugin

收录要求:仓库含 `package.json` 的 `dsh.bundle` 声明、仓库创建满 1 天、≥10 次提交、
GitHub topics 含 `dsh-plugin`。桌面客户端本体不作为条目,但**启动器插件属于条目**
(仓库内子目录插件可用 fragment URL)。

在 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
提交 `data/plugins/sss-1012__DeepSeek-Harness-Manager.yml`:

```yaml
url: https://github.com/sss-1012/DeepSeek-Harness-Manager/tree/main/plugin
name: dsh-harness-manager
category: launcher
description:
  en: Launcher entry for DeepSeek Harness Manager — a Windows control center for profiles, plugins, diagnostics, updates and rollback.
  zh: DeepSeek Harness Manager 的启动入口 —— Windows 控制中心,管理 profile、插件、诊断、更新与回滚。
```

## License

MIT
