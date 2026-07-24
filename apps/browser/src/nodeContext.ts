import type { NodeToolExec } from "@newvector/core";
import { isTauriRuntime } from "./credentials";

/**
 * Browser-side bridge to the desktop Node execution context.
 *
 * Node-only tools (the Office generators; fs/shell/code-interpreter later) can't run inside the
 * browser bundle. Under the Tauri desktop shell there is a Node runtime available out-of-process — a
 * short-lived sidecar the Rust host spawns. This module is the thin glue that ships a tool call over
 * to that sidecar (via a Rust `invoke` command) and hands the result back to the agent runner. All
 * the real work — building the tools, sandboxing, rendering — happens in the sidecar
 * (`@newvector/core`'s `handleNodeToolRequest`); this file only marshals arguments across the bridge.
 *
 * In a plain browser build none of this exists, so {@link nodeContextAvailable} is false and callers
 * fall back to the inline-base64 download path.
 */

/** The Rust host returns the sidecar's response verbatim; mirror of `NodeToolResponse` in core. */
type NodeToolResponse =
  | { ok: true; result: unknown }
  | { ok: true; contentBase64: string; mimeType: string; bytesRead: number }
  | { ok: false; error: string };

/** True when a Node execution context can be reached (i.e. we're running under the desktop shell). */
export function nodeContextAvailable(): boolean {
  return isTauriRuntime();
}

async function invoke<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(command, args);
}

/**
 * The Rust commands hand back the sidecar's raw stdout (a JSON `NodeToolResponse`). A dead sidecar
 * or spawn failure rejects the `invoke` itself; a tool-level failure comes back as `{ ok: false }`.
 * Either way we surface a single thrown Error so callers don't have to branch.
 */
function parseResponse(raw: string): Extract<NodeToolResponse, { ok: true }> {
  let parsed: NodeToolResponse;
  try {
    parsed = JSON.parse(raw) as NodeToolResponse;
  } catch {
    throw new Error("The desktop Node runtime returned a malformed response.");
  }
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed;
}

/**
 * A {@link NodeToolExec} bound to one session's sandbox. Passing `sessionId` (not a raw path) keeps
 * sandbox-root policy in the trusted Rust host: it resolves the per-session directory and creates it.
 */
export function createTauriNodeExec(sessionId: string): NodeToolExec {
  return async (name, args) => {
    const raw = await invoke<string>("node_tool_exec", {
      sessionId,
      name,
      args: JSON.stringify(args ?? {}),
    });
    const response = parseResponse(raw);
    if (!("result" in response)) {
      throw new Error(`The desktop Node runtime did not return a result for "${name}".`);
    }
    return response.result;
  };
}

/** Reads a generated file back out of a session's sandbox as bytes (the download read-back path). */
export async function readSandboxFileViaNode(
  sessionId: string,
  path: string,
): Promise<{ contentBase64: string; mimeType: string }> {
  const raw = await invoke<string>("node_read_file", { sessionId, path });
  const response = parseResponse(raw);
  if (!("contentBase64" in response)) {
    throw new Error(`The desktop Node runtime did not return file contents for "${path}".`);
  }
  return { contentBase64: response.contentBase64, mimeType: response.mimeType };
}
