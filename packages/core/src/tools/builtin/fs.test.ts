import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileTools } from "./fs.js";

describe("createFileTools", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-fs-test-"));
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("writes then reads a file relative to the sandbox root", async () => {
    const [readFile, writeFile] = createFileTools(rootDir).sort((a, b) => a.name.localeCompare(b.name));

    await writeFile.execute({ path: "notes/todo.txt", content: "hello" });
    const result = await readFile.execute({ path: "notes/todo.txt" });

    expect(result).toEqual({ content: "hello" });
  });

  it("rejects a read path that escapes the sandbox root", async () => {
    const [readFile] = createFileTools(rootDir);
    await expect(readFile.execute({ path: "../../etc/passwd" })).rejects.toThrow(/escapes/);
  });

  it("rejects a write path that escapes the sandbox root", async () => {
    const [, writeFile] = createFileTools(rootDir);
    await expect(writeFile.execute({ path: "../outside.txt", content: "x" })).rejects.toThrow(/escapes/);
  });
});
