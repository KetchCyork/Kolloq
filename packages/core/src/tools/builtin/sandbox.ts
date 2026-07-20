import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Shared filesystem-sandboxing helpers. Every tool that touches disk on the model's behalf resolves
 * requested paths through these so a model can't be tricked (via `../../`, an absolute path, or a
 * symlink) into reading or writing outside the directory it was scoped to. Extracted from `fs.ts`
 * so the Office document generators reuse the exact same, security-audited containment logic rather
 * than reimplementing it (which previously reintroduced a symlink-escape bug).
 */

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
export async function resolveSandboxedRead(rootDir: string, requested: string): Promise<string> {
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
export async function resolveSandboxedWrite(rootDir: string, requested: string): Promise<string> {
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
 * Resolves `requested` inside `rootDir` and writes `data` (binary or text) there, creating parent
 * directories as needed. Returns the number of bytes written. Used by the Office generators to emit
 * `.docx`/`.xlsx`/`.pptx` buffers without duplicating the containment checks above.
 */
export async function writeSandboxedFile(rootDir: string, requested: string, data: Buffer): Promise<number> {
  const target = await resolveSandboxedWrite(rootDir, requested);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, data);
  return data.byteLength;
}
