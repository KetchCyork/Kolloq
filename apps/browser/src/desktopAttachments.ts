import type { ChatAttachment } from "@newvector/core";
import type { AttachmentBatch, AttachmentRejection } from "./attachments";
import { MAX_ATTACHMENT_BYTES } from "./attachments";
import { randomId } from "./utils";

const MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  csv: "text/csv",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  js: "text/javascript",
  ts: "text/plain",
  tsx: "text/plain",
  jsx: "text/plain",
  xml: "application/xml",
  yaml: "application/yaml",
  yml: "application/yaml",
};

/** No `File.type` is available for natively-read bytes, so the MIME type is guessed from the extension instead. */
function guessMimeType(fileName: string): string {
  const extension = fileName.split(".").pop()?.toLowerCase();
  return (extension && MIME_TYPES_BY_EXTENSION[extension]) || "application/octet-stream";
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

interface FoundFile {
  /** Forward-slash path relative to the picked folder, mirroring the browser's `webkitRelativePath`. */
  relativePath: string;
  fullPath: string;
}

async function walkDirectory(
  fs: typeof import("@tauri-apps/plugin-fs"),
  join: typeof import("@tauri-apps/api/path").join,
  fullPath: string,
  relativePath: string,
): Promise<FoundFile[]> {
  const entries = await fs.readDir(fullPath);
  const found: FoundFile[] = [];
  for (const entry of entries) {
    const entryFullPath = await join(fullPath, entry.name);
    const entryRelativePath = `${relativePath}/${entry.name}`;
    if (entry.isDirectory) {
      found.push(...(await walkDirectory(fs, join, entryFullPath, entryRelativePath)));
    } else if (entry.isFile) {
      found.push({ relativePath: entryRelativePath, fullPath: entryFullPath });
    }
  }
  return found;
}

/**
 * Desktop-only equivalent of `filesToAttachments` for folder uploads. The browser's
 * `webkitdirectory` input doesn't reliably expose folder contents inside a Tauri webview, so this
 * opens Tauri's native directory-picker dialog instead, then walks and reads the chosen folder via
 * tauri-plugin-fs (picking with `recursive: true` grants that read access for the whole subtree).
 * Returns `null` if the user cancels the dialog.
 */
export async function pickFolderAttachments(): Promise<AttachmentBatch | null> {
  const [{ open }, fs, { join, basename }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/plugin-fs"),
    import("@tauri-apps/api/path"),
  ]);

  const dir = await open({ directory: true, recursive: true });
  if (!dir) return null;

  const rootName = await basename(dir);
  const files = await walkDirectory(fs, join, dir, rootName);

  const attachments: ChatAttachment[] = [];
  const rejections: AttachmentRejection[] = [];

  for (const file of files) {
    const info = await fs.stat(file.fullPath);
    if (info.size > MAX_ATTACHMENT_BYTES) {
      rejections.push({ name: file.relativePath, reason: `exceeds ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB limit` });
      continue;
    }
    const bytes = await fs.readFile(file.fullPath);
    const mimeType = guessMimeType(file.relativePath);
    attachments.push({
      id: randomId(),
      kind: mimeType.startsWith("image/") ? "image" : "file",
      name: file.relativePath,
      mimeType,
      data: bytesToBase64(bytes),
    });
  }

  return { attachments, rejections };
}
