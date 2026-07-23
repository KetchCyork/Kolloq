import { beforeEach, describe, expect, it } from "vitest";

// Vitest runs these in a plain Node environment (no `window`/`localStorage`) — polyfill the
// minimal Storage surface the module needs, same approach the app itself uses (see the
// `typeof localStorage === "undefined"` guards in openWorkAccount.ts and preferences.ts).
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

(globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage() as unknown as Storage;

import { loadAppSession, signInWithPassword, signOut } from "./openWorkAccount";

beforeEach(() => {
  signOut();
});

describe("loadAppSession", () => {
  it("is null when nothing has signed in yet", () => {
    expect(loadAppSession()).toBeNull();
  });

  it("ignores corrupt storage instead of throwing", () => {
    localStorage.setItem("openwork.account.session.v1", "{not json");
    expect(loadAppSession()).toBeNull();
  });
});

describe("signInWithPassword", () => {
  it("mints and persists a session keyed by the trimmed email", () => {
    const session = signInWithPassword("  person@example.com  ");
    expect(session.email).toBe("person@example.com");
    expect(session.method).toBe("password");
    expect(loadAppSession()).toEqual(session);
  });

  it("rejects an empty email", () => {
    expect(() => signInWithPassword("   ")).toThrow(/email/i);
  });
});

describe("signOut", () => {
  it("clears a persisted session", () => {
    signInWithPassword("person@example.com");
    signOut();
    expect(loadAppSession()).toBeNull();
  });
});
