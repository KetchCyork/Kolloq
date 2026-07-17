import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ChatProvider, ChatRequest, ChatResponse, StreamEvent } from "../providers/types.js";
import { defineTool, ToolRegistry } from "../tools/registry.js";
import { AgentRunner } from "./runner.js";

/** Fake provider that plays back a fixed script of responses, so the agent loop is testable without network calls or API keys. */
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
    const response = this.responses[this.step];
    this.step += 1;
    if (!response) throw new Error("no more scripted responses");

    if (response.message.content) {
      for (const char of response.message.content) {
        yield { type: "text-delta", delta: char };
      }
    }
    for (const toolCall of response.message.toolCalls ?? []) {
      yield { type: "tool-call", toolCall };
    }
    yield { type: "finish", reason: response.finishReason };
  }
}

describe("AgentRunner", () => {
  it("executes a tool call then returns the final assistant message", async () => {
    const tools = new ToolRegistry();
    tools.register(
      defineTool({
        name: "add",
        description: "add two numbers",
        parameters: z.object({ a: z.number(), b: z.number() }),
        execute: ({ a, b }) => a + b,
      }),
    );

    const provider = new ScriptedProvider([
      {
        finishReason: "tool-calls",
        message: {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call_1", name: "add", arguments: { a: 2, b: 3 } }],
        },
      },
      {
        finishReason: "stop",
        message: { role: "assistant", content: "The answer is 5." },
      },
    ]);

    const runner = new AgentRunner({ provider, tools });
    const turn = await runner.run("What is 2 + 3?");

    expect(turn.at(-1)?.content).toBe("The answer is 5.");
    const toolMessage = runner.getHistory().find((message) => message.role === "tool");
    expect(toolMessage?.content).toBe("5");
  });

  it("surfaces a failing tool execution as a tool-result error instead of throwing", async () => {
    const tools = new ToolRegistry();
    tools.register(
      defineTool({
        name: "divide",
        description: "divide two numbers",
        parameters: z.object({ a: z.number(), b: z.number() }),
        execute: ({ a, b }) => {
          if (b === 0) throw new Error("division by zero");
          return a / b;
        },
      }),
    );

    const provider = new ScriptedProvider([
      {
        finishReason: "tool-calls",
        message: {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call_1", name: "divide", arguments: { a: 1, b: 0 } }],
        },
      },
      {
        finishReason: "stop",
        message: { role: "assistant", content: "That failed." },
      },
    ]);

    const runner = new AgentRunner({ provider, tools });
    const turn = await runner.run("What is 1 / 0?");

    expect(turn.at(-1)?.content).toBe("That failed.");
    const toolMessage = runner.getHistory().find((message) => message.role === "tool");
    expect(JSON.parse(toolMessage?.content ?? "{}")).toEqual({ error: "division by zero" });
  });

  it("stops after maxSteps even if the model keeps calling tools", async () => {
    const tools = new ToolRegistry();
    tools.register(
      defineTool({
        name: "noop",
        description: "does nothing",
        parameters: z.object({}),
        execute: () => "ok",
      }),
    );

    const loopingResponse: ChatResponse = {
      finishReason: "tool-calls",
      message: {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call_x", name: "noop", arguments: {} }],
      },
    };

    const provider = new ScriptedProvider(Array.from({ length: 5 }, () => loopingResponse));
    const runner = new AgentRunner({ provider, tools, maxSteps: 2 });
    const turn = await runner.run("loop forever");

    expect(turn.filter((message) => message.role === "assistant")).toHaveLength(2);
  });

  it("runStream emits text-delta events and reassembles the same final message as run", async () => {
    const provider = new ScriptedProvider([
      {
        finishReason: "stop",
        message: { role: "assistant", content: "Hello there." },
      },
    ]);

    const deltas: string[] = [];
    const runner = new AgentRunner({
      provider,
      onEvent: (event) => {
        if (event.type === "text-delta") deltas.push(event.delta);
      },
    });

    const turn = await runner.runStream("Hi");

    expect(deltas.join("")).toBe("Hello there.");
    expect(turn.at(-1)?.content).toBe("Hello there.");
  });

  it("runStream executes tool calls surfaced mid-stream before continuing", async () => {
    const tools = new ToolRegistry();
    tools.register(
      defineTool({
        name: "add",
        description: "add two numbers",
        parameters: z.object({ a: z.number(), b: z.number() }),
        execute: ({ a, b }) => a + b,
      }),
    );

    const provider = new ScriptedProvider([
      {
        finishReason: "tool-calls",
        message: {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call_1", name: "add", arguments: { a: 2, b: 3 } }],
        },
      },
      {
        finishReason: "stop",
        message: { role: "assistant", content: "The answer is 5." },
      },
    ]);

    const runner = new AgentRunner({ provider, tools });
    const turn = await runner.runStream("What is 2 + 3?");

    expect(turn.at(-1)?.content).toBe("The answer is 5.");
    const toolMessage = runner.getHistory().find((message) => message.role === "tool");
    expect(toolMessage?.content).toBe("5");
  });
});
