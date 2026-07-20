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

import { loadOpenWorkSession, signInWithOAuth, signInWithPassword, signOutOpenWork } from "./openWorkAccount";

beforeEach(() => {
  signOutOpenWork();
});

describe("loadOpenWorkSession", () => {
  it("is null when nothing has signed in yet", () => {
    expect(loadOpenWorkSession()).toBeNull();
  });

  it("ignores corrupt storage instead of throwing", () => {
    localStorage.setItem("openwork.account.session.v1", "{not json");
    expect(loadOpenWorkSession()).toBeNull();
  });
});

describe("signInWithPassword", () => {
  it("mints and persists a session keyed by the trimmed email", () => {
    const session = signInWithPassword("  person@example.com  ");
    expect(session.email).toBe("person@example.com");
    expect(session.method).toBe("password");
    expect(loadOpenWorkSession()).toEqual(session);
  });

  it("rejects an empty email", () => {
    expect(() => signInWithPassword("   ")).toThrow(/email/i);
  });
});

describe("signInWithOAuth", () => {
  it("mints and persists a session for the chosen provider", () => {
    const session = signInWithOAuth("google");
    expect(session.method).toBe("google");
    expect(loadOpenWorkSession()).toEqual(session);
  });
});

describe("signOutOpenWork", () => {
  it("clears a persisted session", () => {
    signInWithPassword("person@example.com");
    signOutOpenWork();
    expect(loadOpenWorkSession()).toBeNull();
  });
});
