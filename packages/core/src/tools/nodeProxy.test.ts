import { describe, expect, it, vi } from "vitest";
import { createOfficeProxyTools } from "./nodeProxy.js";
import { OFFICE_TOOL_NAMES } from "./officeSpec.js";

describe("createOfficeProxyTools", () => {
  it("mirrors the Office tool names so the model sees the same tools as the CLI", () => {
    const exec = vi.fn();
    const names = createOfficeProxyTools("the session sandbox", exec).map((t) => t.name);
    expect(names.sort()).toEqual([...OFFICE_TOOL_NAMES].sort());
  });

  it("puts the sandbox label in each description", () => {
    const tools = createOfficeProxyTools("MY_SANDBOX", vi.fn());
    for (const tool of tools) expect(tool.description).toContain("MY_SANDBOX");
  });

  it("advertises the real schema so the runner rejects malformed calls before the round-trip", () => {
    const [word] = createOfficeProxyTools("s", vi.fn());
    // The runner/adapter validates against `parameters` before calling execute; a non-array
    // `blocks` must not parse, so a bad call never reaches the transport.
    expect(() => word.parameters.parse({ path: "r", blocks: "nope" })).toThrow();
  });

  it("delegates a valid call to the transport and returns its result", async () => {
    const artifact = { path: "r.docx", bytesWritten: 42, mimeType: "x", contentBase64: "AAA=" };
    const exec = vi.fn().mockResolvedValue(artifact);
    const word = createOfficeProxyTools("s", exec).find((t) => t.name === "generate_word_document")!;
    const args = word.parameters.parse({ path: "r", blocks: [{ type: "paragraph", text: "hi" }] });
    const result = await word.execute(args);
    expect(exec).toHaveBeenCalledWith("generate_word_document", args);
    expect(result).toBe(artifact);
  });
});
