/**
 * Project working folders (spec §4: explicit folder selection via the OS picker, access scoped
 * to that folder and its subfolders only). Two backends:
 *  - Chrome/Edge: the browser's File System Access API (`window.showDirectoryPicker`).
 *  - The Tauri desktop shell: a native dialog (`@tauri-apps/plugin-dialog`) plus a Rust command
 *    to list directory contents, since the webview there has no File System Access API either
 *    and Tauri's picker returns a path string, not a handle.
 * Safari and Firefox support neither, so `isFolderAccessSupported` is false there and the UI
 * falls back to knowledge-file uploads per spec §3.1.
 */

import { isTauriRuntime } from "./credentials";

export function isFolderAccessSupported(): boolean {
  if (typeof window === "undefined") return false;
  return isTauriRuntime() || typeof window.showDirectoryPicker === "function";
}

/** A connected working folder, backed by either a browser handle or a native Tauri path. */
export type WorkingFolderHandle =
  | { kind: "browser"; handle: FileSystemDirectoryHandle }
  | { kind: "tauri"; path: string };

/** Opens the native OS folder picker and requests read-write access to the chosen folder.
 * Throws (typically `AbortError` in the browser, or if the user cancels the Tauri dialog) —
 * callers should swallow that. */
export async function pickWorkingFolder(): Promise<WorkingFolderHandle> {
  if (isTauriRuntime()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({ directory: true, multiple: false });
    if (!path || Array.isArray(path)) {
      throw new Error("No folder selected.");
    }
    return { kind: "tauri", path };
  }
  if (!window.showDirectoryPicker) {
    throw new Error("Folder access isn't available in this browser.");
  }
  const handle = await window.showDirectoryPicker({ mode: "readwrite" });
  return { kind: "browser", handle };
}

/** The folder's own name. Browsers don't expose the full path; Tauri gives us one, so this
 * takes just the last path segment to keep the displayed location consistent either way. */
export function workingFolderName(handle: WorkingFolderHandle): string {
  if (handle.kind === "browser") return handle.handle.name;
  const segments = handle.path.split(/[/\\]/).filter(Boolean);
  return segments[segments.length - 1] ?? handle.path;
}

/** Checks (and, if `request` is true, prompts for) read-write permission on a previously granted
 * handle. Browsers don't persist permission grants forever, so a handle restored from IndexedDB
 * after a reload may need this before it's usable again. `request` requires a user gesture —
 * only pass true from a click handler. Tauri's native dialog access isn't gated the same way, so
 * it's always "granted" once a path has been picked. */
export async function verifyFolderPermission(
  handle: WorkingFolderHandle,
  request: boolean,
): Promise<PermissionState> {
  if (handle.kind === "tauri") return "granted";
  const current = await handle.handle.queryPermission({ mode: "readwrite" });
  if (current === "granted" || !request) return current;
  return handle.handle.requestPermission({ mode: "readwrite" });
}

export interface FolderEntry {
  name: string;
  kind: "file" | "directory";
}

function sortEntries(entries: FolderEntry[]): FolderEntry[] {
  return entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** Lists the immediate (non-recursive) contents of a working folder for the Files panel. */
export async function listFolderEntries(handle: WorkingFolderHandle): Promise<FolderEntry[]> {
  if (handle.kind === "tauri") {
    const { invoke } = await import("@tauri-apps/api/core");
    const entries = await invoke<FolderEntry[]>("list_working_folder_entries", { path: handle.path });
    return sortEntries(entries);
  }
  const entries: FolderEntry[] = [];
  for await (const child of handle.handle.values()) {
    entries.push({ name: child.name, kind: child.kind });
  }
  return sortEntries(entries);
}
