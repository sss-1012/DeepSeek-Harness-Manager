# AGENTS.md — notes for AI coding agents

This file is for automated agents (and humans) working **in this repository**. Read it before editing.

## What this project is

A Windows desktop control center (Electron) for **DeepSeek Harness** (`@deepseek-ai/dsh`): launch/stop
profiles, manage plugins, diagnose the environment, update/roll back the global CLI, audit credentials.
It also ships a small DSH entry plugin under `plugin/`.

## Layout

| Path | What lives there |
|---|---|
| `main.js` | Electron main process: window, tray, IPC handlers, startup self-registration |
| `preload.js` | `contextBridge` surface — every renderer capability is allow-listed here |
| `renderer/` | Plain HTML/CSS/JS UI (no build step). **UI text is Chinese** |
| `src/` | Core modules: `dsh.js` (CLI wrapper), `tool.js` (npm/pnpm runner), `status.js` (process supervision), `plugins/` (+ `sources/`), `compat.js`, `update.js`, `diagnose.js`, `security.js`, `env.js`, `store.js`, `paths.js` |
| `plugin/` | The DSH entry plugin (`lib/index.js` host side, `lib/panel.js` client side) + its tests |
| `scripts/` | `smoke.js`, `check-docs.js`, `prepack.js`, `archive-build.js`, `sync-releases.js`, icon generators |
| `docs/` | Development & troubleshooting docs (English + `docs/zh-CN/`) |

## Commands

```powershell
npm install
npm start                        # run the app
node scripts/smoke.js            # core-module smoke test (no GUI needed)
node scripts/check-docs.js       # verify relative + external links (--offline to skip externals)
node plugin/test/host.test.js    # plugin host-side self-check (mock ctx)
node plugin/test/boot-check.mjs  # plugin end-to-end: isolated profile + real dsh boot on port 3099
npm run pack                     # build installer + portable into dist/ (also archives locally)
```

Before claiming a change works, run at least `smoke.js`, `check-docs.js --offline` and — if you touched
`plugin/` — `plugin/test/host.test.js`.

## Hard rules

1. **Never disturb a running DSH or the user's real profiles.** The user's live session may be served by
   `dsh web` on `127.0.0.1:3080`. Do not stop it, do not rewrite `~/.dsh/profiles/web/**`, and never delete
   files under `~/.dsh` or `~/.dsh-manager`. End-to-end tests must use an isolated `DSH_HOME` and a
   non-default port (see `plugin/test/boot-check.mjs` for the pattern).
2. **Never print secrets.** `~/.dsh/.credentials.yaml` holds provider keys in plaintext and the manager
   stores its own secrets DPAPI-encrypted. Do not echo, log or copy their values anywhere — not into
   commit messages, issues, docs or chat. When a test needs a key, use a mock (`scripts/smoke.js` does).
3. **Chat with the maintainer before adding application features.** For this project the maintainer wants
   implementation details and expected behaviour agreed first; docs, tests and fixes can proceed directly.
4. **Do not silently change product behaviour.** Enable/disable state belongs to the manager
   (`~/.dsh-manager/plugins/<profile>/overrides/state.yml`, injected via `dsh --patch`); never write to a
   profile's own `cordis.patch.yml` or modify installed plugin packages.
5. **Launch dsh with the real `node.exe`.** Using Electron's bundled Node (`ELECTRON_RUN_AS_NODE`) aborts
   the profile boot with `hmr: --expose-internals is required`. `src/dsh.js` already handles this.
6. **Keep the READMEs factual.** No invented features, screenshots or links. `README.md` is English,
   `README.zh-CN.md` is Chinese and both must stay in sync; the same applies to `docs/` vs `docs/zh-CN/`.
7. **Dependencies are a last resort.** `renderer/` has no build step by design; the packaged app must not
   depend on Node built-ins Electron lacks (e.g. `undici`) — use `node:https`.

## Release flow

1. Bump `version` in `package.json`, add a section to `RELEASE_NOTES.md` (and `CHANGELOG.md`).
2. Rebuild: `npm run pack` (this writes `dist/` **and** copies the installers into the local archive
   `<archiveRoot>/v<version>/`, default `E:\Work\DSH-Manager-Releases` — the maintainer wants a local copy
   of every published build).
3. Push a `v*` tag; `.github/workflows/release.yml` builds on `windows-latest` and publishes the GitHub
   Release. CI must pass first (`.github/workflows/ci.yml`).
4. Optional: `npm run sync-releases` mirrors every published release back into the same archive.

## Definition of done

- Behaviour verified by actually running it (not by reading code), with the evidence stated plainly.
- Tests/docs updated when they describe what changed.
- No leftover state: test profiles, temp dirs, background jobs and junctions cleaned up.
