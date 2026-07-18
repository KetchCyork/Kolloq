import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ChatProvider, ChatRequest, ChatResponse, StreamEvent } from "../providers/types.js";
import { defineTool, ToolRegistry } from "../tools/registry.js";
import { AgentOrchestrator, type OrchestratedAgentEvent } from "./orchestrator.js";

/** Same fixed-playback fake provider used in runner.test.ts, shared across every agent the orchestrator spawns. */
class ScriptedProvider implements ChatProvider {
  readonly id = "scripted";
  readonly model = "scripted-model";
  private step = 0;

  constructor(private readonly responses: ChatResponse[]) {}

  async chat(_request: ChatRequest): Promise<ChatResponse> {
    const response = this.responses[this.step];
    this.step += 1;
    if (!response) throw new Error("no more scripted responses");
    return response;
  }

  async *stream(_request: ChatRequest): AsyncIterable<StreamEvent> {
    throw new Error("not used by orchestrator tests");
  }
}

function buildSharedTools(): ToolRegistry {
  const tools = new ToolRegistry();
  tools.register(
    defineTool({
      name: "lookup",
      description: "look something up",
      parameters: z.object({ q: z.string() }),
      execute: ({ q }) => `result for ${q}`,
    }),
  );
  return tools;
}

describe("AgentOrchestrator", () => {
  it("delegates a single sub-task and returns the sub-agent's final answer to the root agent", async () => {
    const provider = new ScriptedProvider([
      {
        finishReason: "tool-calls",
        message: {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "call_1",
              name: "delegate_task",
              arguments: { tasks: [{ name: "researcher", task: "look up X" }] },
            },
          ],
        },
      },
      { finishReason: "stop", message: { role: "assistant", content: "Research says: X is fine." } },
      { finishReason: "stop", message: { role: "assistant", content: "Based on the researcher: X is fine." } },
    ]);

    const events: OrchestratedAgentEvent[] = [];
    const orchestrator = new AgentOrchestrator({
      provider,
      sharedTools: buildSharedTools(),
      onEvent: (event) => events.push(event),
    });

    const turn = await orchestrator.run({ name: "lead", allowedTools: ["lookup"] }, "Investigate X");

    expect(turn.at(-1)?.content).toBe("Based on the researcher: X is fine.");

    const toolMessage = events.find(
      (event) => event.type === "tool-result" && event.toolCall.name === "delegate_task",
    );
    expect(toolMessage?.type).toBe("tool-result");
    if (toolMessage?.type === "tool-result") {
      expect(toolMessage.result).toEqual({ results: [{ name: "researcher", result: "Research says: X is fine." }] });
    }

    const rootEvents = events.filter((event) => event.agentName === "lead");
    const childEvents = events.filter((event) => event.agentName === "researcher");
    expect(rootEvents.length).toBeGreaterThan(0);
    expect(childEvents.length).toBeGreaterThan(0);
    expect(childEvents.every((event) => event.depth === 1 && event.parentId === rootEvents[0]?.agentId)).toBe(true);
  });

  it("narrows a sub-agent's tools to the intersection of what it asked for and what its parent was allowed", async () => {
    const provider = new ScriptedProvider([
      {
        finishReason: "tool-calls",
        message: {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "call_1",
              // Sub-agent asks for a tool the parent was never granted ("lookup" is fine, "shell" isn't).
              name: "delegate_task",
              arguments: { tasks: [{ name: "over-reacher", task: "try to escalate", allowedTools: ["lookup", "shell"] }] },
            },
          ],
        },
      },
      {
        finishReason: "tool-calls",
        message: {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call_2", name: "shell", arguments: {} }],
        },
      },
      { finishReason: "stop", message: { role: "assistant", content: "done" } },
      { finishReason: "stop", message: { role: "assistant", content: "root final" } },
    ]);

    const events: OrchestratedAgentEvent[] = [];
    const orchestrator = new AgentOrchestrator({
      provider,
      sharedTools: buildSharedTools(),
      onEvent: (event) => events.push(event),
    });

    await orchestrator.run({ name: "lead", allowedTools: ["lookup"] }, "go");

    const shellError = events.find((event) => event.type === "error");
    expect(shellError?.type).toBe("error");
    if (shellError?.type === "error") {
      expect(shellError.error.message).toBe("Unknown tool: shell");
    }
  });

  it("withholds delegate_task once maxDepth is reached, so recursion can't run away", async () => {
    const provider = new ScriptedProvider([
      {
        finishReason: "tool-calls",
        message: {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "call_1", name: "delegate_task", arguments: { tasks: [{ name: "child", task: "recurse" }] } },
          ],
        },
      },
      {
        // The child is at depth 1 == maxDepth, so it must not have delegate_task at all.
        finishReason: "tool-calls",
        message: {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call_2", name: "delegate_task", arguments: { tasks: [{ name: "grandchild", task: "recurse more" }] } }],
        },
      },
      { finishReason: "stop", message: { role: "assistant", content: "gave up" } },
      { finishReason: "stop", message: { role: "assistant", content: "root done" } },
    ]);

    const orchestrator = new AgentOrchestrator({ provider, sharedTools: buildSharedTools(), maxDepth: 1 });
    const turn = await orchestrator.run({ name: "lead" }, "go");

    expect(turn.at(-1)?.content).toBe("root done");
  });
});
