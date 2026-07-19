import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineTool, ToolRegistry } from "./registry.js";
import { scopeToolRegistry } from "./permissions.js";

function buildRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(defineTool({ name: "a", description: "a", parameters: z.object({}), execute: () => "a-result" }));
  registry.register(defineTool({ name: "b", description: "b", parameters: z.object({}), execute: () => "b-result" }));
  return registry;
}

describe("scopeToolRegistry", () => {
  it("only lists allowed tools", () => {
    const scoped = scopeToolRegistry(buildRegistry(), ["a"]);
    expect(scoped.list().map((t) => t.name)).toEqual(["a"]);
  });

  it("executes an allowed tool", async () => {
    const scoped = scopeToolRegistry(buildRegistry(), ["a"]);
    await expect(scoped.execute({ name: "a", arguments: {} })).resolves.toBe("a-result");
  });

  it("rejects executing a tool outside the allow-list even though it exists on the source registry", async () => {
    const scoped = scopeToolRegistry(buildRegistry(), ["a"]);
    await expect(scoped.execute({ name: "b", arguments: {} })).rejects.toThrow(/not permitted/);
  });

  it("fails closed for names not registered on the source at all", async () => {
    const scoped = scopeToolRegistry(buildRegistry(), ["nonexistent"]);
    await expect(scoped.execute({ name: "nonexistent", arguments: {} })).rejects.toThrow();
    expect(scoped.get("nonexistent")).toBeUndefined();
  });
});
