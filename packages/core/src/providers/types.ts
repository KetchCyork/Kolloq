import type { z } from "zod";
import type { FileArtifact } from "../tools/artifacts.js";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export type ChatAttachmentKind = "image" | "file";

export interface ChatAttachment {
  /** Stable id so persistence/UI layers can key thumbnails and dedupe. */
  id: string;
  kind: ChatAttachmentKind;
  name: string;
  mimeType: string;
  /** Base64-encoded bytes, no "data:" URL prefix. */
  data: string;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Set on user messages that include one or more image/file uploads. */
  attachments?: ChatAttachment[];
  /** Set on assistant messages that invoke one or more tools. */
  toolCalls?: ToolCall[];
  /** Set on tool-result messages: which call this message answers. */
  toolCallId?: string;
  /** Set on tool-result messages: the tool that produced the result. */
  name?: string;
  /**
   * Set on tool-result messages when the tool produced a downloadable file. Carries the bytes for the
   * download surface (browser/desktop) but is deliberately kept out of `content` so the file bytes
   * don't bloat what's re-sent to the model on every subsequent turn.
   */
  artifact?: FileArtifact;
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
