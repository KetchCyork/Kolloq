#!/usr/bin/env node
import { z } from "zod";
import { AgentRunner } from "../src/agent/runner.js";
import { createProvider, type ProviderName } from "../src/providers/index.js";
import { ToolRegistry, defineTool } from "../src/tools/registry.js";

interface CliArgs {
  provider: ProviderName;
  model?: string;
  prompt: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    provider: (process.env.AGENT_PROVIDER as ProviderName | undefined) ?? "ollama",
    model: process.env.AGENT_MODEL,
    prompt: "",
  };

  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--provider") {
      args.provider = argv[++i] as ProviderName;
    } else if (arg === "--model") {
      args.model = argv[++i];
    } else {
      rest.push(arg);
    }
  }
  args.prompt = rest.join(" ");
  return args;
}

function buildTools(): ToolRegistry {
  const tools = new ToolRegistry();
  tools.register(
    defineTool({
      name: "get_time",
      description: "Get the current server time in ISO 8601 format.",
      parameters: z.object({}),
      execute: () => ({ now: new Date().toISOString() }),
    }),
  );
  return tools;
}

async function main() {
  const { provider: providerName, model, prompt } = parseArgs(process.argv.slice(2));

  if (!prompt) {
    console.error('Usage: agent-cli [--provider openai|anthropic|google|ollama] [--model <name>] "<prompt>"');
    process.exitCode = 1;
    return;
  }

  const provider = createProvider({
    provider: providerName,
    model,
    apiKey: process.env[`${providerName.toUpperCase()}_API_KEY`],
  });

  const runner = new AgentRunner({
    provider,
    tools: buildTools(),
    systemPrompt: "You are a helpful headless CLI agent. Use tools when they help answer the user.",
    onEvent: (event) => {
      if (event.type === "tool-call") {
        console.error(`[tool-call] ${event.toolCall.name}(${JSON.stringify(event.toolCall.arguments)})`);
      } else if (event.type === "tool-result") {
        console.error(`[tool-result] ${event.toolCall.name} -> ${JSON.stringify(event.result)}`);
      } else if (event.type === "error") {
        console.error(`[error] ${event.error.message}`);
      }
    },
  });

  const turn = await runner.run(prompt);
  const finalMessage = [...turn].reverse().find((message) => message.role === "assistant");
  console.log(finalMessage?.content ?? "(no response)");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
