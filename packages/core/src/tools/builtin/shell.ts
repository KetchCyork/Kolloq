import { execFile } from "node:child_process";
import { z } from "zod";
import { defineTool } from "../registry.js";
import type { ToolDefinition } from "../../providers/types.js";

export interface ShellToolOptions {
  /**
   * Called with the exact command before it runs. Return (or resolve) `false` to reject.
   * Wire this to a real UI confirmation — never default to auto-approving in a product surface.
   */
  approve: (command: string, args: string[]) => boolean | Promise<boolean>;
  cwd?: string;
  timeoutMs?: number;
}

/**
 * Shell execution tool gated on an explicit approval callback. Every invocation — not just the
 * first — goes through `approve()`, since a model can vary arguments call to call.
 */
export function createShellTool(options: ShellToolOptions): ToolDefinition {
  const timeoutMs = options.timeoutMs ?? 30_000;

  return defineTool({
    name: "run_shell",
    description: "Run a shell command and return its stdout/stderr. Requires user approval before every execution.",
    parameters: z.object({
      command: z.string().describe("Executable name, e.g. \"ls\" or \"git\""),
      args: z.array(z.string()).optional().describe("Arguments, passed without shell interpolation"),
    }),
    execute: async ({ command, args = [] }) => {
      const approved = await options.approve(command, args);
      if (!approved) {
        return { approved: false, error: "Command rejected by user" };
      }

      return new Promise((resolve) => {
        execFile(
          command,
          args,
          { cwd: options.cwd, timeout: timeoutMs, maxBuffer: 1_000_000 },
          (error, stdout, stderr) => {
            resolve({
              approved: true,
              exitCode: error && "code" in error ? (error.code ?? 1) : 0,
              stdout,
              stderr,
              ...(error && !("code" in error) ? { error: error.message } : {}),
            });
          },
        );
      });
    },
  });
}
