# Providers

Kolloq supports five provider backends. All share the same `AgentRunner` interface — only credentials and model IDs differ.

## Anthropic

```bash
export ANTHROPIC_API_KEY=sk-ant-...
pnpm cli -- --provider anthropic --model claude-sonnet-5 "Hello"
```

Get a key at [console.anthropic.com](https://console.anthropic.com) → API Keys.

## OpenAI

```bash
export OPENAI_API_KEY=sk-...
pnpm cli -- --provider openai --model gpt-4o-mini "Hello"
```

Get a key at [platform.openai.com](https://platform.openai.com) → API keys.

## Google Gemini

```bash
export GOOGLE_API_KEY=AIza...
pnpm cli -- --provider google --model gemini-1.5-flash "Hello"
```

Get a key at [aistudio.google.com](https://aistudio.google.com) → Get API key.

## Ollama (local)

No API key required. Start Ollama first:

```bash
ollama serve
ollama pull llama3.1
pnpm cli -- --provider ollama --model llama3.1 "Hello"
```

The default base URL is `http://localhost:11434/v1`. Override it with `--base-url`.

### Reaching Ollama from the browser app over a network address

Ollama only accepts cross-origin requests from localhost. If you open the browser app at anything
other than `localhost` — a LAN IP, or a Tailscale hostname — its direct Ollama calls are
CORS-rejected. The dev and preview servers ship an `/__ollama__` proxy for exactly this case: set
the Ollama account's base URL to `/__ollama__/v1` instead of `http://localhost:11434/v1`, and the
request goes through the app's own origin (the proxy strips `Origin` before forwarding, which
Ollama always allows). Leave the default base URL alone when you're on `localhost`.

## OpenRouter

```bash
export OPENROUTER_API_KEY=sk-or-...
pnpm cli -- --provider openrouter --model anthropic/claude-3.5-sonnet "Hello"
```

Model IDs are `vendor/model`. Browse available models at [openrouter.ai/models](https://openrouter.ai/models).  
Get a key at [openrouter.ai](https://openrouter.ai) → Keys.

## Browser / desktop app

In the UI, each provider is configured as an **account** (Settings → Accounts). One account = one set of credentials + a default model. Sessions reference an account by ID; credentials are stored in IndexedDB (browser) or the OS keychain (desktop).
