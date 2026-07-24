import type { ChatAttachment, ChatMessage, ChatProvider, ToolCall } from "../providers/types.js";
import { extractFileArtifact, type FileArtifact } from "../tools/artifacts.js";
import { ToolRegistry, type ToolSource } from "../tools/registry.js";

export interface AgentRunnerOptions {
  provider: ChatProvider;
  tools?: ToolSource;
  systemPrompt?: string;
  /** Prior conversation turns to seed the runner with, e.g. when resuming a persisted session. */
  initialMessages?: ChatMessage[];
  /** Caps the send -> respond -> execute-tools -> repeat loop so a misbehaving model can't run forever. */
  maxSteps?: number;
  onEvent?: (event: AgentEvent) => void;
}

export type AgentEvent =
  | { type: "assistant-message"; message: ChatMessage }
  | { type: "text-delta"; delta: string }
  | { type: "tool-call"; toolCall: ToolCall }
  | { type: "tool-result"; toolCall: ToolCall; result: unknown }
  | { type: "error"; error: Error };

/** Drops the inline `contentBase64` file bytes from a tool result so they don't reach the model context. */
function stripInlineBytes(result: unknown): unknown {
  if (!result || typeof result !== "object" || !("contentBase64" in result)) return result;
  const { contentBase64: _bytes, ...rest } = result as Record<string, unknown>;
  return rest;
}

/** Provider-agnostic agent loop: send a user message, let the model respond, execute any tool calls, repeat. */
export class AgentRunner {
  private readonly provider: ChatProvider;
  private readonly tools: ToolSource;
  private readonly maxSteps: number;
  private readonly onEvent?: (event: AgentEvent) => void;
  private readonly messages: ChatMessage[] = [];

  constructor(options: AgentRunnerOptions) {
    this.provider = options.provider;
    this.tools = options.tools ?? new ToolRegistry();
    this.maxSteps = options.maxSteps ?? 8;
    this.onEvent = options.onEvent;

    if (options.systemPrompt) {
      this.messages.push({ role: "system", content: options.systemPrompt });
    }
    if (options.initialMessages?.length) {
      this.messages.push(...options.initialMessages);
    }
  }

  async run(userInput: string, attachments?: ChatAttachment[]): Promise<ChatMessage[]> {
    this.messages.push({ role: "user", content: userInput, ...(attachments?.length ? { attachments } : {}) });

    const turnMessages: ChatMessage[] = [];

    for (let step = 0; step < this.maxSteps; step++) {
      const response = await this.provider.chat({
        messages: this.messages,
        tools: this.tools.list(),
      });

      const toolCalls = this.recordAssistantMessage(response.message, turnMessages);
      if (!toolCalls.length) {
        return turnMessages;
      }

      turnMessages.push(...(await this.runToolCalls(toolCalls)));
    }

    return turnMessages;
  }

  /** Same send -> respond -> execute-tools -> repeat loop as `run`, but emits `text-delta` events as tokens arrive. */
  async runStream(userInput: string, attachments?: ChatAttachment[]): Promise<ChatMessage[]> {
    this.messages.push({ role: "user", content: userInput, ...(attachments?.length ? { attachments } : {}) });

    const turnMessages: ChatMessage[] = [];

    for (let step = 0; step < this.maxSteps; step++) {
      let content = "";
      const toolCalls: ToolCall[] = [];
      let streamError: Error | undefined;

      for await (const event of this.provider.stream({ messages: this.messages, tools: this.tools.list() })) {
        switch (event.type) {
          case "text-delta":
            content += event.delta;
            this.onEvent?.({ type: "text-delta", delta: event.delta });
            break;
          case "tool-call":
            toolCalls.push(event.toolCall);
            break;
          case "error":
            this.onEvent?.({ type: "error", error: event.error });
            streamError = event.error;
            break;
          default:
            break;
        }
      }

      // A provider that reports failure as a stream event (rather than a rejected promise) must
      // still fail the turn — otherwise it silently resolves as an empty assistant message and the
      // caller has no signal to show the user anything went wrong.
      if (streamError) {
        throw streamError;
      }

      const message: ChatMessage = { role: "assistant", content, ...(toolCalls.length ? { toolCalls } : {}) };
      this.recordAssistantMessage(message, turnMessages);
      if (!toolCalls.length) {
        return turnMessages;
      }

      turnMessages.push(...(await this.runToolCalls(toolCalls)));
    }

    return turnMessages;
  }

  private recordAssistantMessage(message: ChatMessage, turnMessages: ChatMessage[]): ToolCall[] {
    this.messages.push(message);
    turnMessages.push(message);
    this.onEvent?.({ type: "assistant-message", message });
    return message.toolCalls ?? [];
  }

  private async runToolCalls(toolCalls: ToolCall[]): Promise<ChatMessage[]> {
    const toolMessages: ChatMessage[] = [];

    for (const toolCall of toolCalls) {
      this.onEvent?.({ type: "tool-call", toolCall });

      let content: string;
      let artifact: FileArtifact | undefined;
      try {
        const result = await this.tools.execute(toolCall);
        this.onEvent?.({ type: "tool-result", toolCall, result });
        artifact = extractFileArtifact(result) ?? undefined;
        // Keep the (potentially large) inline file bytes out of the model-facing content; the model
        // only needs the path/size/type, while the download surface reads the bytes off `artifact`.
        const modelFacing = artifact ? stripInlineBytes(result) : result;
        content = typeof modelFacing === "string" ? modelFacing : JSON.stringify(modelFacing);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.onEvent?.({ type: "error", error: err });
        content = JSON.stringify({ error: err.message });
      }

      const toolMessage: ChatMessage = {
        role: "tool",
        name: toolCall.name,
        toolCallId: toolCall.id,
        content,
        ...(artifact ? { artifact } : {}),
      };
      this.messages.push(toolMessage);
      toolMessages.push(toolMessage);
    }

    return toolMessages;
  }

  getHistory(): ChatMessage[] {
    return [...this.messages];
  }
}
