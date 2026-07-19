import { promises as fs } from "node:fs";
import { createFileTools } from "./builtin/fs.js";
import { createOfficeTools } from "./builtin/office.js";
import { ToolRegistry } from "./registry.js";
import { mimeTypeForPath } from "./artifacts.js";
import { resolveSandboxedRead } from "./builtin/sandbox.js";

/**
 * Request handler for the desktop Node execution context (the sidecar).
 *
 * The desktop shell has no filesystem or Node runtime of its own — its front-end is the same browser
 * bundle. So when the agent calls a Node-only tool (the Office generators today; fs/shell/code
 * interpreter later), the desktop routes the call to an out-of-process Node runtime that imports
 * `@newvector/core/node` and calls this handler. Everything here runs in that trusted Node process.
 *
 * The protocol is a single stateless request → response, so the sidecar can be a short-lived process
 * spawned per call with no session state to manage. Every request carries its own `sandboxRoot`
 * (resolved and created by the trusted Rust host, never by the model), and all disk access is
 * contained to that root by the same sandbox helpers the CLI uses.
 */

/** Run a named Node-only tool with the model's arguments, scoped to `sandboxRoot`. */
export interface NodeExecRequest {
  op: "exec";
  /** Absolute path of this session's sandbox directory, resolved by the trusted host. */
  sandboxRoot: string;
  /** Tool name (must be one the sidecar registers, e.g. `generate_word_document`). */
  name: string;
  /** The model's tool arguments; validated by the tool's own schema before it runs. */
  args: unknown;
}

/** Read a previously generated file back out of the sandbox as base64 (the download read-back path). */
export interface NodeReadRequest {
  op: "read";
  sandboxRoot: string;
  /** Path relative to `sandboxRoot`, e.g. the `path` from a `FileArtifact`. */
  path: string;
}

export type NodeToolRequest = NodeExecRequest | NodeReadRequest;

export type NodeToolResponse =
  | { ok: true; result: unknown }
  | { ok: true; contentBase64: string; mimeType: string; bytesRead: number }
  | { ok: false; error: string };

/**
 * Builds the tool registry the sidecar exposes for one request, scoped to `sandboxRoot`. Registers
 * the Office generators plus the sandboxed file tools; shell / code-interpreter can be added here
 * once the desktop grows an approval surface for them.
 */
function buildNodeTools(sandboxRoot: string): ToolRegistry {
  const tools = new ToolRegistry();
  for (const tool of createOfficeTools(sandboxRoot)) tools.register(tool);
  for (const tool of createFileTools(sandboxRoot)) tools.register(tool);
  return tools;
}

/** The tool names the Node execution context can run, for the host/front-end to gate registration. */
export function nodeHostToolNames(): string[] {
  return buildNodeTools("/__probe__")
    .list()
    .map((t) => t.name);
}

/**
 * Handles one sidecar request and resolves to a plain, JSON-serializable response. Never throws —
 * failures (unknown tool, bad arguments, file outside the sandbox, missing file) come back as
 * `{ ok: false, error }` so the caller across the process boundary always gets a structured answer.
 */
export async function handleNodeToolRequest(request: NodeToolRequest): Promise<NodeToolResponse> {
  try {
    if (!request || typeof request !== "object") {
      return { ok: false, error: "Malformed request" };
    }
    if (!request.sandboxRoot || typeof request.sandboxRoot !== "string") {
      return { ok: false, error: "Request is missing a sandboxRoot" };
    }

    if (request.op === "exec") {
      const tools = buildNodeTools(request.sandboxRoot);
      const result = await tools.execute({ name: request.name, arguments: request.args });
      return { ok: true, result };
    }

    if (request.op === "read") {
      const target = await resolveSandboxedRead(request.sandboxRoot, request.path);
      const bytes = await fs.readFile(target);
      return {
        ok: true,
        contentBase64: bytes.toString("base64"),
        mimeType: mimeTypeForPath(request.path),
        bytesRead: bytes.byteLength,
      };
    }

    return { ok: false, error: `Unknown op: ${(request as { op?: unknown }).op}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
