import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { defineTool } from "../registry.js";
import type { ToolDefinition } from "../../providers/types.js";

const MAX_READ_BYTES = 1_000_000;

function assertLexicallyInside(resolvedRoot: string, lexical: string, requested: string) {
  if (lexical !== resolvedRoot && !lexical.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`Path "${requested}" escapes the sandboxed root directory`);
  }
}

function assertRealpathInside(realRoot: string, real: string, requested: string) {
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
    throw new Error(`Path "${requested}" escapes the sandboxed root directory via symlink`);
  }
}

/**
 * Resolves `requested` against `rootDir` for a read operation. Checks both the lexical path
 * and the realpath (following symlinks) so a symlink inside the sandbox pointing outside it
 * doesn't bypass containment. The file must exist (realpath throws ENOENT otherwise).
 */
async function resolveSandboxedRead(rootDir: string, requested: string): Promise<string> {
  const resolvedRoot = path.resolve(rootDir);
  const lexical = path.resolve(resolvedRoot, requested);
  assertLexicallyInside(resolvedRoot, lexical, requested);
  const realRoot = await fs.realpath(resolvedRoot);
  const real = await fs.realpath(lexical);
  assertRealpathInside(realRoot, real, requested);
  return real;
}

/**
 * Resolves `requested` against `rootDir` for a write operation. The file may not exist yet,
 * so realpath is applied to the nearest existing ancestor instead of the full path.
 */
async function resolveSandboxedWrite(rootDir: string, requested: string): Promise<string> {
  const resolvedRoot = path.resolve(rootDir);
  const lexical = path.resolve(resolvedRoot, requested);
  assertLexicallyInside(resolvedRoot, lexical, requested);
  // Walk up to find the nearest existing ancestor to realpath-check, then reattach the tail.
  const realRoot = await fs.realpath(resolvedRoot);
  let ancestor = lexical;
  const tail: string[] = [];
  while (true) {
    try {
      const real = await fs.realpath(ancestor);
      assertRealpathInside(realRoot, real, requested);
      return path.join(real, ...tail);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      tail.unshift(path.basename(ancestor));
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw new Error(`Path "${requested}" could not be resolved inside sandbox`);
      ancestor = parent;
    }
  }
}

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
