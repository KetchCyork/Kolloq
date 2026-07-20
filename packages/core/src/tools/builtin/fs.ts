import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { defineTool } from "../registry.js";
import type { ToolDefinition } from "../../providers/types.js";
import { resolveSandboxedRead, resolveSandboxedWrite } from "./sandbox.js";

const MAX_READ_BYTES = 1_000_000;

/**
 * File read/write tools sandboxed to `rootDir`. Every path is resolved and bounds-checked before
 * touching disk, so a model can't be tricked (via `../../` or an absolute path) into reading or
 * writing outside the directory it was scoped to.
 */
export function createFileTools(rootDir: string): ToolDefinition[] {
  return [
    defineTool({
      name: "read_file",
      description: `Read a UTF-8 text file relative to the sandboxed root (${rootDir}).`,
      parameters: z.object({ path: z.string().describe("Path relative to the sandboxed root directory") }),
      execute: async ({ path: requested }) => {
        const target = await resolveSandboxedRead(rootDir, requested);
        const stat = await fs.stat(target);
        if (stat.size > MAX_READ_BYTES) {
          throw new Error(`File too large to read (${stat.size} bytes, limit ${MAX_READ_BYTES})`);
        }
        return { content: await fs.readFile(target, "utf-8") };
      },
    }),
    defineTool({
      name: "write_file",
      description: `Write a UTF-8 text file relative to the sandboxed root (${rootDir}). Creates parent directories as needed.`,
      parameters: z.object({
        path: z.string().describe("Path relative to the sandboxed root directory"),
        content: z.string(),
      }),
      execute: async ({ path: requested, content }) => {
        const target = await resolveSandboxedWrite(rootDir, requested);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, content, "utf-8");
        return { bytesWritten: Buffer.byteLength(content, "utf-8") };
      },
    }),
  ];
}
