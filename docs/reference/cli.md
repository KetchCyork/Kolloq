# CLI reference

The `agent-cli` binary is included in `@newvector/core`.

## Usage

```
pnpm cli -- [options] <prompt>
```

Or after building:

```
./node_modules/.bin/agent-cli [options] <prompt>
```

## Options

| Flag              | Default     | Description                                         |
|-------------------|-------------|-----------------------------------------------------|
| `--provider`      | `anthropic` | Provider: `anthropic`, `openai`, `google`, `ollama`, `openrouter` |
| `--model`         | *(default per provider)* | Model ID                              |
| `--base-url`      | *(provider default)* | Override API base URL                      |
| `--system`        | *(none)*    | System prompt string                                |
| `--orchestration` | false       | Enable multi-agent delegation                       |
| `--tools`         | *(none)*    | Comma-separated list of built-in tools to enable    |
| `--plugins`       | *(none)*    | Path to a directory of plugin files to load         |

## Examples

```bash
# Ask a question
pnpm cli -- --provider openai "What is the capital of France?"

# Use a local Ollama model
pnpm cli -- --provider ollama --model llama3.1 "Explain quantum entanglement"

# Enable web search
pnpm cli -- --provider anthropic --tools webSearch "What happened in tech news today?"

# Load custom plugins
pnpm cli -- --plugins ./my-plugins "Use getWeather to tell me about London"
```

## API keys

The CLI reads keys from environment variables:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
export GOOGLE_API_KEY=AIza...
export OPENROUTER_API_KEY=sk-or-...
```
