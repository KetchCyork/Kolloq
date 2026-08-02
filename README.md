# Kolloq

A Claude Code–style AI agent harness that runs on any LLM — Anthropic, OpenAI, Google Gemini, Ollama (local), or OpenRouter. Run agents in the browser, from the desktop app, or headless from the CLI.

---

## Features

- **Any provider** — Anthropic, OpenAI, Google Gemini, Ollama (local, no key needed), OpenRouter
- **Browser app** — full chat UI with multi-agent sessions, tool calls, file attachments, import/export
- **Desktop app** — native Tauri shell with OS keychain credential storage
- **CLI** — headless `agent-cli` for scripted use and pipelines
- **Built-in tools** — web search, filesystem, shell execution, code interpreter (Node-only shell); plugin system for custom tools
- **Multi-agent orchestration** — delegate subtasks to named sub-agents from a parent session
- **Advisory Council** — put 2–5 agents (each on its own provider/account) into a multi-round debate that a moderator synthesizes into one answer
- **Preferences** — theme (dark/light/system), default provider/model, rebindable keyboard shortcuts

---

## Quick start

**Prerequisites:** Node ≥ 20, pnpm ≥ 9

```bash
git clone https://github.com/KetchCyork/Open-Work.git
cd Open-Work
pnpm install
pnpm dev          # starts the browser app at http://localhost:5173
```

On first launch the onboarding wizard walks you through picking a provider and storing your API key.

### Headless CLI

```bash
export ANTHROPIC_API_KEY=sk-ant-...
pnpm cli -- --provider anthropic "Summarize the latest news on AI"
```

Provider flags: `--provider anthropic|openai|google|ollama|openrouter`  
For OpenRouter, model IDs are `vendor/model` (e.g. `anthropic/claude-3.5-sonnet`).  
Ollama runs locally — start it with `ollama serve`, no API key required.

---

## Monorepo layout

```
packages/
  core/          # Provider adapters, tool registry, agent runner, permissions
  ui/            # Shared UI component library (WIP)
apps/
  browser/       # Vite + React browser app
  desktop/       # Tauri desktop shell
```

### Core package (`@newvector/core`)

The provider-agnostic runtime. Import from `@newvector/core` for browser-safe exports; use the `@newvector/core/node` subpath for Node-only tools (fs, shell, code interpreter).

```ts
import { AgentRunner, createProvider, defineTool, ToolRegistry } from "@newvector/core";
```

---

## Development

```bash
pnpm install                          # install all workspace deps
pnpm dev                              # browser dev server (port 5173)
pnpm test                             # run all test suites
pnpm typecheck                        # type-check all packages
pnpm --filter @newvector/core cli -- --provider ollama "Hello"
```

### Desktop

```bash
pnpm --filter @newvector/desktop tauri dev
```

Requires Rust + the Tauri v2 CLI. See [Tauri prerequisites](https://tauri.app/start/prerequisites/).

---

## Providers

| Provider    | Key env var            | Notes                                  |
|-------------|------------------------|----------------------------------------|
| Anthropic   | `ANTHROPIC_API_KEY`    | Claude models                          |
| OpenAI      | `OPENAI_API_KEY`       | GPT models                             |
| Google      | `GOOGLE_API_KEY`       | Gemini models                          |
| Ollama      | *(none)*               | Local models; run `ollama serve` first |
| OpenRouter  | `OPENROUTER_API_KEY`   | Any model via openrouter.ai            |

In the browser/desktop app, keys are stored per-account in IndexedDB (or the OS keychain on desktop). They are never committed to git.

---

## Docs

Full documentation lives in `docs/` and is built with VitePress:

```bash
pnpm --filter docs dev    # docs dev server at http://localhost:5174
pnpm --filter docs build  # build static site
```

---

## License

MIT — see [LICENSE](./LICENSE).
