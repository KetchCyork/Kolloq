# Core API

`@newvector/core` exports the provider-agnostic runtime. It is browser-safe — Node-only tools live in `@newvector/core/node`.

## `createProvider(config)`

Returns a provider instance for the given config.

```ts
import { createProvider } from "@newvector/core";

const provider = createProvider({
  provider: "anthropic",
  model: "claude-3-5-sonnet-20241022",
  apiKey: process.env.ANTHROPIC_API_KEY,
});
```

**Config fields:**

| Field      | Type           | Description                                      |
|------------|----------------|--------------------------------------------------|
| `provider` | `ProviderName` | `"anthropic"`, `"openai"`, `"google"`, `"ollama"`, `"openrouter"` |
| `model`    | `string`       | Provider-specific model ID                       |
| `apiKey`   | `string?`      | API key (not needed for Ollama)                  |
| `baseURL`  | `string?`      | Override base URL (useful for Ollama)            |

## `AgentRunner`

Runs the agent loop: sends messages, handles tool calls, emits events.

```ts
import { AgentRunner, ToolRegistry } from "@newvector/core";

const runner = new AgentRunner({
  provider,
  tools: new ToolRegistry(),
  systemPrompt: "You are a helpful assistant.",
  onEvent: (event) => console.log(event),
});

await runner.run([{ role: "user", content: "Hello" }]);
```

## `defineTool(definition)`

Creates a typed tool definition.

```ts
import { defineTool } from "@newvector/core";

const greetTool = defineTool({
  name: "greet",
  description: "Greet someone by name",
  parameters: {
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
  },
  execute: async ({ name }) => `Hello, ${name}!`,
});
```

## `ToolRegistry`

Holds a set of tools available to the agent.

```ts
import { ToolRegistry } from "@newvector/core";

const registry = new ToolRegistry();
registry.register(greetTool);
```

## Node-only exports (`@newvector/core/node`)

```ts
import { fsTool, shellTool, codeInterpreterTool, loadPlugins } from "@newvector/core/node";
```

These import `node:fs`, `node:child_process`, etc. and must not be bundled for the browser.
