import ExcelJS from "exceljs";
import JSZip from "jszip";
import { Document, Packer, Paragraph } from "docx";
import { describe, expect, it } from "vitest";
import { repairStringifiedToolArgs, toUserContent } from "./ai-sdk-adapter.js";
import type { ChatMessage } from "./types.js";

const image: ChatMessage["attachments"] = [
  { id: "1", kind: "image", name: "pixel.png", mimeType: "image/png", data: "aGVsbG8=" },
];
const textFile: ChatMessage["attachments"] = [
  { id: "2", kind: "file", name: "note.txt", mimeType: "text/plain", data: Buffer.from("hello world").toString("base64") },
];
const pdfFile: ChatMessage["attachments"] = [
  { id: "3", kind: "file", name: "report.pdf", mimeType: "application/pdf", data: "aGVsbG8=" },
];

describe("toUserContent", () => {
  it("returns plain text content when a message has no attachments", async () => {
    const message: ChatMessage = { role: "user", content: "hi" };
    expect(await toUserContent("anthropic", message)).toBe("hi");
  });

  it("maps image attachments to AI SDK image parts and inlines text-file content instead of sending an opaque file blob", async () => {
    const message: ChatMessage = { role: "user", content: "what is this?", attachments: [...image!, ...textFile!] };
    const content = await toUserContent("anthropic", message);

    expect(content).toEqual([
      { type: "text", text: "what is this?" },
      { type: "image", image: "aGVsbG8=", mimeType: "image/png" },
      { type: "text", text: "--- note.txt (text/plain) ---\nhello world" },
    ]);
  });

  it("sends application/pdf attachments as a native file part (the one document type providers reliably accept)", async () => {
    const message: ChatMessage = { role: "user", content: "summarize", attachments: pdfFile };
    const content = await toUserContent("anthropic", message);

    expect(content).toEqual([
      { type: "text", text: "summarize" },
      { type: "file", data: "aGVsbG8=", mimeType: "application/pdf", filename: "report.pdf" },
    ]);
  });

  it("extracts text from a markdown attachment instead of erroring as a non-PDF file", async () => {
    const markdown: ChatMessage["attachments"] = [
      { id: "4", kind: "file", name: "notes.md", mimeType: "text/markdown", data: Buffer.from("# Title\n\nBody").toString("base64") },
    ];
    const message: ChatMessage = { role: "user", content: "", attachments: markdown };
    const content = await toUserContent("anthropic", message);

    expect(content).toEqual([{ type: "text", text: "--- notes.md (text/markdown) ---\n# Title\n\nBody" }]);
  });

  it("extracts text from a .docx attachment", async () => {
    const doc = new Document({ sections: [{ children: [new Paragraph("Hello from Word")] }] });
    const buffer = await Packer.toBuffer(doc);
    const docx: ChatMessage["attachments"] = [
      {
        id: "5",
        kind: "file",
        name: "memo.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        data: buffer.toString("base64"),
      },
    ];
    const message: ChatMessage = { role: "user", content: "", attachments: docx };
    const content = await toUserContent("anthropic", message);

    expect(content).toEqual([{ type: "text", text: expect.stringContaining("Hello from Word") }]);
  });

  it("extracts text from an .xlsx attachment", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet1");
    sheet.addRow(["Name", "Score"]);
    sheet.addRow(["Ada", 42]);
    const buffer = await workbook.xlsx.writeBuffer();
    const xlsx: ChatMessage["attachments"] = [
      {
        id: "6",
        kind: "file",
        name: "scores.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        data: Buffer.from(buffer).toString("base64"),
      },
    ];
    const message: ChatMessage = { role: "user", content: "", attachments: xlsx };
    const content = await toUserContent("anthropic", message);

    expect(content).toEqual([{ type: "text", text: expect.stringContaining("Ada") }]);
  });

  it("extracts text from a .pptx attachment", async () => {
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      '<?xml version="1.0"?><p:sld xmlns:a="a" xmlns:p="p"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Hello Slide</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
    );
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const pptx: ChatMessage["attachments"] = [
      {
        id: "7",
        kind: "file",
        name: "deck.pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        data: buffer.toString("base64"),
      },
    ];
    const message: ChatMessage = { role: "user", content: "", attachments: pptx };
    const content = await toUserContent("anthropic", message);

    expect(content).toEqual([{ type: "text", text: expect.stringContaining("Hello Slide") }]);
  });

  it("degrades to a readable note for a binary format with no known extractor", async () => {
    const unknown: ChatMessage["attachments"] = [
      { id: "8", kind: "file", name: "archive.bin", mimeType: "application/octet-stream", data: "aGVsbG8=" },
    ];
    const message: ChatMessage = { role: "user", content: "", attachments: unknown };
    const content = await toUserContent("anthropic", message);

    expect(content).toEqual([
      { type: "text", text: '[Could not read "archive.bin" (application/octet-stream) — unsupported or unreadable file type]' },
    ]);
  });

  it("degrades to a text-only note for providers known not to support attachments", async () => {
    const message: ChatMessage = { role: "user", content: "what is this?", attachments: image };
    const content = await toUserContent("ollama", message);

    expect(content).toBe(
      'what is this?\n\n[1 attachment(s) not sent — the "ollama" provider does not support image/file attachments: "pixel.png"]',
    );
  });

  it("degrades to just the note when there is no text alongside the attachment", async () => {
    const message: ChatMessage = { role: "user", content: "", attachments: image };
    const content = await toUserContent("ollama", message);

    expect(content).toBe('[1 attachment(s) not sent — the "ollama" provider does not support image/file attachments: "pixel.png"]');
  });

  it("extracts text from a document attachment for an attachment-incapable provider instead of dropping it — text extraction needs no multimodal support", async () => {
    const markdown: ChatMessage["attachments"] = [
      { id: "9", kind: "file", name: "notes.md", mimeType: "text/markdown", data: Buffer.from("# Title\n\nBody").toString("base64") },
    ];
    const message: ChatMessage = { role: "user", content: "summarize this", attachments: markdown };
    const content = await toUserContent("ollama", message);

    expect(content).toBe("summarize this\n\n--- notes.md (text/markdown) ---\n# Title\n\nBody");
  });

  it("extracts what it can and notes only the undeliverable attachments for an attachment-incapable provider", async () => {
    const message: ChatMessage = { role: "user", content: "what is this?", attachments: [...image!, ...textFile!] };
    const content = await toUserContent("ollama", message);

    expect(content).toBe(
      'what is this?\n\n--- note.txt (text/plain) ---\nhello world\n\n[1 attachment(s) not sent — the "ollama" provider does not support image/file attachments: "pixel.png"]',
    );
  });
});

describe("repairStringifiedToolArgs", () => {
  it("parses a JSON-array-shaped string field back into an array", () => {
    const raw = { tasks: '[{"name":"x"}]' };
    expect(repairStringifiedToolArgs(raw)).toEqual({ tasks: [{ name: "x" }] });
  });

  it("parses a JSON-object-shaped string field back into an object", () => {
    const raw = { config: '{"retries":3}' };
    expect(repairStringifiedToolArgs(raw)).toEqual({ config: { retries: 3 } });
  });

  it("leaves plain string fields untouched", () => {
    const raw = { query: "what is the weather" };
    expect(repairStringifiedToolArgs(raw)).toEqual({ query: "what is the weather" });
  });

  it("leaves a malformed JSON-looking string as-is instead of throwing", () => {
    const raw = { tasks: "[not valid json" };
    expect(repairStringifiedToolArgs(raw)).toEqual({ tasks: "[not valid json" });
  });

  it("passes through non-object input unchanged", () => {
    expect(repairStringifiedToolArgs("just a string")).toBe("just a string");
    expect(repairStringifiedToolArgs(null)).toBe(null);
    expect(repairStringifiedToolArgs(undefined)).toBe(undefined);
  });
});
