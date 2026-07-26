import { describe, expect, it } from "vitest";
import { googleSignInErrorMessage } from "./components/SignInScreen";

describe("googleSignInErrorMessage", () => {
  it("surfaces a Rust command's plain-string rejection verbatim", () => {
    // Tauri's invoke() rejects with the raw string the Rust side returned, not an Error.
    expect(googleSignInErrorMessage("Google sign-in was denied or cancelled (access_denied).")).toBe(
      "Google sign-in was denied or cancelled (access_denied).",
    );
    expect(googleSignInErrorMessage("Could not start loopback listener on port 8765: Address already in use")).toBe(
      "Could not start loopback listener on port 8765: Address already in use",
    );
  });

  it("uses an Error's message", () => {
    expect(googleSignInErrorMessage(new Error("Google sign-in failed: redirect_uri_mismatch"))).toBe(
      "Google sign-in failed: redirect_uri_mismatch",
    );
  });

  it("reads .message off a plain object rejection", () => {
    expect(googleSignInErrorMessage({ message: "loopback bind refused" })).toBe("loopback bind refused");
  });

  it("falls back only when there is genuinely nothing to show", () => {
    expect(googleSignInErrorMessage("")).toBe("Google sign-in failed.");
    expect(googleSignInErrorMessage(new Error("  "))).toBe("Google sign-in failed.");
    expect(googleSignInErrorMessage(undefined)).toBe("Google sign-in failed.");
    expect(googleSignInErrorMessage(null)).toBe("Google sign-in failed.");
  });
});
