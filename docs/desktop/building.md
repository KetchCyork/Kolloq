# Building & signing

## Local build (unsigned)

```bash
pnpm --filter @newvector/desktop tauri build
```

Output appears in `apps/desktop/src-tauri/target/release/bundle/`.

## CI builds (signed, all platforms)

Signed release installers for macOS, Windows, and Linux are built automatically by GitHub Actions when a `desktop-v*` tag is pushed:

```bash
git tag desktop-v1.0.0
git push origin desktop-v1.0.0
```

The workflow (`.github/workflows/desktop-release.yml`) produces:
- **macOS** — `.dmg` and `.app.tar.gz` (signed + notarized with Developer ID)
- **Windows** — `.msi` and `.exe` NSIS installer (Authenticode signed)
- **Linux** — `.AppImage` and `.deb`

Installers are uploaded to the GitHub release created for the tag.

## Required secrets

Set these in your GitHub repository → Settings → Secrets:

| Secret                       | Description                                      |
|------------------------------|--------------------------------------------------|
| `APPLE_CERTIFICATE`          | Base64-encoded `.p12` Developer ID certificate   |
| `APPLE_CERTIFICATE_PASSWORD` | Password for the `.p12` file                     |
| `APPLE_SIGNING_IDENTITY`     | Certificate common name (e.g. `Developer ID Application: …`) |
| `APPLE_ID`                   | Apple ID email for notarization                  |
| `APPLE_TEAM_ID`              | Apple Developer team ID                          |
| `APPLE_PASSWORD`             | App-specific password for notarization           |
| `WINDOWS_CERTIFICATE`        | Base64-encoded PFX certificate                   |
| `WINDOWS_CERTIFICATE_PASSWORD` | Password for the PFX file                      |
| `TAURI_SIGNING_PRIVATE_KEY`  | Tauri updater signing key (private)              |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for the updater signing key    |

> **Note:** Do not start signing setup until local end-to-end testing is confirmed clean on all three platforms. Tracked in NEW-43.
