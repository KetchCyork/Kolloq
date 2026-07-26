import { describe, expect, it, vi } from "vitest";
import { MAX_ATTACHMENT_BYTES } from "./attachments";

interface FakeEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
}

const TREE: Record<string, FakeEntry[]> = {
  "/Users/test/MyFolder": [
    { name: "notes.txt", isDirectory: false, isFile: true },
    { name: "image.png", isDirectory: false, isFile: true },
    { name: "sub", isDirectory: true, isFile: false },
  ],
  "/Users/test/MyFolder/sub": [{ name: "big.bin", isDirectory: false, isFile: true }],
};

const FILE_BYTES: Record<string, Uint8Array> = {
  "/Users/test/MyFolder/notes.txt": new TextEncoder().encode("hello"),
  "/Users/test/MyFolder/image.png": new Uint8Array([1, 2, 3]),
};

const FILE_SIZES: Record<string, number> = {
  "/Users/test/MyFolder/notes.txt": FILE_BYTES["/Users/test/MyFolder/notes.txt"].byteLength,
  "/Users/test/MyFolder/image.png": FILE_BYTES["/Users/test/MyFolder/image.png"].byteLength,
  "/Users/test/MyFolder/sub/big.bin": MAX_ATTACHMENT_BYTES + 1,
};

let openResult: string | null = "/Users/test/MyFolder";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: () => Promise.resolve(openResult),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readDir: (path: string) => Promise.resolve(TREE[path] ?? []),
  stat: (path: string) => Promise.resolve({ size: FILE_SIZES[path] ?? 0 }),
  readFile: (path: string) => Promise.resolve(FILE_BYTES[path] ?? new Uint8Array()),
}));

vi.mock("@tauri-apps/api/path", () => ({
  join: (...parts: string[]) => Promise.resolve(parts.join("/")),
  basename: (path: string) => Promise.resolve(path.split("/").pop() ?? path),
}));

import { pickFolderAttachments } from "./desktopAttachments";

describe("pickFolderAttachments", () => {
  it("returns null when the user cancels the dialog", async () => {
    openResult = null;
    expect(await pickFolderAttachments()).toBeNull();
    openResult = "/Users/test/MyFolder";
  });

  it("recursively reads a picked folder into ChatAttachment[], rejecting oversized files", async () => {
    const batch = await pickFolderAttachments();
    expect(batch).not.toBeNull();

    const names = batch!.attachments.map((a) => a.name).sort();
    expect(names).toEqual(["MyFolder/image.png", "MyFolder/notes.txt"]);

    const notes = batch!.attachments.find((a) => a.name === "MyFolder/notes.txt")!;
    expect(notes.kind).toBe("file");
    expect(notes.mimeType).toBe("text/plain");
    expect(atob(notes.data)).toBe("hello");

    const image = batch!.attachments.find((a) => a.name === "MyFolder/image.png")!;
    expect(image.kind).toBe("image");
    expect(image.mimeType).toBe("image/png");

    expect(batch!.rejections).toEqual([
      { name: "MyFolder/sub/big.bin", reason: `exceeds ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB limit` },
    ]);
  });
});
