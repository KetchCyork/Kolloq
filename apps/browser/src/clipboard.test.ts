import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clipboard";

/**
 * Tests run in the node environment (no jsdom), so there is no real DOM for the
 * legacy execCommand fallback. We exercise the async Clipboard API path and the
 * final failure path by stubbing `window`/`navigator` globals.
 */
describe("copyText", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the async Clipboard API when available in a secure context", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await copyText("hello");

    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("throws when the async API rejects and no DOM fallback is available", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    // `document` is undefined in the node test env, so the legacy path can't run.

    await expect(copyText("hello")).rejects.toThrow(/couldn't copy/i);
    expect(writeText).toHaveBeenCalled();
  });

  it("skips the async API outside a secure context", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", { isSecureContext: false });
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    // No DOM fallback in node env, so it throws — but crucially never touches the
    // async API that would reject in this (insecure) context.
    await expect(copyText("hello")).rejects.toThrow(/couldn't copy/i);
    expect(writeText).not.toHaveBeenCalled();
  });
});
