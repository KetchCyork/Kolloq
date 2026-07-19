import { defineTool } from "./registry.js";
import type { ToolDefinition } from "../providers/types.js";
import { OFFICE_TOOL_SPECS } from "./officeSpec.js";

/**
 * Proxy tools for a Node execution context.
 *
 * The Office generators (`generate_word_document`, …) depend on Node-only libraries and can't run
 * inside a browser bundle. When the agent is driven from the desktop (Tauri) shell, though, there
 * *is* a Node runtime available out-of-process (a sidecar). These proxies advertise the real Office
 * schemas to the model but, instead of doing the work in-process, hand the parsed arguments to a
 * transport that runs the tool in that Node context and returns its result (a `FileArtifact`).
 *
 * This module is dependency-free and browser-safe (it only imports the shared schemas, never the
 * Node-only generators), so it can be bundled into the browser/desktop front-end.
 */

/**
 * Runs a Node-only tool out-of-process and resolves to its raw result. Supplied by the host
 * environment — under Tauri this invokes a Rust command that drives the Node sidecar.
 */
export type NodeToolExec = (name: string, args: unknown) => Promise<unknown>;

/**
 * Builds proxy `ToolDefinition`s for the Office generators. The `rootLabel` is only cosmetic — it
 * appears in the description shown to the model (e.g. "the session sandbox"); the actual sandbox
 * directory is resolved by the Node execution context, never by the browser. Each proxy parses the
 * model's arguments against the shared schema (so malformed calls fail fast, before the round-trip)
 * and then delegates execution to `exec`.
 */
export function createOfficeProxyTools(rootLabel: string, exec: NodeToolExec): ToolDefinition[] {
  return OFFICE_TOOL_SPECS.map((spec) =>
    defineTool({
      name: spec.name,
      description: spec.describe(rootLabel),
      parameters: spec.parameters,
      execute: (args: unknown) => exec(spec.name, args),
    }),
  );
}
