import { describe, expect, it } from "vitest";
import { describeSignInError } from "./SignInScreen";

describe("describeSignInError", () => {
  it("uses an Error's message", () => {
    expect(describeSignInError(new Error("boom"), "fallback")).toBe("boom");
  });

  it("surfaces a Tauri plain-string rejection instead of the generic fallback", () => {
    // This is the real bug: `invoke` rejects with the Rust `Err(String)` as a bare string, not an
    // Error, so the old `err instanceof Error` check collapsed every OAuth failure to the fallback.
    expect(
      describeSignInError("Could not start loopback listener on port 8765: Address already in use", "Google sign-in failed."),
    ).toBe("Could not start loopback listener on port 8765: Address already in use");
    expect(
      describeSignInError("Timed out waiting for Google sign-in. Close the browser tab and try again.", "Google sign-in failed."),
    ).toBe("Timed out waiting for Google sign-in. Close the browser tab and try again.");
  });

  it("reads a message property off a plain object rejection", () => {
    expect(describeSignInError({ message: "redirect_uri_mismatch" }, "fallback")).toBe("redirect_uri_mismatch");
  });

  it("falls back only when there is nothing usable", () => {
    expect(describeSignInError(null, "Google sign-in failed.")).toBe("Google sign-in failed.");
    expect(describeSignInError("   ", "Google sign-in failed.")).toBe("Google sign-in failed.");
    expect(describeSignInError(new Error(""), "Google sign-in failed.")).toBe("Google sign-in failed.");
  });
});
