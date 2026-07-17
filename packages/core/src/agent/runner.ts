import type { ChatMessage, ChatProvider, ToolCall } from "../providers/types.js";
import { ToolRegistry } from "../tools/registry.js";

export interface AgentRunnerOptions {
  provider: ChatProvider;
  tools?: ToolRegistry;
  systemPrompt?: string;
  /** Caps the send -> respond -> execute-tools -> repeat loop so a misbehaving model can't run forever. */
  maxSteps?: number;
  onEvent?: (event: AgentEvent) => void;
}

export type AgentEvent =
  | { type: "assistant-message"; message: ChatMessage }
  | { type: "tool-call"; toolCall: ToolCall }
  | { type: "tool-result"; toolCall: ToolCall; result: unknown }
  | { type: "error"; error: Error };

/** Provider-agnostic agent loop: send a user message, let the model respond, execute any tool calls, repeat. */
export class AgentRunner {
  private readonly provider: ChatProvider;
  private readonly tools: ToolRegistry;
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
  }

  async run(userInput: string): Promise<ChatMessage[]> {
    this.messages.push({ role: "user", content: userInput });

    const turnMessages: ChatMessage[] = [];

    for (let step = 0; step < this.maxSteps; step++) {
      const response = await this.provider.chat({
        messages: this.messages,
        tools: this.tools.list(),
      });

      this.messages.push(response.message);
      turnMessages.push(response.message);
      this.onEvent?.({ type: "assistant-message", message: response.message });

      if (!response.message.toolCalls?.length) {
        return turnMessages;
      }

      for (const toolCall of response.message.toolCalls) {
        this.onEvent?.({ type: "tool-call", toolCall });

        let content: string;
        try {
          const result = await this.tools.execute(toolCall);
          this.onEvent?.({ type: "tool-result", toolCall, result });
          content = typeof result === "string" ? result : JSON.stringify(result);
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
        };
        this.messages.push(toolMessage);
        turnMessages.push(toolMessage);
      }
    }

    return turnMessages;
  }

  getHistory(): ChatMessage[] {
    return [...this.messages];
  }
}
