import { describe, expect, it } from "vitest";
import { toUserContent } from "./ai-sdk-adapter.js";
import type { ChatMessage } from "./types.js";

const image: ChatMessage["attachments"] = [
  { id: "1", kind: "image", name: "pixel.png", mimeType: "image/png", data: "aGVsbG8=" },
];
const file: ChatMessage["attachments"] = [
  { id: "2", kind: "file", name: "note.txt", mimeType: "text/plain", data: "d29ybGQ=" },
];

describe("toUserContent", () => {
  it("returns plain text content when a message has no attachments", () => {
    const message: ChatMessage = { role: "user", content: "hi" };
    expect(toUserContent("anthropic", message)).toBe("hi");
  });

  it("maps image and file attachments to AI SDK image/file parts for a vision-capable provider", () => {
    const message: ChatMessage = { role: "user", content: "what is this?", attachments: [...image!, ...file!] };
    const content = toUserContent("anthropic", message);

    expect(content).toEqual([
      { type: "text", text: "what is this?" },
      { type: "image", image: "aGVsbG8=", mimeType: "image/png" },
      { type: "file", data: "d29ybGQ=", mimeType: "text/plain", filename: "note.txt" },
    ]);
  });

  it("degrades to a text-only note for providers known not to support attachments", () => {
    const message: ChatMessage = { role: "user", content: "what is this?", attachments: image };
    const content = toUserContent("ollama", message);

    expect(content).toBe(
      'what is this?\n\n[1 attachment(s) not sent — the "ollama" provider does not support image/file attachments: "pixel.png"]',
    );
  });

  it("degrades to just the note when there is no text alongside the attachment", () => {
    const message: ChatMessage = { role: "user", content: "", attachments: image };
    const content = toUserContent("ollama", message);

    expect(content).toBe('[1 attachment(s) not sent — the "ollama" provider does not support image/file attachments: "pixel.png"]');
  });
});
