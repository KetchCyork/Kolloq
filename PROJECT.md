# Open Work — Project Overview

**Owner:** New Vector AI
**Status:** Phases 1–3 complete and pushed; Phase 4+ in planning ([NEW-26](/NEW/issues/NEW-26))
**Repository:** https://github.com/KetchCyork/Open-Work (private; flips public at Phase 5 launch)
**Local workspace:** `~/AI/multi-llm-harness` (git remote `origin` → the repo above)

## Mission

Open Work is a Claude-Code-like agentic harness that works with any configured LLM
provider (Anthropic, OpenAI, Google Gemini, Ollama, OpenRouter), shipped as a pnpm
monorepo with both a browser app and a native desktop app.

## Repo layout (current, as of Phase 3)

```
Open-Work/
├── LICENSE
├── README.md
├── package.json                 (workspace root: dev/build/test/typecheck scripts)
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── packages/
│   ├── core/                    (@newvector/core — provider-agnostic agent core)
│   │   ├── bin/cli.ts            headless CLI (`agent-cli`)
│   │   └── src/
│   │       ├── agent/            agent runner loop
│   │       ├── providers/        Anthropic/OpenAI/Google/Ollama/OpenRouter adapters (Vercel AI SDK)
│   │       └── tools/             typed tool registry
│   └── ui/                      (@newvector/ui — shared chat UI components)
├── apps/
│   ├── browser/                 (@newvector/browser — Vite + React multi-agent web UI,
│   │                              streaming, IndexedDB persistence, desktop-integration bridge)
│   └── desktop/                 (@newvector/desktop — Tauri v2 shell)
│       └── src-tauri/            Rust: OS keychain, tray/menu, auto-update, signed-release CI
└── .github/workflows/desktop-release.yml
```

## Phase history

1. **Phase 1** (`977989f`) — pnpm monorepo scaffold, provider-agnostic agent core,
   provider adapters, tool registry, headless CLI.
2. **Phase 2** (`fc8c594`) — browser app: multi-agent web UI, streaming, IndexedDB
   persistence.
3. **Phase 3** (`f1e9bd7`) — desktop app: Tauri v2 shell, OS keychain credential storage,
   tray/menu, auto-update, signed-release CI workflow.

All three phases were built in local execution sandboxes and consolidated onto
`origin/main` of `KetchCyork/Open-Work` on 2026-07-17 (see [NEW-33](/NEW/issues/NEW-33)).

## Verified working (2026-07-17)

- Fresh `git clone` + `pnpm install` succeeds.
- `packages/core`: `pnpm build` (tsc) and `pnpm test` (vitest, 5/5 passing) succeed.
- `apps/browser`: `pnpm dev` serves on `http://localhost:5173` (HTTP 200, title
  "Open Work"); `pnpm build` (vite build) succeeds.
- `apps/desktop`: `pnpm build` (`tauri build`) compiles the Rust shell and produces
  a signed-locally `.app` and `.dmg` bundle (requires a Rust toolchain — not bundled
  with the repo, install via https://rustup.rs).

## Next phases

See [NEW-26](/NEW/issues/NEW-26) for the full roadmap and remaining phase breakdown.
Remaining phases (tracked as NEW-31, NEW-32, ...) proceed against this repo now that
it is durable and pushed.

## Naming / visibility

Board-directed 2026-07-17: project name is **Open Work**. Repo is private; flips
public at Phase 5 launch.
