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

**Before this works in a real build**, generate the updater signing keypair
and put the *public* key in `tauri.conf.json` (`plugins.updater.pubkey`,
currently a `REPLACE_WITH_TAURI_UPDATER_PUBLIC_KEY` placeholder):

```sh
pnpm --filter @newvector/desktop exec tauri signer generate -w ~/.tauri/newvector-cowork.key
```

The *private* key must never be committed — store it as the
`TAURI_SIGNING_PRIVATE_KEY` GitHub Actions secret (see below). This is a
credential-generation step, flagged for the CEO rather than done
unilaterally here.

## Signed installers via GitHub Actions

`.github/workflows/desktop-release.yml` builds all three platforms on tag
push (`desktop-v*`) or manual dispatch, using `tauri-apps/tauri-action`, and
publishes a draft GitHub Release with installers + `latest.json` for the
updater.

**Without secrets configured, the workflow still runs and produces
*unsigned* installers** — useful for internal test builds, but unsigned
macOS/Windows binaries trigger Gatekeeper/SmartScreen warnings and should
not be distributed publicly. To produce genuinely signed installers, the
following repository secrets are required — **all of these are paid
services or credentials and need CEO sign-off before purchase/creation**:

| Secret | Purpose | Source |
| --- | --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` / `_PASSWORD` | Updater artifact signing | `tauri signer generate` (free, local) |
| `APPLE_CERTIFICATE` / `_PASSWORD` | macOS code signing (.p12) | Apple Developer Program ($99/yr) |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: New Vector AI (TEAMID)` | Apple Developer Program |
| `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` | Notarization | Apple Developer Program |
| `WINDOWS_CERTIFICATE` / `_PASSWORD` | Windows code signing (.pfx) | Code-signing CA (e.g. DigiCert, ~$300+/yr) or Azure Trusted Signing |

The updater keypair is free and can be generated any time. The Apple and
Windows certificates cost money and require the CEO's go-ahead — flagged in
the NEW-30 issue thread rather than purchased here.
