# Contributing

Thanks for helping. Bug reports, feature requests, docs fixes and pull requests are all welcome.

中文说明见 [docs/zh-CN/CONTRIBUTING.md](docs/zh-CN/CONTRIBUTING.md)。

## Reporting a problem

Attach the diagnostics report — it usually saves a round trip:

1. Open the app → **Diagnostics** → run a check → the Markdown report is written to `~/.dsh-manager/reports/`.
2. Paste it into the issue (it contains paths and versions, not secrets — but **read it before posting**;
   never paste API keys, tokens or the contents of `~/.dsh/.credentials.yaml`).

Useful extras: the app log from `~/.dsh-manager/logs/`, your Windows version, and the output of
`dsh --version`.

## Setting up

```powershell
git clone https://github.com/sss-1012/DeepSeek-Harness-Manager.git
cd DeepSeek-Harness-Manager
npm install
npm start
```

Requirements: Windows 10/11, Node.js ≥ 20. On restricted networks see
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for mirrors and offline build notes.

## Before you open a PR

```powershell
node scripts/smoke.js             # core modules
node scripts/check-docs.js        # links in READMEs/docs (--offline to skip external probing)
node plugin/test/host.test.js     # only if you touched plugin/
```

If your change affects the UI, regenerate the screenshots with `npm run screenshots` (it drives the real
app via Electron `capturePage`).

## What the code looks like

- **Main process**: CommonJS, `'use strict'`, one concern per file under `src/`. Every renderer capability
  must be added to the `contextBridge` allow-list in `preload.js` and to the IPC handlers in `main.js`.
- **Renderer**: plain HTML/CSS/JS — no framework, no build step. **UI strings are Chinese**; keep them
  consistent with the existing wording.
- **Docs**: bilingual. `README.md` ↔ `README.zh-CN.md`, `docs/*` ↔ `docs/zh-CN/*`. Update both sides, and
  keep claims factual — no invented features or links (`node scripts/check-docs.js` verifies links).
- **Dependencies**: only when there is no reasonable alternative; the packaged app cannot use Node
  built-ins that Electron does not ship (use `node:https`, not `undici`).

## Safety rules

- Never write to a profile's own `cordis.patch.yml` or modify installed plugin packages. Enable/disable
  state is manager-owned (`~/.dsh-manager/plugins/<profile>/overrides/state.yml`, injected via `dsh --patch`).
- Launch dsh with the real `node.exe` (Electron-as-Node aborts the profile boot).
- Never log or echo secrets. The manager stores its own secrets with DPAPI and refuses plaintext fallback.
- Tests must not touch the user's live DSH (`~/.dsh`) or a running server on port 3080 — use an isolated
  `DSH_HOME` and a non-default port, as `plugin/test/boot-check.mjs` does.

## Commits and releases

- Commit subjects use `type(scope): 描述` — `feat` / `fix` / `docs` / `chore` / `ci` / `refactor`, e.g.
  `fix(status): 就绪判定叠加 pidAlive 守卫`. Descriptions are written in Chinese, matching the history.
- Releases are cut by pushing a `v*` tag: `.github/workflows/release.yml` builds on `windows-latest` and
  publishes both installers. Bump `package.json`, `RELEASE_NOTES.md` and `CHANGELOG.md` first.
- `npm run sync-releases` mirrors published releases into the local archive directory.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
