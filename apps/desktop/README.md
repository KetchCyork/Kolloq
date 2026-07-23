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

## QA / dev builds vs. the canonical `/Applications` install

`/Applications/Open Work.app` (identifier `ai.newvector.cowork`) is the
**canonical, `main`-only build the board verifies against**. Only write it
when you are explicitly refreshing that canonical build (e.g. installing a
signed release, or a `main`-branch build for board verification) — say so in
the issue when you do, since it replaces whatever was previously installed
there.

**Per-issue pinned copies in `/Applications` (e.g.
`/Applications/Open Work (NEW-<id> QA).app`) are prohibited**, not merely
discouraged — every such bundle still carries the `ai.newvector.cowork`
family of identifiers, so pinning one there just renames the collision
instead of removing it. Use `qa-build` below instead. The sole exception is
`/Applications/Open Work (NEW-42 QA).app`, a pre-convention artifact that
stays only until NEW-42 leaves `in_review`, at which point QA removes it.

Every other desktop build — local dev, QA verification builds, anything run
from a worktree — must use:

```sh
pnpm --filter @newvector/desktop qa-build [--debug]
```

This builds with a **branch-suffixed identifier and product name**
(`ai.newvector.cowork.qa.<branch-slug>`, `Open Work (QA <branch>)`) and
installs the result to `~/Desktop/OpenWork-QA-Builds/<branch-slug>/` —
never to `/Applications`. Because the bundle identifier differs from the
canonical one, a QA build can never overwrite `/Applications/Open Work.app`
or hijack what LaunchServices resolves `ai.newvector.cowork` to, no matter
how many worktrees have one installed at once. Run it, then `open` the
printed path directly rather than launching "Open Work" from Spotlight/Dock
(that always resolves to the canonical build).

`pnpm dev` / `pnpm build` / `qa-build` all run
`scripts/ensure-target-unindexed.sh` first, which drops a
`.metadata_never_index` marker in `src-tauri/target/`. That tells Spotlight
not to index that worktree's build output at all, so a `target/.../bundle`
directory can never itself become a claimant on `ai.newvector.cowork` the
way NEW-160 found. `cargo clean` deletes `target/` (and the marker with it),
so the marker is recreated on every build rather than being a one-time setup
step.

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
