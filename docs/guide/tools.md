# Built-in tools

Tools extend what agents can do beyond generating text. Each tool has a name, description, and typed input schema. The agent decides when to call them; the runner executes them and feeds results back.

## Available tools

| Tool             | Import path                      | Notes                                   |
|------------------|----------------------------------|-----------------------------------------|
| `webSearch`      | `@newvector/core`                | Browser-safe; calls a search API        |
| `fs`             | `@newvector/core/node`           | Read/write files; Node.js only          |
| `shell`          | `@newvector/core/node`           | Run shell commands; Node.js only        |
| `codeInterpreter`| `@newvector/core/node`           | Execute JavaScript; Node.js only        |
| `office`         | `@newvector/core/node`           | Generate Word/Excel/PowerPoint; Node.js only |

Node-only tools live under the `@newvector/core/node` subpath so they don't break browser bundles.

## Office document generation

`createOfficeTools(rootDir)` returns three tools that let an agent produce real Microsoft Office
files on request — e.g. "generate this report as a Word doc" or "create an Excel spreadsheet with
this data". Each renders structured content the model supplies into a binary document and writes it
into the same sandboxed `rootDir` used by the `fs` tools, returning `{ path, bytesWritten }`.

| Tool                               | Output   | Input shape                                              |
|------------------------------------|----------|---------------------------------------------------------|
| `generate_word_document`           | `.docx`  | `title?`, `blocks[]` (heading / paragraph / bullets)    |
| `generate_excel_spreadsheet`       | `.xlsx`  | `sheets[]` of `{ name, columns?, rows[][] }`            |
| `generate_powerpoint_presentation` | `.pptx`  | `title?`, `slides[]` of `{ title?, bullets? \| body? }` |

The correct file extension is appended automatically if the model omits it. Because these back onto
the shared filesystem sandbox, an output path that escapes `rootDir` (via `../` or a symlink) is
rejected — the same containment guarantees as `write_file`.

```ts
import { createOfficeTools } from "@newvector/core/node";

for (const tool of createOfficeTools(sandboxDir)) registry.register(tool);
```

The CLI registers these automatically (scoped to `--sandbox-dir`). Generated files land on disk; a
browser/desktop download surface for tool-produced files is tracked as follow-up work.

## Tool permissions

Tool calls are scoped by a permission set attached to each session. The built-in permission levels are:

- `read` — read-only filesystem access
- `write` — read + write filesystem access
- `shell` — full shell execution
- `network` — outbound HTTP (web search)

The browser app lets users configure allowed tools per-session in the Session Settings panel.

## Custom tools (plugins)

Define a tool with `defineTool` from `@newvector/core`, then register it:

```ts
import { defineTool, ToolRegistry } from "@newvector/core";

const myTool = defineTool({
  name: "getCurrentTime",
  description: "Returns the current UTC time as an ISO 8601 string",
  parameters: {},
  execute: async () => new Date().toISOString(),
});

const registry = new ToolRegistry();
registry.register(myTool);
```

For disk-based plugins (Node.js), see the [Plugin system reference](../reference/plugins.md).
