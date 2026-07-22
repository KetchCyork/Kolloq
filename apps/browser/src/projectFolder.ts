/**
 * Wraps the File System Access API for project working folders (spec §4: explicit folder
 * selection via the OS picker, access scoped to that folder and its subfolders only). Chrome and
 * Edge support it; Safari and Firefox don't (`isFolderAccessSupported` is false there), so the UI
 * falls back to knowledge-file uploads per spec §3.1.
 */

export function isFolderAccessSupported(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

/** Opens the native OS folder picker and requests read-write access to the chosen folder.
 * Throws (typically `AbortError`) if the user cancels the dialog — callers should swallow that. */
export async function pickWorkingFolder(): Promise<FileSystemDirectoryHandle> {
  if (!window.showDirectoryPicker) {
    throw new Error("Folder access isn't available in this browser.");
  }
  return window.showDirectoryPicker({ mode: "readwrite" });
}

/** Checks (and, if `request` is true, prompts for) read-write permission on a previously granted
 * handle. Browsers don't persist permission grants forever, so a handle restored from IndexedDB
 * after a reload may need this before it's usable again. `request` requires a user gesture —
 * only pass true from a click handler. */
export async function verifyFolderPermission(
  handle: FileSystemDirectoryHandle,
  request: boolean,
): Promise<PermissionState> {
  const current = await handle.queryPermission({ mode: "readwrite" });
  if (current === "granted" || !request) return current;
  return handle.requestPermission({ mode: "readwrite" });
}

export interface FolderEntry {
  name: string;
  kind: "file" | "directory";
}

/** Lists the immediate (non-recursive) contents of a working folder for the Files panel. */
export async function listFolderEntries(handle: FileSystemDirectoryHandle): Promise<FolderEntry[]> {
  const entries: FolderEntry[] = [];
  for await (const child of handle.values()) {
    entries.push({ name: child.name, kind: child.kind });
  }
  return entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
