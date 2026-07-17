import type { z } from "zod";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Set on assistant messages that invoke one or more tools. */
  toolCalls?: ToolCall[];
  /** Set on tool-result messages: which call this message answers. */
  toolCallId?: string;
  /** Set on tool-result messages: the tool that produced the result. */
  name?: string;
}

export interface ToolDefinition<Args = any, Result = any> {
  name: string;
  description: string;
  parameters: z.ZodType<Args>;
  execute: (args: Args) => Promise<Result> | Result;
}

export type StreamEvent =
  | { type: "text-delta"; delta: string }
  | { type: "tool-call"; toolCall: ToolCall }
  | { type: "finish"; reason: string }
  | { type: "error"; error: Error };

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResponse {
  message: ChatMessage;
  finishReason: string;
}

/** Provider-agnostic chat interface. Every backend (OpenAI, Anthropic, Gemini, Ollama, ...) implements this. */
export interface ChatProvider {
  readonly id: string;
  readonly model: string;
  chat(request: ChatRequest): Promise<ChatResponse>;
  stream(request: ChatRequest): AsyncIterable<StreamEvent>;
}
