# Development

Everything you need to run, test, package and understand DeepSeek Harness Manager from source.

## Requirements

- Windows 10 / 11 (x64)
- Node.js ≥ 20 (npm included)
- A globally installed DeepSeek Harness CLI — `npm install -g @deepseek-ai/dsh`
- pnpm (`npm install -g pnpm`) for profile-local plugin installs

## Getting started

```powershell
git clone https://github.com/sss-1012/DeepSeek-Harness-Manager.git
cd DeepSeek-Harness-Manager
npm install
npm start
```

### Mirror configuration (restricted networks)

If your network cannot reach the Electron binary host, set a mirror before `npm install`:

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
```

## Tests

```powershell
node scripts/smoke.js      # module-level smoke test (store, overrides, profiles, plugins, dsh, sources, resolver, update, history, diagnostics)
node scripts/e2e.js        # end-to-end flow in an isolated DSH_HOME
node scripts/e2e2.js       # uninstall + update-backup flows in an isolated environment
node scripts/check-docs.js # verify every link and image path in the README/docs
```

Both e2e scripts create their own throwaway `DSH_HOME` / manager home directories, so they never touch your real environment. Please run `smoke.js` before opening a pull request.

## Packaging

```powershell
npm run pack        # NSIS installer + portable executable
npm run pack:dir    # unpacked directory only (faster, for testing)
```

Artifacts land in `dist/`:

- `DeepSeek-Harness-Manager-<version>-setup.exe` — installer
- `DeepSeek-Harness-Manager-<version>-portable.exe` — portable

`npm run pack` first runs `scripts/prepack.js`, which regenerates the icons and embeds them as base64 into `src/icons.js`, so the packaged app never depends on icon files being present on disk.

### Local archive of every build

When `npm run pack` finishes it also runs `scripts/archive-build.js`, which copies both executables into a versioned local archive:

```text
<archive root>/v<version>/
├── DeepSeek-Harness-Manager-<version>-setup.exe
└── DeepSeek-Harness-Manager-<version>-portable.exe
```

- Archive root defaults to `../DSH-Manager-Releases` (next to the project) and can be changed with `DSH_MANAGER_RELEASES_DIR`.
- It is deliberately outside `dist/`, which gets wiped on the next build.
- Skipped automatically in CI (`CI=true`), and idempotent by file size.
- Re-run it alone with `npm run archive` (add `--force` to overwrite: `npm run archive -- --force`).

### Restricted-network packaging

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"   # skip code signing when no certificate is available
```

If the machine has HTTPS interception (corporate proxy, packet inspection) and its root CA is only trusted by Windows, Node will fail to download the Electron binary with `unable to verify the first certificate`. Let Node use the Windows certificate store instead (Node ≥ 22.15; not available on Node 20 — use the mirror variables there):

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
```

Notes:

- electron-builder's download cache lives in `%LOCALAPPDATA%\electron-builder\Cache`. It must be filled online once; afterwards packaging works offline.
- Never commit `dist/` or the caches — they are git-ignored.

## Screenshots

```powershell
npm run screenshots
```

Launches the app with `--screenshots`, switches through the views and writes `docs/screenshots/{overview,plugins,diagnose}.png` using Electron's `capturePage()`. Because the images come from the real renderer, they stay close to the shipped UI.

## Releasing

Releases are built by GitHub Actions ([`.github/workflows/release.yml`](../.github/workflows/release.yml)) on tag push:

```powershell
git tag v0.1.4
git push origin v0.1.4
```

The workflow installs dependencies, runs `npm run pack` and creates a GitHub Release with both executables attached. `electron-builder` runs with `--publish never` — publishing is done by the workflow's own `gh release create`, so no personal access token is needed.

## Project layout

```text
DeepSeek-Harness-Manager/
├── main.js                 # Electron main process + IPC handlers
├── preload.js              # contextBridge allow-listed API
├── renderer/               # UI (plain HTML/CSS/JS, no build step)
├── src/
│   ├── paths.js            # DSH_HOME / manager data paths
│   ├── store.js            # config storage (safeStorage encryption)
│   ├── log.js              # in-memory ring buffer + file log
│   ├── dsh.js              # dsh CLI wrapper, process supervision entry
│   ├── tool.js             # npm/pnpm runner + .cmd shim resolution
│   ├── profiles.js         # profile discovery, creation, metadata
│   ├── overrides.js        # manager-owned enable/disable patch
│   ├── plugins/            # plugin service
│   │   ├── sources/        #   npm / github / local adapters
│   │   └── resolver.js     #   plugin dependency resolver
│   ├── status.js           # process supervision, status polling, history
│   ├── history.js          # runtime history records
│   ├── diagnose.js         # diagnostics center
│   ├── update.js           # version check / backup / update / rollback
│   ├── env.js              # environment detect / install / uninstall
│   ├── compat.js           # plugin-resolution compatibility + repair
│   ├── security.js         # credential & file-permission audit
│   ├── balance.js          # DeepSeek API balance
│   ├── icons.js            # embedded icons (generated by prepack)
│   └── tray.js             # system tray
├── scripts/                # smoke/e2e tests, icon generation, prepack
├── docs/                   # this documentation
└── assets/                 # icon sources (ico/png)
```

## Design notes

- **The manager owns enable/disable state.** It writes `~/.dsh-manager/plugins/<profile>/overrides/state.yml` and passes it at launch via `dsh --patch`. The profile's `cordis.patch.yml` and the plugin packages stay untouched, so a DSH upgrade cannot overwrite your choices.
- **DSH is always launched with the real `node.exe`.** Electron's bundled Node (`ELECTRON_RUN_AS_NODE`) makes DSH take an HMR path that requires `--expose-internals` and aborts the profile boot — measured, not theoretical.
- **Windows `.cmd` shims are parsed**, not executed through a shell: `tool.js` extracts the real JS entry point (`npm-cli.js`, `pnpm.cjs`, or a variable-based `SET "VAR=path"` form) and runs it with Node, which avoids shell quoting bugs and injection.
- **Plugin resolution compatibility**: newer DSH versions resolve bundle plugins from the global install location. `compat.js` checks resolvability from the loader's own path and can repair it by creating directory junctions in the global `node_modules` (no copies, no downloads, reversible).
- **Data directory**: `~/.dsh-manager/` holds config, backups, history, logs and reports. Deleting it resets the manager.

## Environment variables

| Variable | Effect |
|---|---|
| `DSH_HOME` | Where profiles and DSH data live (default `~/.dsh`) |
| `DSH_MANAGER_HOME` | Manager data directory (default `~/.dsh-manager`) |
| `DSH_CLI_BIN` | Explicit path to the dsh CLI entry, bypassing auto-detection |
| `DSH_MANAGER_ALLOW_PLAIN` | `1` allows plaintext secret storage — **testing only** |
| `DSH_MANAGER_RELEASES_DIR` | Local archive root for built installers (default `../DSH-Manager-Releases`) |
| `ELECTRON_MIRROR`, `ELECTRON_BUILDER_BINARIES_MIRROR` | Build-time download mirrors |
| `CSC_IDENTITY_AUTO_DISCOVERY` | `false` skips code signing |
