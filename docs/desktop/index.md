# Desktop app

The desktop app wraps the browser UI in a native [Tauri v2](https://tauri.app) shell. It adds:

- **OS keychain integration** — API keys are stored in the system keychain (macOS Keychain, Windows Credential Manager, libsecret on Linux) instead of IndexedDB, so they never touch disk in plaintext.
- **Native window chrome** — title bar, system tray, native file dialogs.

## Running in development

Install [Rust](https://rustup.rs) and the [Tauri CLI prerequisites](https://tauri.app/start/prerequisites/) for your platform, then:

```bash
pnpm install
pnpm --filter @newvector/desktop tauri dev
```

## Building a release installer

See [Building & signing](./building.md) for platform-specific build steps and code-signing setup.
