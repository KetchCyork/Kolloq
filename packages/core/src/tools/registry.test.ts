import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineTool, ToolRegistry } from "./registry.js";

describe("ToolRegistry", () => {
  it("validates arguments against the zod schema before executing", async () => {
    const registry = new ToolRegistry();
    registry.register(
      defineTool({
        name: "greet",
        description: "greet someone",
        parameters: z.object({ name: z.string() }),
        execute: ({ name }) => `Hello, ${name}!`,
      }),
    );

    const result = await registry.execute({ name: "greet", arguments: { name: "Ada" } });
    expect(result).toBe("Hello, Ada!");
  });

  it("rejects unknown tool calls", async () => {
    const registry = new ToolRegistry();
    await expect(registry.execute({ name: "missing", arguments: {} })).rejects.toThrow("Unknown tool: missing");
  });

  it("rejects registering the same tool name twice", () => {
    const registry = new ToolRegistry();
    const tool = defineTool({
      name: "dup",
      description: "dup",
      parameters: z.object({}),
      execute: () => "ok",
    });
    registry.register(tool);
    expect(() => registry.register(tool)).toThrow('Tool "dup" is already registered');
  });
});
