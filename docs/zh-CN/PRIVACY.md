# 隐私说明

一句话:**DSH Manager 没有遥测、没有账号。** 数据只存在本机一个目录里,密钥只发往它对应的接口,
删掉那个目录就等于清空一切。

English: [PRIVACY.md](../../PRIVACY.md)

## 存了什么,存在哪

全部位于 `~/.dsh-manager/`(可用 `DSH_MANAGER_HOME` 环境变量改位置):

| 路径 | 内容 |
|---|---|
| `config.json` | 设置项,以及用 **Windows DPAPI 加密**(Electron `safeStorage`)后的 API Key / GitHub Token |
| `plugins/<profile>/overrides/state.yml` | 你启用/禁用了哪些插件(状态归管理器所有) |
| `backups/` | 更新前备份的 profile `package.json` 与补丁文件 |
| `history/` | 启停记录(时间、耗时、退出码) |
| `logs/` | 界面上那个日志面板的内容 |
| `reports/` | 诊断报告(Markdown),只有你点诊断时才生成 |
| `install.json` | 当前运行的程序路径与版本,供 DSH 入口插件定位 |

删除 `~/.dsh-manager/` 即清空全部数据。卸载应用**不会**动 `~/.dsh/` —— 那是 DeepSeek Harness 自己的
数据目录,归 DSH 管。

## 密钥

- API Key 与 GitHub Token 用 **Windows DPAPI** 加密(同一 Windows 账户 + 同一台机器才能解密)
- 系统加密不可用时,管理器**拒绝明文保存**(fail-closed);旧版本的明文条目会在启动时自动迁移为加密存储
- 密钥只由 Electron 主进程持有,不会传给渲染层,也不会写入日志、备份、运行历史或诊断报告
- 密钥只会发往它自己的接口:DeepSeek API Key → `https://api.deepseek.com/user/balance`(你点余额查询时);
  GitHub Token → `https://api.github.com`

> ⚠️ **DeepSeek Harness 自身把 provider 密钥明文存在** `~/.dsh/.credentials.yaml`。管理器不会向那里写入,
> 但诊断中心会提示该风险,并可一键收紧文件权限(断开继承,仅保留 *当前用户 / SYSTEM / Administrators*)。

## 网络请求

只有你主动触发某个功能时,管理器才会访问对应接口:

| 功能 | 接口 |
|---|---|
| 检查更新 / 更新 | npm registry(`registry.npmjs.org`)—— 通过 `npm view` / `npm install -g` |
| 插件搜索与安装(npm 来源) | `registry.npmjs.org` —— 通过 dsh CLI / pnpm |
| 插件搜索(GitHub 来源) | `api.github.com`、`raw.githubusercontent.com` |
| 打开插件 GitHub 页面 | 你的默认浏览器,访问 `github.com` |
| 一键装环境 | npm 来自 `registry.npmjs.org`,Node.js 来自 `npmmirror.com` |
| 账户余额 | `api.deepseek.com` |
| 下载本应用 | `github.com`(由浏览器完成) |

可选的「跳过 GitHub 证书校验」默认关闭,仅作用于 GitHub 请求,供有 TLS 拦截的网络使用。

启动 Harness 会在本机运行 `dsh`;DSH 自己发出的请求(例如发给模型服务商的内容)不受本应用控制,
请以 DSH 自身文档为准。

## 诊断报告与日志

报告与日志里是**本机路径、版本号、插件名、权限列表** —— 不含密钥值。它们只写到磁盘(从不上传),
且只有诊断功能会生成报告。公开贴出前请先看一眼:路径里可能含你的 Windows 用户名。

目前**没有内置的日志脱敏或导出**:`~/.dsh-manager/logs/` 是纯文本,附件前请自行检查。

## 第三方

本应用不包含任何统计、崩溃上报或广告 SDK,不追踪使用行为。第三方代码只有 `package.json` 里列出的
依赖(全部本地、全部开源),以及你另行安装的 DeepSeek Harness。

## 变更

本说明如需修改,会随引入该修改的版本一起更新在此文件中。
有疑问请开 [issue](https://github.com/sss-1012/DeepSeek-Harness-Manager/issues/new)。
