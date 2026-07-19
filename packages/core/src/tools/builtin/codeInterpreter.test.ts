import { describe, expect, it } from "vitest";
import { createCodeInterpreterTool } from "./codeInterpreter.js";

describe("createCodeInterpreterTool", () => {
  it("runs a node snippet and captures stdout", async () => {
    const tool = createCodeInterpreterTool();
    const result = (await tool.execute({ language: "node", code: "console.log(1 + 1)" })) as {
      exitCode: number;
      stdout: string;
    };

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("2");
  });

  it("captures a non-zero exit code and stderr from a failing snippet", async () => {
    const tool = createCodeInterpreterTool();
    const result = (await tool.execute({ language: "node", code: "throw new Error('boom')" })) as {
      exitCode: number;
      stderr: string;
    };

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/boom/);
  });

  it("kills the subprocess once the timeout elapses", async () => {
    const tool = createCodeInterpreterTool({ timeoutMs: 200 });
    const result = (await tool.execute({ language: "node", code: "setTimeout(() => {}, 60000)" })) as {
      timedOut: boolean;
    };

    expect(result.timedOut).toBe(true);
  }, 10_000);
});
