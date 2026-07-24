import { describe, expect, it } from "vitest";
import { extractFileArtifact, mimeTypeForPath } from "./artifacts.js";

describe("mimeTypeForPath", () => {
  it("maps known Office extensions", () => {
    expect(mimeTypeForPath("report.docx")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(mimeTypeForPath("data.xlsx")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(mimeTypeForPath("deck.PPTX")).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
  });

  it("handles nested paths and is case-insensitive", () => {
    expect(mimeTypeForPath("out/nested/notes.MD")).toBe("text/markdown");
  });

  it("falls back to a generic binary stream for unknown or missing extensions", () => {
    expect(mimeTypeForPath("archive.unknownext")).toBe("application/octet-stream");
    expect(mimeTypeForPath("no-extension")).toBe("application/octet-stream");
  });
});

describe("extractFileArtifact", () => {
  it("recognizes a { path, bytesWritten } result and infers the mime type", () => {
    const artifact = extractFileArtifact({ path: "report.docx", bytesWritten: 2048 });
    expect(artifact).toEqual({
      path: "report.docx",
      bytesWritten: 2048,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  });

  it("carries inline base64 bytes through when present", () => {
    const artifact = extractFileArtifact({
      path: "data.xlsx",
      bytesWritten: 10,
      contentBase64: "UEsDBA==",
    });
    expect(artifact?.contentBase64).toBe("UEsDBA==");
  });

  it("honors an explicit mime type over the inferred one", () => {
    const artifact = extractFileArtifact({ path: "thing.bin", bytesWritten: 1, mimeType: "text/csv" });
    expect(artifact?.mimeType).toBe("text/csv");
  });

  it("allows a zero-byte file", () => {
    expect(extractFileArtifact({ path: "empty.txt", bytesWritten: 0 })?.bytesWritten).toBe(0);
  });

  it("rejects results that aren't file-shaped", () => {
    expect(extractFileArtifact(null)).toBeNull();
    expect(extractFileArtifact("just a string")).toBeNull();
    expect(extractFileArtifact({ now: "2026-07-19T00:00:00Z" })).toBeNull();
    expect(extractFileArtifact({ path: "", bytesWritten: 5 })).toBeNull();
    expect(extractFileArtifact({ path: "x.txt" })).toBeNull();
    expect(extractFileArtifact({ path: "x.txt", bytesWritten: -1 })).toBeNull();
    expect(extractFileArtifact({ path: "x.txt", bytesWritten: Number.NaN })).toBeNull();
  });
});
