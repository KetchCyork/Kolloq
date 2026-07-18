#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { z } from "zod";
import { AgentRunner } from "../src/agent/runner.js";
import { AgentOrchestrator, type OrchestratedAgentEvent } from "../src/agent/orchestrator.js";
import { createProvider, type ProviderName } from "../src/providers/index.js";
import { ToolRegistry, defineTool } from "../src/tools/registry.js";
import { createFileTools, createShellTool, createWebSearchTool, createCodeInterpreterTool } from "../src/tools/builtin/index.js";
import { loadToolPlugins } from "../src/tools/plugins.js";

interface CliArgs {
  provider: ProviderName;
  model?: string;
  prompt: string;
  multiAgent: boolean;
  allowShell: boolean;
  toolsDir: string;
  sandboxDir: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    provider: (process.env.AGENT_PROVIDER as ProviderName | undefined) ?? "ollama",
    model: process.env.AGENT_MODEL,
    prompt: "",
    multiAgent: false,
    allowShell: false,
    toolsDir: "./tools",
    sandboxDir: process.cwd(),
  };

  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--provider") {
      args.provider = argv[++i] as ProviderName;
    } else if (arg === "--model") {
      args.model = argv[++i];
    } else if (arg === "--multi-agent") {
      args.multiAgent = true;
    } else if (arg === "--allow-shell") {
      args.allowShell = true;
    } else if (arg === "--tools-dir") {
      args.toolsDir = argv[++i];
    } else if (arg === "--sandbox-dir") {
      args.sandboxDir = argv[++i];
    } else {
      rest.push(arg);
    }
  }
  args.prompt = rest.join(" ");
  return args;
}

/** Prompts the user in the terminal before every shell command — the approval gate `createShellTool` requires. */
function terminalShellApproval(command: string, commandArgs: string[]): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return rl
    .question(`[approval] Run "${command} ${commandArgs.join(" ")}"? [y/N] `)
    .then((answer) => answer.trim().toLowerCase() === "y")
    .finally(() => rl.close());
}

async function buildTools(args: CliArgs): Promise<ToolRegistry> {
  const tools = new ToolRegistry();
  tools.register(
    defineTool({
      name: "get_time",
      description: "Get the current server time in ISO 8601 format.",
      parameters: z.object({}),
      execute: () => ({ now: new Date().toISOString() }),
    }),
  );

  for (const tool of createFileTools(args.sandboxDir)) tools.register(tool);
  tools.register(createCodeInterpreterTool());

  if (args.allowShell) {
    tools.register(createShellTool({ approve: terminalShellApproval, cwd: args.sandboxDir }));
  }

  const braveKey = process.env.BRAVE_API_KEY;
  const serperKey = process.env.SERPER_API_KEY;
  if (braveKey) {
    tools.register(createWebSearchTool({ provider: "brave", apiKey: braveKey }));
  } else if (serperKey) {
    tools.register(createWebSearchTool({ provider: "serper", apiKey: serperKey }));
  }

  for (const tool of await loadToolPlugins(args.toolsDir)) {
    tools.register(tool);
  }

  return tools;
}

function logEvent(prefix: string, event: { type: string; [key: string]: unknown }) {
  if (event.type === "tool-call") {
    const toolCall = event.toolCall as { name: string; arguments: unknown };
    console.error(`${prefix}[tool-call] ${toolCall.name}(${JSON.stringify(toolCall.arguments)})`);
  } else if (event.type === "tool-result") {
    const toolCall = event.toolCall as { name: string };
    console.error(`${prefix}[tool-result] ${toolCall.name} -> ${JSON.stringify(event.result)}`);
  } else if (event.type === "error") {
    console.error(`${prefix}[error] ${(event.error as Error).message}`);
  }
}

async function runSingleAgent(args: CliArgs, provider: ReturnType<typeof createProvider>) {
  const runner = new AgentRunner({
    provider,
    tools: await buildTools(args),
    systemPrompt: "You are a helpful headless CLI agent. Use tools when they help answer the user.",
    onEvent: (event) => logEvent("", event),
  });

  const turn = await runner.run(args.prompt);
  const finalMessage = [...turn].reverse().find((message) => message.role === "assistant");
  console.log(finalMessage?.content ?? "(no response)");
}

/** Demonstrates the multi-agent orchestrator: a lead agent can delegate sub-tasks via `delegate_task`. */
async function runMultiAgent(args: CliArgs, provider: ReturnType<typeof createProvider>) {
  const sharedTools = await buildTools(args);
  const orchestrator = new AgentOrchestrator({
    provider,
    sharedTools,
    onEvent: (event: OrchestratedAgentEvent) => logEvent(`${"  ".repeat(event.depth)}[${event.agentName}] `, event),
  });

  const turn = await orchestrator.run(
    {
      name: "lead",
      systemPrompt:
        "You are the lead agent in a multi-agent cowork session. Delegate independent sub-tasks to " +
        "sub-agents via `delegate_task` when that would help, then synthesize their answers.",
      allowedTools: sharedTools.list().map((tool) => tool.name),
    },
    args.prompt,
  );

  const finalMessage = [...turn].reverse().find((message) => message.role === "assistant");
  console.log(finalMessage?.content ?? "(no response)");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.prompt) {
    console.error(
      'Usage: agent-cli [--provider openai|anthropic|google|ollama|openrouter] [--model <name>] ' +
        "[--multi-agent] [--allow-shell] [--tools-dir <dir>] [--sandbox-dir <dir>] \"<prompt>\"",
    );
    process.exitCode = 1;
    return;
  }

  const provider = createProvider({
    provider: args.provider,
    model: args.model,
    apiKey: process.env[`${args.provider.toUpperCase()}_API_KEY`],
  });

  if (args.multiAgent) {
    await runMultiAgent(args, provider);
  } else {
    await runSingleAgent(args, provider);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
