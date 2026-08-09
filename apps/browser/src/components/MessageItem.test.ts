import type { FileArtifact } from "@newvector/core";
import { describe, expect, it } from "vitest";
import type { StoredMessage } from "../types";
import { messageDisplayKind } from "./MessageItem";

function message(patch: Partial<StoredMessage>): StoredMessage {
  return { id: "m1", createdAt: 0, role: "assistant", content: "", ...patch };
}

const artifact = { path: "out/report.pdf", bytesWritten: 1024 } as FileArtifact;

describe("messageDisplayKind", () => {
  it("shows user and assistant text as content", () => {
    expect(messageDisplayKind(message({ role: "user", content: "hello" }))).toBe("content");
    expect(messageDisplayKind(message({ role: "assistant", content: "the answer" }))).toBe("content");
  });

  it("shows a user message that has only attachments", () => {
    expect(
      messageDisplayKind(
        message({ role: "user", content: "", attachments: [{ id: "a1", kind: "file", name: "notes.txt" } as never] }),
      ),
    ).toBe("content");
  });

  it("hides an assistant turn that only invoked tools", () => {
    // This is the NEW-358 clutter: an intermediate assistant step with tool calls but no visible text.
    expect(
      messageDisplayKind(
        message({ role: "assistant", content: "", toolCalls: [{ id: "t1", name: "search", arguments: {} }] }),
      ),
    ).toBe("hidden");
  });

  it("hides a plain tool-result message", () => {
    expect(messageDisplayKind(message({ role: "tool", name: "search", content: "42 results" }))).toBe("hidden");
  });

  it("keeps a tool result that produced a downloadable artifact", () => {
    expect(messageDisplayKind(message({ role: "tool", name: "write_file", content: "", artifact }))).toBe(
      "artifact-only",
    );
  });

  it("shows a failed turn as an error card", () => {
    expect(
      messageDisplayKind(message({ role: "assistant", content: "", error: { reason: "boom", isConfigIssue: false } })),
    ).toBe("error");
  });
});
