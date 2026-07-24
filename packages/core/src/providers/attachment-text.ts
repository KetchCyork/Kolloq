import { Buffer } from "buffer";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import mammoth from "mammoth";
import type { ChatAttachment } from "./types.js";

/**
 * This module is bundled into the browser build (it sits behind the AI SDK adapter's attachment
 * pipeline, which the browser app calls directly — there's no Node-side process in between). But
 * mammoth and exceljs are Node-oriented libraries that reference the global `Buffer` internally,
 * which doesn't exist in a real browser. The "buffer" package is the standard polyfill for this;
 * importing it (rather than relying on the ambient Node global) resolves to the real node:buffer
 * built-in under Node and to the polyfill under a bundler, so this line is a no-op in Node and a
 * real polyfill in the browser.
 */
if (typeof globalThis.Buffer === "undefined") {
  (globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const TEXT_MIME_TYPES = new Set(["application/json", "application/xml", "application/x-yaml", "application/yaml"]);
const TEXT_NAME_PATTERN = /\.(md|markdown|txt|csv|tsv|log|ya?ml|json|xml)$/i;

function isPlainTextAttachment(attachment: ChatAttachment): boolean {
  return attachment.mimeType.startsWith("text/") || TEXT_MIME_TYPES.has(attachment.mimeType) || TEXT_NAME_PATTERN.test(attachment.name);
}

async function extractDocxText(buffer: Buffer): Promise<string> {
  // mammoth's Node build reads `options.buffer`; its browser build (swapped in via mammoth's
  // package.json "browser" field, which bundlers respect) only reads `options.arrayBuffer` and
  // otherwise throws "Could not find file in options". Passing both keys works in either build.
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const options = { buffer, arrayBuffer } as unknown as Parameters<typeof mammoth.extractRawText>[0];
  const result = await mammoth.extractRawText(options);
  return result.value.trim();
}

async function extractXlsxText(buffer: Buffer): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheets: string[] = [];
  workbook.eachSheet((sheet) => {
    const rows: string[] = [`# ${sheet.name}`];
    sheet.eachRow((row) => {
      const cells = (row.values as unknown[]).slice(1);
      rows.push(cells.map((cell) => (cell == null ? "" : String(cell))).join("\t"));
    });
    sheets.push(rows.join("\n"));
  });
  return sheets.join("\n\n").trim();
}

async function extractPptxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)?.[0] ?? 0) - Number(b.match(/\d+/)?.[0] ?? 0));

  const slides: string[] = [];
  for (const name of slideFiles) {
    const xml = await zip.files[name].async("text");
    const runs = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((match) => match[1]);
    slides.push(runs.join(" "));
  }
  return slides.join("\n\n").trim();
}

/**
 * Extracts plain text from a non-image, non-PDF attachment so it can be inlined into the prompt
 * instead of sent as an opaque file blob. Most providers' native file/document APIs only accept
 * application/pdf (Anthropic's rejects anything else outright with a "must be a PDF" error), so
 * this is what makes Word/Excel/PowerPoint/Markdown/plain-text attachments actually work rather
 * than erroring or silently sending garbled bytes.
 *
 * Returns null when the format isn't one we know how to extract — callers should degrade
 * gracefully rather than send unreadable bytes to the model.
 */
export async function extractAttachmentText(attachment: ChatAttachment): Promise<string | null> {
  const buffer = Buffer.from(attachment.data, "base64");

  if (attachment.mimeType === DOCX_MIME || /\.docx$/i.test(attachment.name)) {
    return extractDocxText(buffer);
  }
  if (attachment.mimeType === XLSX_MIME || /\.xlsx$/i.test(attachment.name)) {
    return extractXlsxText(buffer);
  }
  if (attachment.mimeType === PPTX_MIME || /\.pptx$/i.test(attachment.name)) {
    return extractPptxText(buffer);
  }
  if (isPlainTextAttachment(attachment)) {
    return buffer.toString("utf-8");
  }

  return null;
}
