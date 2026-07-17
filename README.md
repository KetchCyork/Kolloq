# New Vector Cowork

pnpm monorepo scaffold for a Claude-Code-like harness that works with any configured LLM provider.

## Layout

- `packages/core` — provider-agnostic `ChatProvider` interface, adapters (OpenAI, Anthropic, Google Gemini, Ollama) built on the Vercel AI SDK, a typed tool registry, and the agent runner loop. Ships a headless CLI (`agent-cli`).
- `packages/ui` — shared chat UI components (placeholder; lands in a later phase).
- `apps/browser` — browser app/extension (placeholder; lands in a later phase).
- `apps/desktop` — desktop app (placeholder; lands in a later phase).

## Getting started

```bash
pnpm install
pnpm --filter @newvector/core test        # unit tests, no API keys required
pnpm --filter @newvector/core typecheck
```

## Running the headless CLI agent

Set the API key env var for whichever provider you want (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`), or run Ollama locally for `--provider ollama` (no key needed). Then:

```bash
pnpm --filter @newvector/core cli -- --provider openai "What's 2 + 2?"
```

No provider calls are made in CI/tests — the agent loop is verified against a scripted fake provider in `packages/core/src/agent/runner.test.ts`.
