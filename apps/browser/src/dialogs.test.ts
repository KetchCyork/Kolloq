import { afterEach, describe, expect, it } from "vitest";
import {
  alertDialog,
  confirmDialog,
  promptDialog,
  resolveDialog,
  subscribeDialogs,
  type DialogRequest,
} from "./dialogs";

/**
 * These tests drive the framework-agnostic controller directly (no DOM) the way
 * <DialogHost/> does at runtime: subscribe, read the queued request, resolve it.
 */
describe("dialog controller", () => {
  let queue: DialogRequest[] = [];
  const unsub = subscribeDialogs((next) => {
    queue = next;
  });
  afterEach(() => {
    // Drain anything a test left pending so state doesn't leak across tests.
    for (const request of [...queue]) resolveDialog(request.id, undefined);
  });

  it("queues a confirm and resolves true when accepted", async () => {
    const promise = confirmDialog("Delete this?");
    expect(queue).toHaveLength(1);
    expect(queue[0].kind).toBe("confirm");
    expect(queue[0].opts.message).toBe("Delete this?");

    resolveDialog(queue[0].id, true);
    await expect(promise).resolves.toBe(true);
    expect(queue).toHaveLength(0);
  });

  it("resolves a confirm false when dismissed", async () => {
    const promise = confirmDialog({ message: "Sure?", danger: true });
    resolveDialog(queue[0].id, false);
    await expect(promise).resolves.toBe(false);
  });

  it("resolves an alert once acknowledged", async () => {
    const promise = alertDialog("Heads up");
    expect(queue[0].kind).toBe("alert");
    resolveDialog(queue[0].id, undefined);
    await expect(promise).resolves.toBeUndefined();
  });

  it("resolves a prompt with the entered text, or null when cancelled", async () => {
    const accepted = promptDialog({ message: "Name?", defaultValue: "x" });
    resolveDialog(queue[0].id, "typed value");
    await expect(accepted).resolves.toBe("typed value");

    const cancelled = promptDialog("Name?");
    resolveDialog(queue[0].id, null);
    await expect(cancelled).resolves.toBeNull();
  });

  it("shows dialogs one at a time in request order (FIFO)", async () => {
    const first = confirmDialog("first");
    const second = confirmDialog("second");
    expect(queue).toHaveLength(2);
    expect(queue[0].opts.message).toBe("first");

    resolveDialog(queue[0].id, true);
    await expect(first).resolves.toBe(true);
    // Second stays queued until it too is resolved.
    expect(queue).toHaveLength(1);
    expect(queue[0].opts.message).toBe("second");
    resolveDialog(queue[0].id, false);
    await expect(second).resolves.toBe(false);
  });

  it("ignores resolving an unknown id", () => {
    expect(() => resolveDialog(999999, true)).not.toThrow();
  });

  // Referenced so the single subscription is intentional and lint-clean; the queue
  // stays subscribed for the whole file (vitest isolates modules per file).
  void unsub;
});
