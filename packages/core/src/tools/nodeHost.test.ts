import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleNodeToolRequest, nodeHostToolNames } from "./nodeHost.js";

describe("nodeHost", () => {
  let sandboxRoot: string;

  beforeEach(async () => {
    sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), "node-host-test-"));
  });

  afterEach(async () => {
    await fs.rm(sandboxRoot, { recursive: true, force: true });
  });

  it("exposes the Office generators and the sandboxed file tools", () => {
    expect(nodeHostToolNames().sort()).toEqual([
      "generate_excel_spreadsheet",
      "generate_powerpoint_presentation",
      "generate_word_document",
      "read_file",
      "write_file",
    ]);
  });

  it("runs an Office generator and returns a downloadable FileArtifact", async () => {
    const res = await handleNodeToolRequest({
      op: "exec",
      sandboxRoot,
      name: "generate_word_document",
      args: { path: "report", blocks: [{ type: "paragraph", text: "Hello" }] },
    });

    expect(res.ok).toBe(true);
    if (!res.ok || !("result" in res)) throw new Error("expected exec result");
    const artifact = res.result as { path: string; bytesWritten: number; contentBase64: string };
    expect(artifact.path).toBe("report.docx");
    expect(artifact.bytesWritten).toBeGreaterThan(0);
    // The file really landed in the sandbox, and the inline bytes match disk.
    const onDisk = await fs.readFile(path.join(sandboxRoot, "report.docx"));
    expect(Buffer.from(artifact.contentBase64, "base64").equals(onDisk)).toBe(true);
  });

  it("reads a generated file back out of the sandbox as base64", async () => {
    await handleNodeToolRequest({
      op: "exec",
      sandboxRoot,
      name: "generate_word_document",
      args: { path: "deck", blocks: [{ type: "heading", text: "Title", level: 1 }] },
    });

    const res = await handleNodeToolRequest({ op: "read", sandboxRoot, path: "deck.docx" });
    expect(res.ok).toBe(true);
    if (!res.ok || !("contentBase64" in res)) throw new Error("expected read result");
    expect(res.mimeType).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    const onDisk = await fs.readFile(path.join(sandboxRoot, "deck.docx"));
    expect(res.bytesRead).toBe(onDisk.byteLength);
    expect(Buffer.from(res.contentBase64, "base64").equals(onDisk)).toBe(true);
  });

  it("returns a structured error for an unknown tool instead of throwing", async () => {
    const res = await handleNodeToolRequest({
      op: "exec",
      sandboxRoot,
      name: "definitely_not_a_tool",
      args: {},
    });
    expect(res).toEqual({ ok: false, error: expect.stringContaining("Unknown tool") });
  });

  it("returns a structured error when arguments fail the tool schema", async () => {
    const res = await handleNodeToolRequest({
      op: "exec",
      sandboxRoot,
      name: "generate_excel_spreadsheet",
      args: { path: "data.xlsx", sheets: [] }, // sheets must have at least one entry
    });
    expect(res.ok).toBe(false);
  });

  it("refuses to read a file outside the sandbox", async () => {
    const res = await handleNodeToolRequest({ op: "read", sandboxRoot, path: "../../etc/passwd" });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected escape to be rejected");
    expect(res.error).toMatch(/escape/i);
  });

  it("rejects a request with no sandboxRoot", async () => {
    const res = await handleNodeToolRequest({ op: "read", path: "x" } as never);
    expect(res).toEqual({ ok: false, error: expect.stringContaining("sandboxRoot") });
  });
});
