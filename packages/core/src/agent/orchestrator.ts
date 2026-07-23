import { z } from "zod";
import type { ChatAttachment, ChatMessage, ChatProvider } from "../providers/types.js";
import { defineTool, ToolRegistry } from "../tools/registry.js";
import { scopeToolRegistry } from "../tools/permissions.js";
import { AgentEvent, AgentRunner } from "./runner.js";

/** An `AgentEvent` tagged with which agent (and, for sub-agents, which parent) produced it. */
export type OrchestratedAgentEvent = AgentEvent & {
  agentId: string;
  agentName: string;
  parentId?: string;
  depth: number;
};

export interface AgentSpec {
  name: string;
  systemPrompt?: string;
  /**
   * Tool names from the orchestrator's shared registry this agent may call. A sub-agent can never
   * be granted more than its parent already had — the effective set is `allowedTools ∩ parent's set`
   * — so delegation can only narrow permissions, never escalate them.
   */
  allowedTools?: string[];
  maxSteps?: number;
}

export interface OrchestratorOptions {
  /** Provider used for every agent spawned by this orchestrator (root and delegated). */
  provider: ChatProvider;
  sharedTools: ToolRegistry;
  /** Caps how many levels deep `delegate_task` can nest before the tool is withheld. Default 2. */
  maxDepth?: number;
  onEvent?: (event: OrchestratedAgentEvent) => void;
}

export interface DelegateTaskRequest {
  /** Short label for the sub-agent, shown in the step tracker (e.g. "researcher"). */
  name: string;
  /** The task to hand the sub-agent, in place of a user message. */
  task: string;
  systemPrompt?: string;
  /** Requested tool access; narrowed to the delegating agent's own allow-list. */
  allowedTools?: string[];
}

export interface DelegateTaskResult {
  name: string;
  result: string;
  error?: string;
}

const DELEGATE_TASK_PARAMS = z.object({
  tasks: z
    .array(
      z.object({
        name: z.string(),
        task: z.string(),
        systemPrompt: z.string().optional(),
        allowedTools: z.array(z.string()).optional(),
      }),
    )
    .min(1),
});

/**
 * Runs one or more independent sub-agents and returns each one's final answer. Fans out
 * concurrently (`Promise.all`) so multiple lenses on a problem — e.g. "researcher" + "critic" —
 * run side by side instead of one after another.
 */
export class AgentOrchestrator {
  private readonly provider: ChatProvider;
  private readonly sharedTools: ToolRegistry;
  private readonly maxDepth: number;
  private readonly onEvent?: (event: OrchestratedAgentEvent) => void;
  private counter = 0;

  constructor(options: OrchestratorOptions) {
    this.provider = options.provider;
    this.sharedTools = options.sharedTools;
    this.maxDepth = options.maxDepth ?? 2;
    this.onEvent = options.onEvent;
  }

  /**
   * Runs the top-level agent for a session. Its `allowedTools` bounds what it and its descendants
   * may ever reach. `initialMessages`/`attachments` let a caller that persists conversation history
   * (e.g. a product session resuming across turns) seed the root agent the same way a plain
   * `AgentRunner` would — sub-agents spawned via `delegate_task` never inherit these, since each gets
   * a fresh task in place of a user message.
   */
  async run(
    spec: AgentSpec,
    input: string,
    options?: { initialMessages?: ChatMessage[]; attachments?: ChatAttachment[] },
  ): Promise<ChatMessage[]> {
    return this.runAgent(spec, input, {
      parentId: undefined,
      depth: 0,
      parentAllowedTools: spec.allowedTools ?? [],
      initialMessages: options?.initialMessages,
      attachments: options?.attachments,
    });
  }

  private async runAgent(
    spec: AgentSpec,
    input: string,
    context: {
      parentId?: string;
      depth: number;
      parentAllowedTools: string[];
      initialMessages?: ChatMessage[];
      attachments?: ChatAttachment[];
    },
  ): Promise<ChatMessage[]> {
    const agentId = `agent-${++this.counter}`;
    const allowedTools = (spec.allowedTools ?? []).filter((name) => context.parentAllowedTools.includes(name));
    const tools = scopeToolRegistry(this.sharedTools, allowedTools);

    const canDelegate = context.depth < this.maxDepth;
    const runner = new AgentRunner({
      provider: this.provider,
      // `ScopedToolRegistry` doesn't expose `register`, so when delegation is available we layer a
      // fresh `ToolRegistry` that forwards everything else to the scoped view and adds `delegate_task`.
      tools: canDelegate ? this.withDelegateTool(tools, allowedTools, agentId, context.depth) : tools,
      systemPrompt: spec.systemPrompt,
      maxSteps: spec.maxSteps,
      initialMessages: context.initialMessages,
      onEvent: (event) =>
        this.onEvent?.({ ...event, agentId, agentName: spec.name, parentId: context.parentId, depth: context.depth }),
    });

    return runner.run(input, context.attachments);
  }

  private withDelegateTool(scoped: ReturnType<typeof scopeToolRegistry>, allowedTools: string[], parentId: string, depth: number) {
    const registry = new ToolRegistry();
    for (const tool of scoped.list()) registry.register(tool);
    registry.register(
      defineTool({
        name: "delegate_task",
        description:
          "Delegate one or more sub-tasks to fresh sub-agents and get back their final answers. " +
          "Use this to fan work out to specialized agents (e.g. a researcher and a critic) that run concurrently.",
        parameters: DELEGATE_TASK_PARAMS,
        execute: async ({ tasks }): Promise<{ results: DelegateTaskResult[] }> => {
          const results = await Promise.all(
            tasks.map(async (request): Promise<DelegateTaskResult> => {
              try {
                const turn = await this.runAgent(
                  { name: request.name, systemPrompt: request.systemPrompt, allowedTools: request.allowedTools },
                  request.task,
                  { parentId, depth: depth + 1, parentAllowedTools: allowedTools },
                );
                const finalMessage = [...turn].reverse().find((message) => message.role === "assistant");
                return { name: request.name, result: finalMessage?.content ?? "" };
              } catch (error) {
                return { name: request.name, result: "", error: error instanceof Error ? error.message : String(error) };
              }
            }),
          );
          return { results };
        },
      }),
    );
    return registry;
  }
}
