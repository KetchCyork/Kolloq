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

## "Continue with Google" account sign-in

The Open Work account gate (`apps/browser/src/components/SignInScreen.tsx`)
offers a real Google sign-in — OpenID Connect on top of OAuth 2.0 with PKCE,
implemented in `apps/browser/src/openWorkGoogleAuth.ts` plus the Rust
`google_oauth_capture` loopback command in `src-tauri/src/oauth.rs`. The flow:

1. The frontend mints PKCE/`state`/`nonce` and builds Google's real authorize
   URL (`accounts.google.com/o/oauth2/v2/auth`).
2. Rust binds a one-shot loopback listener on `127.0.0.1:8765` and the user is
   sent to Google's consent screen in their system browser.
3. Google redirects back to the loopback with an authorization `code`, which
   Rust captures and returns.
4. The code is exchanged for tokens via the `oauth_token_request` command
   (Google's token endpoint, like Anthropic's, is not callable from a browser
   tab), and the user's verified email is read from the returned `id_token`
   (issuer/audience/nonce/expiry/`email_verified` all checked).

Google removed the out-of-band "paste the code" flow in 2022, so native apps
must use this loopback redirect — that's why it lives in the desktop shell
only. In the plain browser build the Google button is disabled with an
explanatory note; it never mints a fake session.

**Required credential — a Google OAuth Client ID (owner: CEO).** Until one is
provisioned the Google button is disabled ("Google sign-in isn't configured
yet") rather than faking a login. To enable it:

1. In [Google Cloud Console](https://console.cloud.google.com/), create (or
   reuse) a project and configure the OAuth consent screen (External; app name
   "OpenWork"; add your account as a test user while it's unverified).
2. Under **APIs & Services → Credentials → Create credentials → OAuth client
   ID**, choose application type **Desktop app**. No client secret is needed
   (PKCE). Google accepts the `http://127.0.0.1` loopback redirect for desktop
   clients automatically.
3. Provide the resulting Client ID to the build via the
   `VITE_GOOGLE_OAUTH_CLIENT_ID` env var (e.g. an untracked `apps/browser/.env`
   with `VITE_GOOGLE_OAUTH_CLIENT_ID=<id>.apps.googleusercontent.com`, or as a
   CI/build environment variable). No code change required — the button turns
   on automatically once it's set.

Apple and company-SSO have no working path without an Open Work backend, so
those buttons are disabled ("Coming soon") instead of minting fake sessions.

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

**Without the Apple/Windows secrets configured, the workflow still runs and
produces installers that are updater-signed but not OS-code-signed** —
unsigned macOS/Windows binaries trigger Gatekeeper/SmartScreen warnings and
should not be distributed publicly. To produce fully signed installers, the
remaining repository secrets are required:

| Secret | Purpose | Source | Status |
| --- | --- | --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` / `_PASSWORD` | Updater artifact signing | `tauri signer generate` (free, local) | ✅ set (2026-07-18) |
| `APPLE_CERTIFICATE` / `_PASSWORD` | macOS code signing (.p12) | Apple Developer Program ($99/yr) | ⏳ pending — CEO signing up |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: New Vector AI (TEAMID)` | Apple Developer Program | ⏳ pending |
| `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` | Notarization | Apple Developer Program | ⏳ pending |
| `WINDOWS_CERTIFICATE` / `_PASSWORD` | Windows code signing (.pfx) | Code-signing CA (e.g. DigiCert, ~$300+/yr) or Azure Trusted Signing | ⏳ pending |

CEO approved budget for the Apple Developer Program and a Windows
code-signing cert and is doing the account sign-up personally (identity
verification/payment can't be delegated to an agent). Once those accounts
exist, hand the resulting certificate/credential values to this agent (or
add the secrets directly via `gh secret set <NAME> --repo
KetchCyork/Open-Work`) and the release workflow will start producing fully
signed installers with no further code changes.
