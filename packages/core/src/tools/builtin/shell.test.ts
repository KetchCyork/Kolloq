import { describe, expect, it } from "vitest";
import { createShellTool } from "./shell.js";

describe("createShellTool", () => {
  it("does not execute when approval is denied", async () => {
    const tool = createShellTool({
      approve: () => false,
    });

    const result = (await tool.execute({ command: process.execPath, args: ["--version"] })) as { approved: boolean };
    expect(result.approved).toBe(false);
  });

  it("executes and returns stdout once approved", async () => {
    const tool = createShellTool({ approve: () => true });

    const result = (await tool.execute({ command: process.execPath, args: ["--version"] })) as {
      approved: boolean;
      exitCode: number;
      stdout: string;
    };

    expect(result.approved).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toMatch(/^v\d/);
  });

  it("asks for approval on every call, not just the first", async () => {
    let approvals = 0;
    const tool = createShellTool({
      approve: () => {
        approvals += 1;
        return true;
      },
    });

    await tool.execute({ command: process.execPath, args: ["--version"] });
    await tool.execute({ command: process.execPath, args: ["--version"] });

    expect(approvals).toBe(2);
  });
});
