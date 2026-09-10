# Privacy

Short version: **DSH Manager has no telemetry and no account.** It stores its data in one folder on your
machine, sends secrets only to the endpoints they belong to, and you can delete everything by deleting
that folder.

中文说明见 [docs/zh-CN/PRIVACY.md](docs/zh-CN/PRIVACY.md)。

## What is stored, and where

Everything lives under `~/.dsh-manager/` (override with the `DSH_MANAGER_HOME` environment variable):

| Path | Contents |
|---|---|
| `config.json` | Settings, plus the API key / GitHub token **encrypted with Windows DPAPI** (Electron `safeStorage`) |
| `plugins/<profile>/overrides/state.yml` | Which plugins you enabled or disabled (manager-owned) |
| `backups/` | Pre-update backups of the profile's `package.json` and patch files |
| `history/` | Start/stop records (time, duration, exit code) |
| `logs/` | The app log shown in the window |
| `reports/` | Diagnostics reports in Markdown, written only when you run Diagnostics |
| `install.json` | Path and version of the running app, so the DSH entry plugin can find it |

Deleting `~/.dsh-manager/` removes all of it. Uninstalling the app does not touch `~/.dsh/` — that is
DeepSeek Harness's own data directory, and it belongs to DSH.

## Secrets

- API keys and GitHub tokens are encrypted with **Windows DPAPI** (Electron `safeStorage`). They can only
  be decrypted by the same Windows account on the same machine.
- If OS-level encryption is unavailable, the manager **refuses to save the secret in plaintext**
  (fail-closed). Legacy plaintext entries from older builds are migrated to encrypted storage at startup.
- Secrets are held by the Electron main process only and are never sent to the renderer, written to logs,
  included in backups, history or diagnostics reports.
- A secret is sent only to its own endpoint: the DeepSeek API key to `https://api.deepseek.com/user/balance`
  (when you ask for the balance), the GitHub token to `https://api.github.com`.

> ⚠️ **DeepSeek Harness itself stores provider keys in plaintext** in `~/.dsh/.credentials.yaml`. The manager
> never writes there, but Diagnostics warns you about it and can tighten the file's permissions for you
> (breaking inheritance, leaving only *current user / SYSTEM / Administrators*).

## Network requests

The manager contacts a network endpoint only for the action you asked for:

| Feature | Endpoint |
|---|---|
| Update check / update | npm registry (`registry.npmjs.org`) — via `npm view` / `npm install -g` |
| Plugin search & install (npm source) | `registry.npmjs.org` — via the dsh CLI / pnpm |
| Plugin search (GitHub source) | `api.github.com`, `raw.githubusercontent.com` |
| Open a plugin's GitHub page | your default browser, at `github.com` |
| One-click environment install | npm from `registry.npmjs.org`, Node.js from `npmmirror.com` |
| Account balance | `api.deepseek.com` |
| Downloads of this app | `github.com` (your browser) |

The optional **"skip certificate verification for GitHub"** switch (off by default) applies to GitHub
requests only, for networks with TLS interception.

Launching the Harness starts `dsh` on your machine; whatever DSH itself sends (for example to a model
provider) is outside this app's control — see DSH's own documentation.

## Diagnostics reports and logs

Reports and logs contain **local paths, versions, plugin names and permission listings** — not secret
values. They are written to disk only (never uploaded), and only Diagnostics writes a report. Review them
before sharing in a public issue: paths can contain your Windows user name.

There is no built-in log redaction or export yet: `~/.dsh-manager/logs/` is plain text, so read a file
before attaching it.

## Third parties

This app bundles no analytics, no crash reporter and no ad SDK. It does not track usage. The only
third-party code is the dependencies listed in `package.json` (all local, all open source) plus
DeepSeek Harness, which you install separately.

## Changes

If this policy changes, the change will land in this file with the release that introduces it.
Questions or concerns: please open an [issue](https://github.com/sss-1012/DeepSeek-Harness-Manager/issues/new).
