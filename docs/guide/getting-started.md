# Getting started

## Prerequisites

- **Node.js** ≥ 20
- **pnpm** ≥ 9 (`npm install -g pnpm`)

## Install

```bash
git clone https://github.com/KetchCyork/Open-Work.git
cd Open-Work
pnpm install
```

## Run the browser app

```bash
pnpm dev
```

Opens at `http://localhost:5173`. On first launch the onboarding wizard walks you through picking a provider and saving your API key.

## Run the headless CLI

```bash
export ANTHROPIC_API_KEY=sk-ant-...
pnpm cli -- --provider anthropic "Summarize the latest news on AI"
```

Swap `anthropic` for `openai`, `google`, `ollama`, or `openrouter`. For Ollama, start `ollama serve` first — no key required.

## Run tests

```bash
pnpm test          # all packages
pnpm typecheck     # type-check only
```

No API keys are needed for the test suite — the agent runner is verified against a scripted fake provider.

## Next steps

- [Configure a provider](./providers.md)
- [Learn about built-in tools](./tools.md)
- [Set up multi-agent orchestration](./multi-agent.md)
