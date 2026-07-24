# @newvector/desktop

Tauri v2 shell that wraps `@newvector/browser` as a native desktop app for
macOS, Windows, and Linux. The Rust side (`src-tauri/`) owns window
chrome, the native OS menu, the system tray icon, OS-keychain-backed
credential storage, and the auto-updater. There is no separate desktop
frontend — `tauri.conf.json` points straight at `../browser`'s dev server
and build output, so the desktop app is always the same UI as the browser
app, just running inside a native window instead of a tab.

## Prerequisites

- Rust (stable) — `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- Platform build tools:
  - macOS: Xcode Command Line Tools (`xcode-select --install`)
  - Windows: Microsoft C++ Build Tools + WebView2 (usually preinstalled on Windows 11)
  - Linux: `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf build-essential libssl-dev` (Debian/Ubuntu package names; see `.github/workflows/desktop-release.yml` for the exact apt invocation)

## Development

```sh
pnpm install
pnpm --filter @newvector/desktop dev      # tauri dev — launches the native window against the Vite dev server
pnpm --filter @newvector/desktop build    # tauri build — produces an unsigned local bundle (app/dmg, msi/nsis, appimage/deb)
```

`tauri dev`/`tauri build` run `pnpm --filter @newvector/browser dev|build` for
you (see `build.beforeDevCommand`/`beforeBuildCommand` in `tauri.conf.json`),
so there's no separate frontend build step.

## Build provenance and installing to /Applications

This machine routinely has several worktrees checked out on different
branches, so "the app in `/Applications` doesn't have my change" is
ambiguous between "it never shipped" and "the installed copy is stale" (see
NEW-120). Two things make that diagnosable:

- **Every build knows what it was built from.** `apps/browser/vite.config.ts`
  inlines the git short SHA, branch, dirty flag, and build timestamp at
  build/dev time; Settings → General → **About** renders them. Read that
  before assuming a change didn't ship.
- **`pnpm desktop:install`** is the one command that rebuilds the desktop
  bundle and installs it to `/Applications/Open Work.app`
  (`apps/desktop/scripts/install.sh`). It refuses (exits non-zero) if the
  checkout is dirty, on a branch other than `main`, or behind
  `origin/main` — `/Applications` is the single shared canonical install
  across every worktree on this machine, so only a clean `main` build
  belongs there. Pass `--force` to override any of those checks (each still
  prints a loud warning).

## OS keychain credential storage

Provider API keys are secrets. In the plain browser build there's no secure
OS-level store available, so they stay inline in the session record in
IndexedDB. Under the desktop shell, `src-tauri/src/keychain.rs` exposes
`set_credential` / `get_credential` / `delete_credential` Tauri commands
backed by the [`keyring`](https://crates.io/crates/keyring) crate, which
talks to:

- macOS: Keychain (`apple-native` feature)
- Windows: Credential Manager (`windows-native` feature)
- Linux: Secret Service over D-Bus (`sync-secret-service` feature)

`apps/browser/src/credentials.ts` + the `persistSession`/`hydrateSession`
helpers in `apps/browser/src/store.tsx` detect the Tauri runtime
(`window.__TAURI_INTERNALS__`) and route `providerConfig.apiKey` through the
keychain instead of IndexedDB whenever it's present — IndexedDB only ever
sees the session with the key stripped out. This is exercised by a real
(non-mocked) round-trip test: `cargo test round_trips_through_the_os_keychain`
in `src-tauri/`.

The browser build's existing behavior (key inline in IndexedDB) is
unchanged — this only activates under Tauri.

## Node sidecar and bundled runtime

The webview front-end (the browser bundle) can't run the Node-only tools — the
Office generators (`docx`/`exceljs`/`pptxgenjs`) and later fs/shell/code-interpreter.
`src-tauri/src/node.rs` bridges to an out-of-process Node **sidecar**: per tool call it
resolves the session sandbox, spawns Node against the sidecar entry script, writes one
JSON request to stdin, and returns stdout to the front-end. `apps/browser/src/nodeContext.ts`
calls the `node_tool_exec` / `node_read_file` commands (the download read-back path).

**In `tauri dev`** the host runs `node sidecar/tool-host.mjs`, resolving
`@newvector/core/node` from the workspace `node_modules` — the developer machine has Node.

**In a packaged app** neither Node nor `node_modules` exist on the user's machine, so
`sidecar/build.mjs` produces two self-contained artifacts, shipped via `bundle.resources`
in `tauri.conf.json`. Both `beforeBuildCommand` and `beforeDevCommand` run it: because the
artifacts are declared resources, Tauri's build script fails the *cargo* compile when they're
missing, so even `tauri dev` needs them staged once on a fresh checkout.

- `sidecar/dist/tool-host.cjs` — the sidecar + `@newvector/core/node` + `docx`/`exceljs`/
  `pptxgenjs` rolled into one file by esbuild. No `node_modules` resolution at runtime.
- `sidecar/runtime/node[.exe]` — the **official** Node binary for the target platform,
  downloaded from nodejs.org and **checksum-verified** against `SHASUMS256.txt`. Official
  builds are self-contained (ICU statically linked, only system libs); a Homebrew/distro
  Node links against separate dylibs and would not run on the user's machine, so we
  download rather than copy the local `process.execPath`. Cached under `sidecar/.node-cache/`.

At runtime `node.rs` resolves `<resource_dir>/sidecar/dist/tool-host.cjs` and
`<resource_dir>/sidecar/runtime/node`, falling back to the dev script + `node` on PATH.
`NEWVECTOR_NODE` overrides the interpreter. All build outputs are git-ignored.

Run the packaging step standalone with `pnpm --filter @newvector/desktop sidecar:bundle`.
The runtime is staged for the **host** platform/arch (what Tauri builds for — the release
matrix runs one native runner per OS); override with `NEWVECTOR_RUNTIME_PLATFORM` / `_ARCH`.

> **macOS signing (overlaps [NEW-43]):** the embedded `runtime/node` binary lands in
> `Contents/Resources/` and, under hardened runtime, must be code-signed with the app's
> identity or Gatekeeper will kill it. Tauri's bundler signs nested resources when a
> signing identity is configured, so this is handled once the Apple Developer cert is in
> place — no extra code changes needed. Unsigned local/dev builds run fine.

## Native menu and system tray

- `src/menu.rs` builds the OS-native menu bar (macOS app menu with
  About/Hide/Quit, File/Edit/Window/Help) using Tauri's predefined items so
  behavior matches OS conventions.
- `src/tray.rs` adds a system tray icon with Show/Quit. Closing the main
  window hides it to the tray instead of quitting (`src/lib.rs`
  `on_window_event`), so the app can keep running as a tray resident.
- Menu items without a native OS equivalent (`New Session`,
  `Check for Updates…`) emit `menu://new-session` / `menu://check-updates`
  Tauri events, listened for in `apps/browser/src/desktopIntegration.ts`.

