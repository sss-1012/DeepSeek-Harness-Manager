# 参与贡献

感谢你的帮助 —— 问题反馈、功能建议、文档修正和 PR 都欢迎。

English: [CONTRIBUTING.md](../../CONTRIBUTING.md)

## 反馈问题

附上诊断报告通常能省一轮沟通:

1. 打开应用 → **诊断中心** → 跑一次检查,Markdown 报告会写到 `~/.dsh-manager/reports/`
2. 把报告贴进 issue(内容是路径与版本,不含密钥 —— 但**发之前自己先看一遍**,
   不要贴出 API Key、Token 或 `~/.dsh/.credentials.yaml` 的内容)

有这些更好:应用日志 `~/.dsh-manager/logs/`、Windows 版本、`dsh --version` 的输出。

## 本地搭建

```powershell
git clone https://github.com/sss-1012/DeepSeek-Harness-Manager.git
cd DeepSeek-Harness-Manager
npm install
npm start
```

环境:Windows 10/11,Node.js ≥ 20。受限网络下的镜像与离线构建见
[docs/zh-CN/DEVELOPMENT.md](DEVELOPMENT.md)。

## 提 PR 之前

```powershell
node scripts/smoke.js             # 核心模块冒烟测试
node scripts/check-docs.js        # README/文档里的链接(--offline 跳过外部探测)
node plugin/test/host.test.js     # 只在你改了 plugin/ 时需要
```

如果改动影响界面,请用 `npm run screenshots` 重新生成截图(它驱动真实应用截图)。

## 代码约定

- **主进程**:CommonJS + `'use strict'`,一个文件一件事放在 `src/` 下。任何给渲染层的能力都必须同时
  加进 `preload.js` 的 `contextBridge` 白名单和 `main.js` 的 IPC handler。
- **渲染层**:纯 HTML/CSS/JS,不用框架、不引入构建步骤。**界面文案是中文**,请与现有措辞保持一致。
- **文档**:中英双语。`README.md` ↔ `README.zh-CN.md`,`docs/*` ↔ `docs/zh-CN/*`。两边都要改,
  且只写事实 —— 不要出现不存在的功能或链接(`node scripts/check-docs.js` 会校验链接)。
- **依赖**:非必要不新增;打包后的应用不能用 Electron 未内置的 Node 内置模块(用 `node:https`,别用 `undici`)。

## 安全红线

- 不要写 profile 自己的 `cordis.patch.yml`,也不要改动已安装的插件包。启用/禁用状态属于管理器
  (`~/.dsh-manager/plugins/<profile>/overrides/state.yml`,启动时用 `dsh --patch` 注入)。
- 必须用真实 `node.exe` 启动 dsh(electron-as-node 会让 profile 启动崩溃)。
- 任何地方都不要打印或回显密钥;管理器用 DPAPI 存储密钥并拒绝明文降级。
- 测试不能碰用户正在用的 DSH(`~/.dsh`)或 3080 上正在运行的服务 —— 用隔离的 `DSH_HOME` 和非默认端口,
  参考 `plugin/test/boot-check.mjs`。

## 提交与发布

- 提交标题用 `type(scope): 描述` —— `feat` / `fix` / `docs` / `chore` / `ci` / `refactor`,
  例如 `fix(status): 就绪判定叠加 pidAlive 守卫`;描述用中文,与现有历史一致。
- 发布靠推 `v*` tag:`.github/workflows/release.yml` 在 `windows-latest` 上构建并发布两个安装包。
  推之前先更新 `package.json`、`RELEASE_NOTES.md` 与 `CHANGELOG.md`。
- `npm run sync-releases` 可把已发布版本镜像到本地归档目录。

## 许可证

参与贡献即表示你同意贡献内容以 [MIT 许可证](../../LICENSE) 授权。
