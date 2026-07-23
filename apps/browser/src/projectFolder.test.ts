import { afterEach, describe, expect, it, vi } from "vitest";

const dialogOpenMock = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => dialogOpenMock(...args),
}));

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

// projectFolder's Tauri gate (`isTauriRuntime`) lives in ./credentials and normally detects the
// Tauri webview via `window.__TAURI_INTERNALS__`. Mock it directly so these tests can drive both
// the desktop and plain-browser code paths without needing a real DOM.
let inTauriRuntime = false;
vi.mock("./credentials", () => ({
  isTauriRuntime: () => inTauriRuntime,
}));

import {
  isFolderAccessSupported,
  listFolderEntries,
  pickWorkingFolder,
  verifyFolderPermission,
  workingFolderName,
} from "./projectFolder";

afterEach(() => {
  inTauriRuntime = false;
  dialogOpenMock.mockReset();
  invokeMock.mockReset();
  vi.unstubAllGlobals();
});

describe("isFolderAccessSupported", () => {
  it("is true under the Tauri runtime even without the File System Access API", () => {
    vi.stubGlobal("window", {});
    inTauriRuntime = true;
    expect(isFolderAccessSupported()).toBe(true);
  });

  it("is false with no window at all", () => {
    expect(isFolderAccessSupported()).toBe(false);
  });

  it("is false in a plain browser window without Tauri or the File System Access API", () => {
    vi.stubGlobal("window", {});
    expect(isFolderAccessSupported()).toBe(false);
  });
});

describe("pickWorkingFolder under Tauri", () => {
  it("opens the native dialog and returns a tauri-kind handle", async () => {
    vi.stubGlobal("window", {});
    inTauriRuntime = true;
    dialogOpenMock.mockResolvedValue("/Users/chris/Projects/demo");

    const handle = await pickWorkingFolder();

    expect(handle).toEqual({ kind: "tauri", path: "/Users/chris/Projects/demo" });
    expect(dialogOpenMock).toHaveBeenCalledWith({ directory: true, multiple: false });
  });

  it("throws if the user cancels the dialog", async () => {
    vi.stubGlobal("window", {});
    inTauriRuntime = true;
    dialogOpenMock.mockResolvedValue(null);

    await expect(pickWorkingFolder()).rejects.toThrow();
  });
});

describe("workingFolderName", () => {
  it("takes the last segment of a Tauri path", () => {
    expect(workingFolderName({ kind: "tauri", path: "/Users/chris/Projects/demo" })).toBe("demo");
  });

  it("handles Windows-style separators", () => {
    expect(workingFolderName({ kind: "tauri", path: "C:\\Users\\chris\\demo" })).toBe("demo");
  });
});

describe("verifyFolderPermission", () => {
  it("is always granted for a Tauri handle, since native dialog access isn't re-checked like the browser API is", async () => {
    await expect(verifyFolderPermission({ kind: "tauri", path: "/tmp/demo" }, false)).resolves.toBe("granted");
  });
});

describe("listFolderEntries under Tauri", () => {
  it("invokes the Rust command and sorts directories before files", async () => {
    invokeMock.mockResolvedValue([
      { name: "b.txt", kind: "file" },
      { name: "a-folder", kind: "directory" },
    ]);

    const entries = await listFolderEntries({ kind: "tauri", path: "/tmp/demo" });

    expect(invokeMock).toHaveBeenCalledWith("list_working_folder_entries", { path: "/tmp/demo" });
    expect(entries).toEqual([
      { name: "a-folder", kind: "directory" },
      { name: "b.txt", kind: "file" },
    ]);
  });
});
