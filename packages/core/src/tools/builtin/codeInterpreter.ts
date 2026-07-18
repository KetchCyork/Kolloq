import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { defineTool } from "../registry.js";
import type { ToolDefinition } from "../../providers/types.js";

export interface CodeInterpreterOptions {
  timeoutMs?: number;
  /** Working directory for the subprocess; defaults to a fresh temp dir per call. */
  cwd?: string;
}

const RUNNERS = {
  node: { bin: "node", ext: ".mjs" },
  python: { bin: "python3", ext: ".py" },
} as const;

/**
 * Runs untrusted model-generated code as a Node.js or Python subprocess. Isolation is
 * process-level, not a full container: the code is written to a scratch temp file and executed
 * with a minimal environment (no inherited API keys/secrets) and a hard wall-clock timeout. This
 * is enough to stop runaway loops and accidental secret leakage, not a substitute for a real
 * sandbox (gVisor/Firecracker) if you ever run genuinely adversarial code.
 */
export function createCodeInterpreterTool(options: CodeInterpreterOptions = {}): ToolDefinition {
  const timeoutMs = options.timeoutMs ?? 15_000;

  return defineTool({
    name: "run_code",
    description: "Execute a short Node.js or Python script in a sandboxed subprocess and return stdout/stderr.",
    parameters: z.object({
      language: z.enum(["node", "python"]),
      code: z.string(),
    }),
    execute: async ({ language, code }) => {
      const runner = RUNNERS[language];
      const dir = options.cwd ?? (await fs.mkdtemp(path.join(os.tmpdir(), "agent-code-")));
      const file = path.join(dir, `snippet-${randomUUID()}${runner.ext}`);
      await fs.writeFile(file, code, "utf-8");

      try {
        return await new Promise((resolve) => {
          execFile(
            runner.bin,
            [file],
            {
              cwd: dir,
              timeout: timeoutMs,
              maxBuffer: 1_000_000,
              env: { PATH: process.env.PATH ?? "" },
            },
            (error, stdout, stderr) => {
              resolve({
                exitCode: error && "code" in error ? (error.code ?? 1) : 0,
                timedOut: Boolean(error && "killed" in error && error.killed),
                stdout,
                stderr,
              });
            },
          );
        });
      } finally {
        await fs.rm(file, { force: true });
      }
    },
  });
}