## Auto-update

`tauri-plugin-updater` is registered in `src-tauri/src/lib.rs` and
configured in `tauri.conf.json` (`plugins.updater`) to check
`https://github.com/KetchCyork/Open-Work/releases/latest/download/latest.json`,
which the release workflow publishes automatically. `Help > Check for
Updates…` (and `desktopIntegration.ts`) calls `check()` /
`downloadAndInstall()` / `relaunch()` from the JS bindings.

The updater signing keypair has been generated (private key never
committed, held only at `~/.tauri/newvector-cowork.key` on the machine that
generated it) and wired in:

- Public key is in `tauri.conf.json` (`plugins.updater.pubkey`).
- Private key + password are set as the `TAURI_SIGNING_PRIVATE_KEY` /
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` GitHub Actions secrets on
  `KetchCyork/Open-Work`.

Updater-signed builds work today even without the paid code-signing certs
below — the OS-level Gatekeeper/SmartScreen warnings are a separate concern
from update-artifact integrity.

## Signed installers via GitHub Actions

`.github/workflows/desktop-release.yml` builds all three platforms on tag
push (`desktop-v*`) or manual dispatch, using `tauri-apps/tauri-action`, and
publishes a draft GitHub Release with installers + `latest.json` for the
updater.

### Build-time app secrets

Separate from code signing, some app features need a secret **at build
time**: Vite inlines `VITE_`-prefixed vars into the web bundle, so a var
that is missing from the build job's environment is baked in as empty and
the feature ships silently disabled.

| Secret | Purpose | Source | Status |
| --- | --- | --- | --- |
| `VITE_GOOGLE_OAUTH_CLIENT_SECRET` | "Continue with Google" on the account gate; without it `googleSignInConfigured()` is false and the button ships disabled | Google Cloud Console → APIs & Services → Credentials → the OAuth client in project `openwork-503111` | ✅ set (2026-07-22) |

Two guards make a missing value a loud failure instead of a degraded
binary:

- the workflow's **`Preflight - required build secrets`** step fails the
  run before the draft release is created, and
- `apps/browser/vite.config.ts` throws when `RELEASE_BUILD=1` (which the
  workflow sets on the build step) and a required var is empty.

A plain `pnpm build` by a contributor without the secret still succeeds —
it only warns — so only release builds are gated. Locally the value comes
from the untracked `apps/browser/.env`.

Note: the account gate that reads this secret is not on `main` yet — it
lives on the design branch (PR #4). Until that merges, Vite has nothing to
inline the value into, so the plumbing above is pre-positioned rather than
load-bearing. It becomes load-bearing the moment the gate lands, which is
the point: the first release after that cannot ship the button disabled.

**Without the Apple/Windows secrets configured, the workflow still runs and
produces installers that are updater-signed but not OS-code-signed** —
unsigned macOS/Windows binaries trigger Gatekeeper/SmartScreen warnings and
should not be distributed publicly. To produce fully signed installers, the
remaining repository secrets are required:

| Secret | Purpose | Source | Status |
| --- | --- | --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` / `_PASSWORD` | Updater artifact signing | `tauri signer generate` (free, local) | ✅ set (2026-07-18) |
| `APPLE_CERTIFICATE` | macOS code signing (.p12, base64) | Apple Developer Program ($99/yr), exported from Keychain Access | ✅ set (2026-07-22) |
| `APPLE_CERTIFICATE_PASSWORD` | Password for the .p12 above | Chosen at export time in Keychain Access | ⏳ pending — CEO to set via `gh secret set` locally (not shared in chat) |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Christopher York (3B9Z7S9DWL)` | Read from local Keychain (`security find-identity -v -p codesigning`) | ✅ set (2026-07-22) |
| `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` | Notarization | Apple Developer Program | ✅ set (2026-07-22) |
| `WINDOWS_CERTIFICATE` / `_PASSWORD` | Windows code signing (.pfx) | Code-signing CA (e.g. DigiCert, ~$300+/yr) or Azure Trusted Signing | ⏳ pending |

CEO approved budget for the Apple Developer Program and a Windows
code-signing cert and is doing the account sign-up personally (identity
verification/payment can't be delegated to an agent). Once those accounts
exist, hand the resulting certificate/credential values to this agent (or
add the secrets directly via `gh secret set <NAME> --repo
KetchCyork/Open-Work`) and the release workflow will start producing fully
signed installers with no further code changes.
