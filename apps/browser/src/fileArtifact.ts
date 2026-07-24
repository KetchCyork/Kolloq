import type { FileArtifact } from "@newvector/core";
import { mimeTypeForPath } from "@newvector/core";
import { isTauriRuntime } from "./credentials";
import { nodeContextAvailable, readSandboxFileViaNode } from "./nodeContext";

/**
 * Browser/desktop download surface for tool-produced files. Any tool that returns a
 * {@link FileArtifact} (the Office generators today) gets a download button in the message renderer;
 * this module turns that artifact into an actual file download.
 *
 * Two retrieval paths, mirroring how the bytes reach us:
 *  - `contentBase64` present → the tool shipped the bytes inline (the only path that works in a plain
 *    browser, which has no filesystem access). We decode and download directly.
 *  - Desktop (Tauri) with only a sandbox `path` → read the bytes off disk via the Node execution
 *    context (the sidecar). Outside that runtime there is nothing to read from, so we surface a
 *    clear, honest error rather than silently doing nothing.
 */

/** Human-readable file size, e.g. 1536 -> "1.5 KB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/** The download filename: the artifact path's basename (works for both "/" and "\" separators). */
export function artifactFilename(artifact: FileArtifact): string {
  const segments = artifact.path.split(/[\\/]/);
  return segments[segments.length - 1] || artifact.path;
}

/** True when the artifact carries enough to be downloaded in the current runtime. */
export function canDownloadArtifact(artifact: FileArtifact): boolean {
  // Inline bytes work everywhere; on the desktop we can also read them back off the sandbox disk.
  if (typeof artifact.contentBase64 === "string" && artifact.contentBase64.length > 0) return true;
  return nodeContextAvailable();
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Downloads the file an agent generated. Resolves once the browser's save dialog has been triggered.
 * Throws a user-facing Error when the bytes can't be retrieved in the current runtime.
 *
 * `sessionId` scopes the desktop read-back path to the session's sandbox; it's only needed when the
 * artifact carries no inline bytes (the desktop-only case).
 */
export async function downloadFileArtifact(artifact: FileArtifact, sessionId?: string): Promise<void> {
  const filename = artifactFilename(artifact);
  const mimeType = artifact.mimeType || mimeTypeForPath(artifact.path);

  if (typeof artifact.contentBase64 === "string" && artifact.contentBase64.length > 0) {
    const blob = new Blob([base64ToBytes(artifact.contentBase64)], { type: mimeType });
    triggerBlobDownload(blob, filename);
    return;
  }

  // No inline bytes. In the desktop shell this file lives on the sandbox disk; read it back through
  // the Node execution context (the sidecar) rather than carrying base64 around.
  if (nodeContextAvailable() && sessionId) {
    const { contentBase64, mimeType: readMime } = await readSandboxFileViaNode(sessionId, artifact.path);
    const blob = new Blob([base64ToBytes(contentBase64)], { type: artifact.mimeType || readMime });
    triggerBlobDownload(blob, filename);
    return;
  }

  throw new Error(
    isTauriRuntime()
      ? `Can't download "${filename}": its session context is unavailable, so the desktop sandbox can't be read.`
      : `Can't download "${filename}": this file's contents aren't available in the browser.`,
  );
}
