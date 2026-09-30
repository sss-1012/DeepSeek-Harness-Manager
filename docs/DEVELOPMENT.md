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
node scripts/check-docs.js # verify every link and image path in the README/docs (--offline skips external probing)
node plugin/test/host.test.js    # DSH entry plugin: routes, injection, branches (mock host, fast)
node plugin/test/boot-check.mjs  # DSH entry plugin: real dsh boot on port 3099 in an isolated DSH_HOME
node plugin/test/resolve-check.mjs web --deep  # read-only: can every bundle of a profile resolve, is its dependency tree complete?
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

### Mirroring GitHub Releases locally

Releases are built by CI and published on GitHub. To keep a local copy of **every** published version — including ones built in the cloud, and older releases — mirror them into the same archive:

```powershell
npm run sync-releases                 # download every version missing locally
npm run sync-releases -- --only v0.1.2  # one specific tag
npm run sync-releases -- --force      # re-download even if present
```

Both paths write to the same `<archive root>/<tag>/` layout and compare by file size, so a locally built version and a downloaded release stay consistent.

### Restricted-network packaging

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
```

If the machine has HTTPS interception (corporate proxy, packet inspection) and its root CA is only trusted by Windows, Node will fail to download the Electron binary with `unable to verify the first certificate`. Let Node use the Windows certificate store instead (Node ≥ 22.15; not available on Node 20 — use the mirror variables there):

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
```

Notes:

- electron-builder's download cache lives in `%LOCALAPPDATA%\electron-builder\Cache`. It must be filled online once; afterwards packaging works offline.
- Never commit `dist/` or the caches — they are git-ignored.

### Code signing (and why SmartScreen blocks the app)

