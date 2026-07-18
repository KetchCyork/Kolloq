import type { ToolCall, ToolDefinition } from "../providers/types.js";

/** Identity helper so tool definitions get inference on `parameters` and `execute` together. */
export function defineTool<Args, Result>(tool: ToolDefinition<Args, Result>): ToolDefinition<Args, Result> {
  return tool;
}

/**
 * Structural interface implemented by both `ToolRegistry` and `ScopedToolRegistry`, so the agent
 * runner and orchestrator can accept either without depending on the concrete class.
 */
export interface ToolSource {
  list(): ToolDefinition[];
  get(name: string): ToolDefinition | undefined;
  execute(toolCall: Pick<ToolCall, "name" | "arguments">): Promise<unknown>;
}

export class ToolRegistry implements ToolSource {
  private readonly tools = new Map<string, ToolDefinition>();

  register<Args, Result>(tool: ToolDefinition<Args, Result>): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool as ToolDefinition);
    return this;
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  async execute(toolCall: Pick<ToolCall, "name" | "arguments">): Promise<unknown> {
    const tool = this.tools.get(toolCall.name);
    if (!tool) {
      throw new Error(`Unknown tool: ${toolCall.name}`);
    }
    const args = tool.parameters.parse(toolCall.arguments);
    return tool.execute(args);
  }
}
