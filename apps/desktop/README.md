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
  bundle and installs it to `/Applications/Kolloq.app`
  (`apps/desktop/scripts/install.sh`). It refuses (exits non-zero) if the
  checkout is dirty, on a branch other than `main`, or behind
  `origin/main` — `/Applications` is the single shared canonical install
  across every worktree on this machine, so only a clean `main` build
  belongs there. Pass `--force` to override any of those checks (each still
  prints a loud warning).

## QA / dev builds vs. the canonical `/Applications` install

`/Applications/Kolloq.app` (identifier `ai.newvector.cowork`) is the
**canonical, `main`-only build the board verifies against**. Only write it
when you are explicitly refreshing that canonical build (e.g. installing a
signed release, or a `main`-branch build for board verification) — say so in
the issue when you do, since it replaces whatever was previously installed
there.

**Per-issue pinned copies in `/Applications` (e.g.
`/Applications/Kolloq (NEW-<id> QA).app`) are prohibited**, not merely
discouraged — every such bundle still carries the `ai.newvector.cowork`
family of identifiers, so pinning one there just renames the collision
instead of removing it. Use `qa-build` below instead. The sole exception is
`/Applications/Kolloq (NEW-42 QA).app`, a pre-convention artifact that
stays only until NEW-42 leaves `in_review`, at which point QA removes it.

Every other desktop build — local dev, QA verification builds, anything run
from a worktree — must use:

```sh
pnpm --filter @newvector/desktop qa-build [--debug]
```

This builds with a **branch-suffixed identifier and product name**
(`ai.newvector.cowork.qa.<branch-slug>`, `Kolloq (QA <branch>)`) and
installs the result to `~/Desktop/OpenWork-QA-Builds/<branch-slug>/` —
never to `/Applications`. Because the bundle identifier differs from the
canonical one, a QA build can never overwrite `/Applications/Kolloq.app`
or hijack what LaunchServices resolves `ai.newvector.cowork` to, no matter
how many worktrees have one installed at once. Run it, then `open` the
printed path directly rather than launching "Kolloq" from Spotlight/Dock
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

Separate from code signing, some app features need a value **at build
time**: Vite inlines `VITE_`-prefixed vars into the web bundle, so a var
that is missing from the build job's environment is baked in as empty and
the feature ships silently disabled. Most of these are real secrets from
the repo's secret store; `VITE_BILLING_API_URL` is not sensitive (it's the
billing worker's public URL) and is baked into
`.github/workflows/desktop-release.yml` as a literal instead.

| Var | Purpose | Source | Status |
| --- | --- | --- | --- |
| `VITE_GOOGLE_OAUTH_CLIENT_SECRET` | "Continue with Google" on the account gate; without it `googleSignInConfigured()` is false and the button ships disabled | Google Cloud Console → APIs & Services → Credentials → the OAuth client in project `openwork-503111` | ✅ set (2026-07-22) |
| `VITE_BILLING_API_URL` | Plan/upgrade/portal buttons on Account & Plan; without it `billingConfigured()` is false and they ship disabled (NEW-235) | `https://newvector-billing-worker.kolloq.workers.dev` — live billing worker (`services/billing-worker`), not a secret | ✅ wired into desktop-release.yml (2026-08-09) |

Two guards make a missing value a loud failure instead of a degraded
binary:

- the workflow's **`Preflight - required build secrets`** step fails the
  run before the draft release is created, for the actual secret
  (`VITE_GOOGLE_OAUTH_CLIENT_SECRET`) — `VITE_BILLING_API_URL` is a literal
  in the workflow, not a secret, so there's nothing for this step to check;
  and
- `apps/browser/vite.config.ts` throws when `RELEASE_BUILD=1` (which the
  workflow sets on the build step) and *any* required var is empty,
  including `VITE_BILLING_API_URL` — this is the guard that would have
  caught NEW-235 had it existed then.

A plain `pnpm build` by a contributor without these still succeeds — it
only warns — so only release builds are gated. Locally the values come
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
| `AZURE_TENANT_ID` | Windows code signing — Azure AD (Entra ID) **directory/tenant** GUID | Azure Portal → **Microsoft Entra ID → Overview → "Tenant ID"** (not any ID shown on the Trusted Signing resource blade) | ✅ confirmed correct (2026-07-26) — the 2026-07-26 15:50 UTC run got past `az login`'s tenant/app lookup entirely (no more `AADSTS90002`/`AADSTS700016`). |
| `AZURE_TRUSTED_SIGNING_ACCOUNT` | Windows code signing — Trusted Signing account name | Azure Portal | ✅ set (2026-07-24), value `NewVentureAI` |
| `AZURE_TRUSTED_SIGNING_ENDPOINT` | Windows code signing — account's region endpoint | Azure Portal | ✅ set (2026-07-24), value `https://eus.codesigning.azure.net/` |
| `AZURE_TRUSTED_SIGNING_CERT_PROFILE` | Windows code signing — certificate **profile name** (the short identifier chosen when creating the profile, *not* the certificate Subject/DN) | Azure Portal → Trusted Signing account → Certificate Profiles | ✅ set (2026-07-24), value `openwork` |
| `AZURE_CLIENT_ID` | Windows code signing — service principal auth for CI (Trusted Signing has no interactive login) | Azure Portal → Microsoft Entra ID → App registrations → new registration, then assign it the "Trusted Signing Certificate Profile Signer" role on the Trusted Signing account | ✅ confirmed correct (2026-07-26) — same run, same reasoning as `AZURE_TENANT_ID` above. Also needs **Reader** at subscription/resource-group scope (see below) — `az login --service-principal` fails with "No subscriptions found" without it, independent of the Signer role. ✅ Reader granted 2026-08-02. |
| `AZURE_CLIENT_SECRET` | Windows code signing — service principal password for the app above | Azure Portal → the App Registration → Certificates & secrets → new client secret → copy the **Value** column immediately (shown once, at creation time only) | ✅ fixed (2026-07-26) — was the Secret ID instead of the Secret Value; corrected via `gh secret set`. |

