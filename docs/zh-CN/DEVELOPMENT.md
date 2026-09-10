# 开发指南

从源码运行、测试、打包与理解 DeepSeek Harness Manager 所需的全部内容。

## 环境要求

- Windows 10 / 11(x64)
- Node.js ≥ 20(自带 npm)
- 已全局安装 DeepSeek Harness CLI —— `npm install -g @deepseek-ai/dsh`
- pnpm(`npm install -g pnpm`),用于向 profile 内安装插件

## 快速开始

```powershell
git clone https://github.com/sss-1012/DeepSeek-Harness-Manager.git
cd DeepSeek-Harness-Manager
npm install
npm start
```

### 镜像配置(受限网络)

如果无法访问 Electron 的二进制下载地址,请在 `npm install` 前设置镜像:

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
```

## 测试

```powershell
node scripts/smoke.js      # 模块级冒烟测试(store / overrides / profiles / plugins / dsh / sources / resolver / update / history / diagnose)
node scripts/e2e.js        # 隔离 DSH_HOME 下的端到端流程
node scripts/e2e2.js       # 隔离环境下的卸载 + 更新备份流程
node scripts/check-docs.js # 检查 README / docs 中所有链接与图片路径(--offline 跳过外部探测)
node plugin/test/host.test.js    # DSH 入口插件:路由 / 注入 / 分支(mock 宿主,很快)
node plugin/test/boot-check.mjs  # DSH 入口插件:在隔离 DSH_HOME 里真实启动 dsh(端口 3099)
```

两个 e2e 脚本都会自建一次性的 `DSH_HOME` 与管理器数据目录,**不会碰你的真实环境**。提 PR 前请先跑 `smoke.js`。

## 打包

```powershell
npm run pack        # NSIS 安装程序 + 绿色免安装版
npm run pack:dir    # 仅生成未打包目录(更快,便于测试)
```

产物位于 `dist/`:

- `DeepSeek-Harness-Manager-<version>-setup.exe` —— 安装程序
- `DeepSeek-Harness-Manager-<version>-portable.exe` —— 绿色版

`npm run pack` 会先执行 `scripts/prepack.js`:重建图标并把 base64 内嵌到 `src/icons.js`,因此打包后的应用不依赖磁盘上的图标文件。

### 每次构建的本地留档

`npm run pack` 完成后会自动执行 `scripts/archive-build.js`,把两个可执行文件按版本号复制到本地归档:

```text
<归档根>/v<版本>/
├── DeepSeek-Harness-Manager-<版本>-setup.exe
└── DeepSeek-Harness-Manager-<版本>-portable.exe
```

- 归档根默认是项目上一级的 `DSH-Manager-Releases`,可用 `DSH_MANAGER_RELEASES_DIR` 覆盖
- 刻意放在 `dist/` 之外 —— `dist/` 会在下次打包时被清空
- CI 环境(`CI=true`)自动跳过;按文件大小幂等,重复执行不会重复复制
- 也可单独执行:`npm run archive`(`npm run archive -- --force` 强制覆盖)

### 把 GitHub Releases 同步到本地

发布版由 CI 在云端构建并发布到 GitHub。若想让**每个已发布版本**(包括云端构建的和历史版本)在本地都有副本,可用同一归档目录做镜像:

```powershell
npm run sync-releases                   # 下载本地缺失的所有版本
npm run sync-releases -- --only v0.1.2  # 只同步指定 tag
npm run sync-releases -- --force        # 已存在也重新下载
```

两条路径写入同一套 `<归档根>/<tag>/` 结构,并按文件大小判定是否需要更新,因此"本地构建的"与"从 Release 下载的"不会冲突。

### 受限网络下打包

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"   # 无代码签名证书时跳过签名
```

