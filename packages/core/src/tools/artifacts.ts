/**
 * File-artifact contract shared by every tool that produces a downloadable file (the Office
 * generators today, `write_file` and future tools tomorrow) and every front-end that offers it
 * for download (the browser renderer, the desktop shell). A tool signals "I wrote a file you can
 * download" by returning an object with a `path` and `bytesWritten`; it MAY also carry the bytes
 * inline as base64 (`contentBase64`) so a front-end with no filesystem access can download them.
 *
 * This module is intentionally dependency-free and browser-safe (no `node:*` imports) so it can be
 * imported from both `@newvector/core` (the browser bundle) and the Node-only tools.
 */

export interface FileArtifact {
  /** Path of the file relative to the tool sandbox root. Its basename is used as the download filename. */
  path: string;
  /** Number of bytes written to disk. */
  bytesWritten: number;
  /** MIME type for the download; inferred from the file extension when a tool doesn't set it. */
  mimeType: string;
  /**
   * The file bytes, base64-encoded, when the tool ships them inline. Present for tools that run in a
   * context the front-end can't reach the disk of (the browser). Absent when the front-end is expected
   * to read the file from `path` itself (e.g. the desktop shell over the sandbox fs).
   */
  contentBase64?: string;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pdf: "application/pdf",
  csv: "text/csv",
  json: "application/json",
  txt: "text/plain",
  md: "text/markdown",
  html: "text/html",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  zip: "application/zip",
};

/** Best-effort MIME type from a file path's extension, defaulting to a generic binary stream. */
export function mimeTypeForPath(path: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(path);
  const ext = match?.[1]?.toLowerCase();
  return (ext && MIME_BY_EXTENSION[ext]) || "application/octet-stream";
}

/**
 * Recognizes a raw tool result as a file artifact and normalizes it, or returns `null` when the
 * result isn't file-shaped. A result qualifies when it's an object with a non-empty string `path`
 * and a non-negative numeric `bytesWritten`. `mimeType` is honored when the tool provides one and
 * otherwise inferred from the path; `contentBase64` is carried through when present.
 */
export function extractFileArtifact(result: unknown): FileArtifact | null {
  if (!result || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;
  const { path, bytesWritten, mimeType, contentBase64 } = record;
  if (typeof path !== "string" || path.length === 0) return null;
  if (typeof bytesWritten !== "number" || !Number.isFinite(bytesWritten) || bytesWritten < 0) return null;

  return {
    path,
    bytesWritten,
    mimeType: typeof mimeType === "string" && mimeType.length > 0 ? mimeType : mimeTypeForPath(path),
    ...(typeof contentBase64 === "string" && contentBase64.length > 0 ? { contentBase64 } : {}),
  };
}