Windows shows **“Windows protected your PC”** (Microsoft Defender SmartScreen) for executables it cannot
attribute to a known publisher. An unsigned binary has no publisher reputation at all, and per
[Microsoft's SmartScreen reputation rules](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)
an unsigned file's reputation starts at zero **per file** and is never inherited by the next version:

- A self-signed certificate behaves exactly like no signature (same warning).
- EV certificates no longer bypass SmartScreen (changed in 2024) — do not pay for EV for this reason.
- Signing does not remove the warning immediately: reputation accumulates from real downloads, but only a
  signed file can accumulate it *at all*. Signing every release with the **same** certificate lets later
  versions inherit it.

Supply credentials and electron-builder signs every executable it produces — the `win-unpacked` main
executable (the one users launch from the Start menu), `elevate.exe`, the uninstaller, the NSIS installer
and the portable exe:

```powershell
# a. .pfx file (exportable certificate from a CA)
$env:WIN_CSC_LINK = "C:\certs\my-code-signing.pfx"   # absolute path, https URL or base64
$env:WIN_CSC_KEY_PASSWORD = "********"               # never commit this
npm run pack

# b. certificate in the Windows store / USB token / HSM — select it by subject name.
#    Passed on the command line so no secret or machine-specific value lands in package.json.
npx electron-builder --win nsis portable --publish never `
  -c.win.signtoolOptions.certificateSubjectName="Your Company Name"
```

`win.signtoolOptions` in [package.json](../package.json) already pins SHA-256-only signing and an RFC-3161
timestamp server. Azure Trusted Signing / Artifact Signing is supported through `win.azureSignOptions`
(see [electron-builder's Windows signing docs](https://www.electron.build/docs/features/code-signing/code-signing-win)),
but check Microsoft's eligibility limits first: public-trust certificates are only issued to organisations
in the US, Canada, the EU, the UK, Australia, New Zealand, Japan, Korea, Singapore, Switzerland, Norway and
Israel, and individual developers must reside in the US or Canada.

#### Do not trust the build log — verify the artifacts

electron-builder prints `signing with signtool.exe` at *info* level **before** it looks for a certificate,
and writes the actual skip only at *debug* level. A build that signed nothing therefore still logs one such
line per file (see `app-builder-lib/out/codeSign/windowsCodeSign.js` vs `windowsSignToolManager.js`).
Check the output instead:

```powershell
npm run verify-signature          # report only: warns and continues when no credentials are configured
npm run verify-signature:strict   # fail (exit 1) if any artifact is not signed
```

`scripts/verify-signature.ps1` prints each artifact's status, signer and SHA-256. It fails automatically
whenever signing credentials *are* configured but the output is unsigned, so a misconfigured certificate
cannot reach a release. Keep the file's UTF-8 BOM: Windows PowerShell 5.1 reads BOM-less files as ANSI and
mis-parses the strings.

In CI the credentials come from repository secrets (`WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`). `npm run pack`
ends with this same check, so it turns into a hard gate as soon as those secrets exist; until then the
release job builds unsigned and only warns.

> `CSC_IDENTITY_AUTO_DISCOVERY` is **macOS-only** and does nothing for Windows builds — it used to be
> documented here as “skip code signing”, which was wrong and hid the real problem. Whether a Windows build
> is signed depends solely on the credentials above.

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
│   ├── desktop.js          # official DeepSeek Harness desktop app detection
│   ├── proc.js             # process enumeration for the update pre-flight
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
- **Plugin resolution compatibility**: newer DSH versions resolve bundle plugins from the global install location. `compat.js` resolves from the loader's own path (it walks up from the dsh bin until it finds the `@deepseek-ai/dsh` package — computing that path one level too high was why the old check always reported "OK"), classifies each bundle (`ok` / `profile-only` / `link-dangling` / `missing` / `load-failed` / `loader-missing`), runs an isolated **load probe** in a child Node process, and repairs by creating directory junctions in the global `node_modules` (no copies, no downloads, reversible) with **immediate re-verification**.
- **The official desktop app owns `profiles/desktop`**: `desktop.js` detects it (registry), `profiles.js` marks that profile `external`/`readOnly`, and every write path (start/stop, plugin enable/disable/update/uninstall, `compat.fixBundles`, backup/restore) refuses it. Upstream states the CLI must not start or modify that profile.
- **Updates and rollbacks run a process pre-flight** (`proc.js` + `runningWorkloads()`): while any managed profile, CLI dsh process or the desktop app is running, the operation is refused, because npm replacing locked files is exactly what produced the historical `EBUSY` + half-updated global install.
- **Data directory**: `~/.dsh-manager/` holds config, backups, history, logs and reports. Deleting it resets the manager.

## DSH entry plugin (`plugin/`)

`plugin/` is a standalone DSH plugin with its own `package.json` (`dsh.bundle` declaration, `dsh-plugin`
keyword). It injects a launcher pill into the DSH web UI and has no build step and no dependencies.

- Host side (`lib/index.js`) registers three local routes through `ctx.webServer` and appends one
  `<script>` with `tapIndex`: `/dsh-manager/status.json`, `/dsh-manager/launch`, `/dsh-manager/panel.js`.
  If `ctx.webServer` is missing the plugin returns quietly, so it can never block a profile boot.
- It locates the manager through `DSH_MANAGER_EXE` → `~/.dsh-manager/install.json` (written by packaged
  builds at startup) → the standard install locations, and starts that exact executable — no guessing.
- Two self-checks: `node plugin/test/host.test.js` (mock host context) and
  `node plugin/test/boot-check.mjs` (real `dsh` boot).

`boot-check.mjs` creates a throwaway profile under `.dshm-plugin-check/`, installs the plugin with
`dsh plugin --profile mgr-test add link:<repo>/plugin`, boots it with `--port 3099 --no-open` under an
isolated `DSH_HOME`, asserts every route and then cleans up — your real `~/.dsh` and any server on 3080 are
never touched. Installing it for real:

```powershell
dsh plugin --profile web add link:<repo>/plugin   # restart dsh web afterwards
```

The package is published to npm, so users install it with `dsh plugin --profile web add dsh-harness-manager`;
see [plugin/README.md](../plugin/README.md) for the local `link:` form, the release steps and the
awesome-list submission file.

## Environment variables

| Variable | Effect |
|---|---|
| `DSH_HOME` | Where profiles and DSH data live (default `~/.dsh`) |
| `DSH_MANAGER_HOME` | Manager data directory (default `~/.dsh-manager`) |
| `DSH_CLI_BIN` | Explicit path to the dsh CLI entry, bypassing auto-detection |
| `DSH_MANAGER_ALLOW_PLAIN` | `1` allows plaintext secret storage — **testing only** |
| `DSH_MANAGER_RELEASES_DIR` | Local archive root for built installers (default `../DSH-Manager-Releases`) |
| `ELECTRON_MIRROR`, `ELECTRON_BUILDER_BINARIES_MIRROR` | Build-time download mirrors |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Windows code-signing certificate (`.pfx` path, https URL or base64) and its password |
| `DSH_MANAGER_DIST_DIR` | Directory `scripts/verify-signature.ps1` inspects (default `dist/`) |
| `CSC_IDENTITY_AUTO_DISCOVERY` | **macOS signing only** — no effect on Windows builds |
