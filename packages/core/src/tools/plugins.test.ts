import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadToolPlugins } from "./plugins.js";

// Fixture files are plain CommonJS: the temp dir has no package.json, so Node treats bare `.js`
// files as CommonJS by default. `import()` still works via Node's CJS/ESM interop, which surfaces
// `module.exports` as the namespace's `default` export.
describe("loadToolPlugins", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-plugins-test-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("returns an empty list when the plugin directory doesn't exist", async () => {
    const tools = await loadToolPlugins(path.join(dir, "does-not-exist"));
    expect(tools).toEqual([]);
  });

  it("loads a tool exported directly as module.exports", async () => {
    await fs.writeFile(
      path.join(dir, "echo.js"),
      `module.exports = {
        name: "echo",
        description: "Echoes input",
        parameters: { parse: (v) => v },
        execute: (args) => ({ echoed: args }),
      };`,
    );

    const tools = await loadToolPlugins(dir);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("echo");
    await expect(Promise.resolve(tools[0].execute({ hi: true }))).resolves.toEqual({ echoed: { hi: true } });
  });

  it("loads tools exported from a factory function, including multiple at once", async () => {
    await fs.writeFile(
      path.join(dir, "factory.js"),
      `module.exports = () => [
        { name: "one", description: "d", parameters: { parse: (v) => v }, execute: () => 1 },
        { name: "two", description: "d", parameters: { parse: (v) => v }, execute: () => 2 },
      ];`,
    );

    const tools = await loadToolPlugins(dir);
    expect(tools.map((t) => t.name).sort()).toEqual(["one", "two"]);
  });

  it("throws when a plugin file has no default export", async () => {
    await fs.writeFile(path.join(dir, "bad.js"), `module.exports = undefined;`);
    await expect(loadToolPlugins(dir)).rejects.toThrow(/no default export/);
  });

  it("throws when the default export isn't a valid tool definition", async () => {
    await fs.writeFile(path.join(dir, "bad.js"), `module.exports = { name: "incomplete" };`);
    await expect(loadToolPlugins(dir)).rejects.toThrow(/did not export a valid/);
  });
});
