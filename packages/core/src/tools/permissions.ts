import type { ToolCall } from "../providers/types.js";
import { ToolRegistry, type ToolSource } from "./registry.js";

/**
 * Wraps a shared `ToolRegistry` with a per-agent allow-list. Sub-agents get a `ScopedToolRegistry`
 * instead of direct access to the shared registry so a compromised or misbehaving sub-agent can't
 * reach tools its task never granted it (e.g. a research sub-agent shouldn't get `run_shell`).
 */
export class ScopedToolRegistry implements ToolSource {
  private readonly allowed: ReadonlySet<string>;

  constructor(
    private readonly source: ToolRegistry,
    allowedToolNames: readonly string[],
  ) {
    this.allowed = new Set(allowedToolNames);
  }

  list() {
    return this.source.list().filter((tool) => this.allowed.has(tool.name));
  }

  get(name: string) {
    return this.allowed.has(name) ? this.source.get(name) : undefined;
  }

  async execute(toolCall: Pick<ToolCall, "name" | "arguments">): Promise<unknown> {
    if (!this.allowed.has(toolCall.name)) {
      throw new Error(`Tool "${toolCall.name}" is not permitted for this agent`);
    }
    return this.source.execute(toolCall);
  }
}

/**
 * Builds a scoped view of `registry` containing only `allowedToolNames`. Names that aren't
 * registered on the source are silently dropped from `list()` (and rejected at execute-time),
 * so a typo'd permission fails closed rather than throwing at construction time.
 */
export function scopeToolRegistry(registry: ToolRegistry, allowedToolNames: readonly string[]): ScopedToolRegistry {
  return new ScopedToolRegistry(registry, allowedToolNames);
}
