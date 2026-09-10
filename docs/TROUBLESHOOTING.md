# Troubleshooting

Common problems and what to do about them. When in doubt, run **Diagnostics** in the app first — it writes a Markdown report to `~/.dsh-manager/reports/` that you can attach to an issue.

## The Harness will not start

The app extracts the real reason from the DSH boot output and shows it in a toast plus the log panel. The three failures seen in practice:

| Symptom in the log | Cause | Fix |
|---|---|---|
| `failed to import loader entry <pkg>` / `plugin tree failed to load` | A new DSH version resolves bundle plugins from a different location than the profile's `node_modules` | Open the update panel → **Plugin compatibility check** → repair. This creates junctions in the global `node_modules` (no copies, reversible). |
| `EADDRINUSE` / port already in use | Another Harness instance is still running | Stop the other instance, or change the monitored port in **Launch settings** |
| `--expose-internals is required for HMR service` | You are running a manager build older than **v0.1.2**, which launched DSH with Electron's bundled Node | Upgrade the manager — v0.1.2+ starts DSH with the real `node.exe` |

## Harness is not detected

The dashboard shows the DSH version it can find next to `dsh CLI`. If that row is empty:

1. Open a terminal and run `dsh --version`. If the command is unknown, the CLI is not installed (or not on `PATH`).
2. Install it with the dashboard's one-click install, or manually: `npm install -g @deepseek-ai/dsh`.
3. If it works in the terminal but not in the manager, the manager could not locate the CLI. Set `DSH_CLI_BIN` to the absolute path of `.../node_modules/@deepseek-ai/dsh/lib/bin.js`.

## Plugin installation fails

- **npm/pnpm problems** — verify both work in a normal terminal. Profile-local installs use pnpm: `npm install -g pnpm`.
- **`fetch failed` from GitHub on a restricted network** — the network is probably intercepting TLS. In the search panel, press *skip certificate verification* and retry, or use the npm / local source. This switch is off by default and only affects GitHub requests.
- **Package not found** — check the exact name. Scoped packages need their full name (`@scope/pkg`).
- **Install succeeds but the plugin does not load** — run **Diagnostics**: the plugin-resolution check reports exactly which bundle cannot be resolved.

## HTTPS certificate errors

### While using GitHub features in the app

Turn on the *GitHub: skip certificate verification* switch in Settings (off by default).

### While installing dependencies or packaging

Node does not trust a locally installed interception CA by default. Options:

1. Point Node at the Windows certificate store (Node ≥ 22.15):
   ```powershell
   $env:NODE_OPTIONS = "--use-system-ca"
   ```
2. Or use mirrors that are reachable:
   ```powershell
   $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
   $env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
   ```
3. Or add the interception CA to Node's `NODE_EXTRA_CA_CERTS`.

## The update did not finish / the Harness broke after updating

1. Open **Diagnostics**. After every update the manager self-checks plugin resolution and offers a one-click repair.
2. Roll back if needed: the update panel lists the automatic backups (version and profile configuration). *Roll back to this version* reinstalls the recorded version and restores the profiles' `package.json` / `cordis.patch.yml`.
3. If a rollback is not enough, reinstall a specific version manually: `npm install -g @deepseek-ai/dsh@<version>`.

## Plugin enable/disable does not take effect

Enable/disable state is injected at launch time, so a running profile keeps its old state. Stop and start the profile again. State lives in `~/.dsh-manager/plugins/<profile>/overrides/state.yml`.

## Where is my data?

| Path | Contents |
|---|---|
| `~/.dsh/` | DSH itself: profiles, sessions, credentials (`.credentials.yaml`) |
| `~/.dsh-manager/config.json` | Manager settings and the encrypted secrets |
| `~/.dsh-manager/plugins/<profile>/overrides/` | Enable/disable patch state |
| `~/.dsh-manager/backups/` | Pre-update backups (version + profile configuration) |
| `~/.dsh-manager/history/`, `~/.dsh-manager/logs/`, `~/.dsh-manager/reports/` | Runtime history, logs, diagnostic reports |

Deleting `~/.dsh-manager/` resets the manager (your DSH profiles and sessions are unaffected).

## Credentials and file permissions

- The manager stores secrets with Windows DPAPI; if OS encryption is unavailable it refuses to store them in plaintext.
- **DSH itself keeps provider keys in plaintext** in `~/.dsh/.credentials.yaml`. Diagnostics warns about this and can tighten the file's permissions (inheritance removed; only current user / SYSTEM / Administrators).
- Re-run **🔒 Harden secret file permissions** after a DSH update, since the file may be recreated with inherited permissions.