Windows signing uses [Azure Trusted Signing](https://learn.microsoft.com/en-us/azure/trusted-signing/) rather than a
downloadable `.pfx`: a 2023 CA/Browser Forum rule moved publicly-trusted
code-signing keys to HSM-backed storage, and a physical USB token doesn't
work on GitHub-hosted Windows runners. The release workflow installs
[`trusted-signing-cli`](https://github.com/Levminer/trusted-signing-cli) on
the Windows runner and points Tauri's bundler at it via a
`bundle.windows.signCommand` config override — see
`.github/workflows/desktop-release.yml` for the exact invocation. It signs
only once every secret above is present; a partial set falls back to an
unsigned Windows build rather than breaking the release.

CEO approved budget for the Apple Developer Program and the Azure Trusted
Signing account and is doing the account sign-up / identity verification
personally (can't be delegated to an agent). Apple is fully wired. For
Windows, the account-level values are set; still needed from the CEO:

1. The Trusted Signing **certificate profile name** (Azure Portal →
   Trusted Signing account → Certificate Profiles — a short name like
   `my-cert-profile`, not the Subject/DN already provided).
2. An App Registration (service principal) with the "Trusted Signing
   Certificate Profile Signer" role on the Trusted Signing account, and its
   client ID + client secret.

Once those exist, hand the values to this agent (or add the secrets
directly via `gh secret set <NAME> --repo KetchCyork/Open-Work`) and the
release workflow will start producing fully signed Windows installers with
no further code changes.

**Current blocker (2026-08-02):** with every secret above correct and the
Reader role granted, `az login --service-principal` now succeeds (it lists
"Azure subscription 1") and the build reaches the actual signing call —
progress past every previous failure. But `trusted-signing-cli` /
`signtool.exe` now fails with a generic Trusted Signing service error:

```
Azure.RequestFailedException: Service request failed.
Error information: "Error: SignerSign() failed." (-2147467259/0x80004005)
```

This HRESULT (`E_FAIL`) from the Trusted Signing backend is not
credential-related — auth already succeeded — and no code path in this repo
constructs or touches the signing request beyond invoking the CLI (see
`.github/workflows/desktop-release.yml`, "Build and release (Windows)"
step). The most common cause when this fires immediately after fixing auth
is that the certificate profile's **identity validation** is still
"Submitted"/"In Review" rather than "Completed" — Microsoft manually reviews
Public Trust signing identities (can take a few business days) and the
signing API rejects requests until that review finishes, with this same
generic error. Action needed (portal access, can't be delegated to an
agent): Azure Portal → Trusted Signing Accounts → `NewVentureAI` →
**Identity validations** (or the `openwork` certificate profile's detail
page) → check the validation status. If it's not yet "Completed", the fix is
to wait for Microsoft's review — nothing on the code or secrets side can
speed that up. If it already says "Completed", report back and this needs a
fresh look (possibly an Azure support case, since the CLI's own error
message gives no further detail).

**Update (2026-08-02, run [30765198982](https://github.com/KetchCyork/Open-Work/actions/runs/30765198982)):**
CEO confirmed identity validation shows "Completed" in the portal. The
2026-08-02 20:15 UTC run's full (non-truncated) error trace narrows this
past the generic `SignerSign() failed` line above — the underlying Azure SDK
exception is explicit:

```
Azure.RequestFailedException: Service request failed.
Status: 403 (Forbidden)
   at Azure.CodeSigning.CertificateProfileRestClient.SignAsync(...)
   at Azure.CodeSigning.CertificateProfileClient.StartSignAsync(...)
```

A **403 on the `SignAsync` call itself** (as opposed to a 409/423-style
"not ready" response) is Azure's generic shape for "this principal is not
authorized for this operation on this resource" — i.e. an RBAC problem, not
a provisioning/identity-validation one. Since identity validation is
confirmed done, the next things to check (portal access, can't be delegated
to an agent):

1. **Role scope, not just role presence.** Azure Portal → Trusted Signing
   account `NewVentureAI` → **Access control (IAM)** → Role assignments →
   confirm the `AZURE_CLIENT_ID` app has **"Trusted Signing Certificate
   Profile Signer"** assigned *at the account level* (the account blade's
   own IAM, not a subscription- or resource-group-level assignment — those
   don't automatically inherit down to this resource type the way they do
   for e.g. Reader).
2. **Certificate profile status independent of identity validation.** The
   `openwork` certificate profile itself (Trusted Signing account →
   Certificate Profiles → `openwork`) has its own state separate from the
   identity validation record — confirm it shows **Active**, not
   `Creating`/`Disabled`.
3. **Propagation lag.** If the role assignment in (1) looks correct but was
   added recently, Azure RBAC changes can take 5–15 minutes (occasionally
   longer) to propagate to this resource provider; re-run
   `gh workflow run desktop-release.yml --repo KetchCyork/Open-Work` after a
   short wait rather than assuming the assignment is wrong.
4. If (1)–(3) all check out and 403 persists, this is likely an Azure
   support case — the CLI/SDK surface no more detail than the trace above.