若本机存在 HTTPS 拦截(企业代理 / 抓包工具),且其根证书只被 Windows 信任,Node 下载 Electron 二进制时会报
`unable to verify the first certificate`。让 Node 改用 Windows 系统证书库即可(Node ≥ 22.15;Node 20 不支持,请改用上面的镜像变量):

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
```

注意事项:

- `electron-builder` 的下载缓存在 `%LOCALAPPDATA%\electron-builder\Cache`。首次必须联网填充;之后可离线打包
- 不要提交 `dist/` 与各类缓存 —— 它们已在 `.gitignore` 中

## 截图

```powershell
npm run screenshots
```

会以 `--screenshots` 启动应用,依次切换视图并用 Electron 的 `capturePage()` 输出
`docs/screenshots/{overview,plugins,diagnose}.png`。因为直接来自真实渲染进程,截图不会与实际界面脱节。

## 发布

发布由 GitHub Actions([`.github/workflows/release.yml`](../../.github/workflows/release.yml))在推送 tag 时完成:

```powershell
git tag v0.1.4
git push origin v0.1.4
```

流程会安装依赖、执行 `npm run pack`,并创建一个附带两个可执行文件的 GitHub Release。`electron-builder` 以
`--publish never` 运行,发布交由 workflow 自己的 `gh release create` 完成,因此不需要任何个人访问令牌(PAT)。

## 目录结构

```text
DeepSeek-Harness-Manager/
├── main.js                 # Electron 主进程 + IPC
├── preload.js              # contextBridge 白名单 API
├── renderer/               # 界面(原生 HTML/CSS/JS,无构建步骤)
├── src/
│   ├── paths.js            # DSH_HOME / 管理器数据路径
│   ├── store.js            # 配置存储(safeStorage 加密)
│   ├── log.js              # 内存环形缓冲 + 文件日志
│   ├── dsh.js              # dsh CLI 封装、进程启动入口
│   ├── tool.js             # npm/pnpm 执行器 + .cmd shim 解析
│   ├── profiles.js         # profile 扫描、创建、元数据
│   ├── overrides.js        # 管理器自有的启停状态补丁
│   ├── plugins/            # 插件服务
│   │   ├── sources/        #   npm / github / local 适配器
│   │   └── resolver.js     #   插件依赖解析
│   ├── status.js           # 进程监管、状态轮询、运行记录
│   ├── history.js          # 运行历史记录
│   ├── diagnose.js         # 诊断中心
│   ├── update.js           # 版本检测 / 备份 / 更新 / 回滚
│   ├── env.js              # 环境检测 / 安装 / 卸载
│   ├── compat.js           # 插件解析兼容性检测与修复
│   ├── security.js         # 凭据与文件权限审计
│   ├── balance.js          # DeepSeek API 余额
│   ├── icons.js            # 内嵌图标(prepack 生成)
│   └── tray.js             # 系统托盘
├── scripts/                # 冒烟/端到端测试、图标生成、prepack
├── docs/                   # 文档
└── assets/                 # 图标源文件(ico/png)
```

## 设计要点

- **启停状态归管理器所有**:写入 `~/.dsh-manager/plugins/<profile>/overrides/state.yml`,启动时通过 `dsh --patch` 传入。
  profile 自己的 `cordis.patch.yml` 与插件包始终不被修改,所以 DSH 升级不会覆盖你的选择
- **DSH 始终用真实 `node.exe` 启动**:Electron 内建的 Node(`ELECTRON_RUN_AS_NODE`)会让 DSH 走 require
  `--expose-internals` 的 HMR 路径,导致 profile 启动中断 —— 这是实测结论,不是推测
- **Windows `.cmd` shim 只解析不执行**:`tool.js` 从中提取真实 JS 入口(`npm-cli.js`、`pnpm.cjs`,或
  `SET "VAR=path"` 变量式写法)后直接用 Node 运行,规避 shell 引号问题与注入风险
- **插件解析兼容性**:新版 DSH 会从全局安装位置解析 bundle 插件。`compat.js` 会以 loader 自身路径为基准做检测,
  并可通过在全局 `node_modules` 创建目录联接来修复(不复制文件、不下载、可逆)
- **数据目录**:`~/.dsh-manager/`(配置、备份、历史、日志、报告)。删掉即重置管理器

## DSH 入口插件(`plugin/`)

`plugin/` 是一个独立的 DSH 插件,自带 `package.json`(`dsh.bundle` 声明 + `dsh-plugin` 关键词),
向 DSH Web 界面注入一个启动胶囊按钮,没有构建步骤、没有依赖。

- 宿主侧(`lib/index.js`)通过 `ctx.webServer` 注册三个本机路由,并用 `tapIndex` 追加一段 `<script>`:
  `/dsh-manager/status.json`、`/dsh-manager/launch`、`/dsh-manager/panel.js`。若拿不到 `ctx.webServer`
  就静默退出,因此**永远不会拖垮 profile 启动**
- 定位管理器:`DSH_MANAGER_EXE` → `~/.dsh-manager/install.json`(打包版启动时自动写入)→ 常见安装路径,
  启动的就是这个确切的可执行文件,不做猜测
- 两条自检:`node plugin/test/host.test.js`(mock 宿主上下文)与 `node plugin/test/boot-check.mjs`(真实启动 dsh)

`boot-check.mjs` 会在 `.dshm-plugin-check/` 下建一个一次性 profile,用
`dsh plugin --profile mgr-test add link:<仓库>/plugin` 装插件,在隔离 `DSH_HOME` 下以
`--port 3099 --no-open` 启动,校验全部路由后自动清理 —— **不会碰你真实的 `~/.dsh`,也不会碰 3080 上的服务**。
正式安装:

```powershell
dsh plugin --profile web add link:<仓库>/plugin   # 之后重启 dsh web
```

若把包发布到 npm,即可用 `dsh plugin --profile web add dsh-harness-manager` 安装;相关说明与
awesome-list 收录用的 YAML 见 [plugin/README.md](../../plugin/README.md)。

## 环境变量

| 变量 | 作用 |
|---|---|
| `DSH_HOME` | DSH 数据与 profile 所在目录(默认 `~/.dsh`) |
| `DSH_MANAGER_HOME` | 管理器数据目录(默认 `~/.dsh-manager`) |
| `DSH_CLI_BIN` | 显式指定 dsh CLI 入口路径,跳过自动探测 |
| `DSH_MANAGER_ALLOW_PLAIN` | 设为 `1` 时允许明文保存密钥 —— **仅用于测试** |
| `DSH_MANAGER_RELEASES_DIR` | 构建产物的本地归档根目录(默认项目上一级的 `DSH-Manager-Releases`) |
| `ELECTRON_MIRROR`、`ELECTRON_BUILDER_BINARIES_MIRROR` | 构建期下载镜像 |
| `CSC_IDENTITY_AUTO_DISCOVERY` | 设为 `false` 跳过代码签名 |
