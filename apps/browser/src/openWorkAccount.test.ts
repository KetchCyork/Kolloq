import { describe, expect, it } from "vitest";
import { signInWithPassword } from "./openWorkAccount";

describe("signInWithPassword", () => {
  it("mints a session keyed by the trimmed email", () => {
    const session = signInWithPassword("  person@example.com  ");
    expect(session.email).toBe("person@example.com");
    expect(session.method).toBe("password");
    expect(typeof session.signedInAt).toBe("number");
  });

  it("rejects an empty email", () => {
    expect(() => signInWithPassword("   ")).toThrow(/email/i);
  });
});
