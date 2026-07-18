# Plugin system

The plugin system lets you load custom tools from disk without modifying the core package. Plugins are Node.js ES modules that export a `defineTool` call.

## Creating a plugin

Create a file (e.g. `plugins/my-tool.mjs`):

```js
import { defineTool } from "@newvector/core";

export default defineTool({
  name: "getWeather",
  description: "Get current weather for a city",
  parameters: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
  },
  execute: async ({ city }) => {
    // fetch from a weather API...
    return `The weather in ${city} is sunny.`;
  },
});
```

## Loading plugins

```ts
import { loadPlugins, ToolRegistry } from "@newvector/core/node";

const registry = new ToolRegistry();
await loadPlugins(registry, "./plugins");
```

`loadPlugins` scans the directory for `*.mjs` / `*.js` files, imports each as an ES module, and registers the default export as a tool.

## Plugin security

Plugins run with the same Node.js permissions as the host process. Only load plugins from directories you control. The permission system (`@newvector/core` tool permissions) governs which tool names the agent is allowed to call, but it does not sandbox plugin execution itself.
