import { generateText, streamText, tool as aiTool, type CoreMessage, type LanguageModel } from "ai";
import type { ChatAttachment, ChatMessage, ChatProvider, ChatRequest, ChatResponse, StreamEvent, ToolDefinition } from "./types.js";

/**
 * Providers/models known to be text-only. Attachments sent to these are dropped
 * with a note appended to the message text rather than failing the request —
 * e.g. local Ollama models are usually text-only unless explicitly a vision model.
 */
const ATTACHMENT_INCAPABLE_PROVIDERS = new Set(["ollama"]);

function attachmentsToText(providerId: string, attachments: ChatAttachment[]): string {
  const kinds = attachments.map((attachment) => `"${attachment.name}"`).join(", ");
  return `[${attachments.length} attachment(s) not sent — the "${providerId}" provider does not support image/file attachments: ${kinds}]`;
}

/** Exported for unit testing the attachment-mapping/degradation logic without spinning up a live model. */
export function toUserContent(providerId: string, message: ChatMessage): CoreMessage["content"] {
  if (!message.attachments?.length) return message.content;

  if (ATTACHMENT_INCAPABLE_PROVIDERS.has(providerId)) {
    const note = attachmentsToText(providerId, message.attachments);
    return message.content ? `${message.content}\n\n${note}` : note;
  }

  return [
    ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
    ...message.attachments.map((attachment) =>
      attachment.kind === "image"
        ? { type: "image" as const, image: attachment.data, mimeType: attachment.mimeType }
        : { type: "file" as const, data: attachment.data, mimeType: attachment.mimeType, filename: attachment.name },
    ),
  ];
}

function toCoreMessages(providerId: string, messages: ChatMessage[]): CoreMessage[] {
  return messages.map((message): CoreMessage => {
    if (message.role === "tool") {
      return {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: message.toolCallId ?? "",
            toolName: message.name ?? "",
            result: message.content,
          },
        ],
      };
    }

    if (message.role === "assistant" && message.toolCalls?.length) {
      return {
        role: "assistant",
        content: [
          ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
          ...message.toolCalls.map((toolCall) => ({
            type: "tool-call" as const,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            args: toolCall.arguments,
          })),
        ],
      };
    }

    if (message.role === "user") {
      return { role: "user", content: toUserContent(providerId, message) } as CoreMessage;
    }

    return { role: message.role, content: message.content } as CoreMessage;
  });
}

function toAiTools(tools?: ToolDefinition[]) {
  if (!tools || tools.length === 0) return undefined;

  return Object.fromEntries(
    tools.map((definition) => [
      definition.name,
      aiTool({
        description: definition.description,
        parameters: definition.parameters,
        execute: async (args: unknown) => definition.execute(args as never),
      }),
    ]),
  );
}

/**
 * Wraps any Vercel AI SDK `LanguageModel` as a `ChatProvider`. Every first-party
 * provider adapter (OpenAI, Anthropic, Google, Ollama) is a thin factory that
 * constructs a `LanguageModel` and hands it to this class, so provider-specific
 * quirks stay isolated to the AI SDK package for that vendor.
 */
export class AiSdkChatProvider implements ChatProvider {
  constructor(
    public readonly id: string,
    public readonly model: string,
    private readonly languageModel: LanguageModel,
  ) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const result = await generateText({
      model: this.languageModel,
      messages: toCoreMessages(this.id, request.messages),
      tools: toAiTools(request.tools),
      temperature: request.temperature,
      maxTokens: request.maxTokens,
    });

    const toolCalls = result.toolCalls?.map((toolCall) => ({
      id: toolCall.toolCallId,
      name: toolCall.toolName,
      arguments: toolCall.args,
    }));

    return {
      message: {
        role: "assistant",
        content: result.text,
        ...(toolCalls?.length ? { toolCalls } : {}),
      },
      finishReason: result.finishReason,
    };
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamEvent> {
    const result = streamText({
      model: this.languageModel,
      messages: toCoreMessages(this.id, request.messages),
      tools: toAiTools(request.tools),
      temperature: request.temperature,
      maxTokens: request.maxTokens,
    });

    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-delta":
          yield { type: "text-delta", delta: part.textDelta };
          break;
        case "tool-call":
          yield {
            type: "tool-call",
            toolCall: { id: part.toolCallId, name: part.toolName, arguments: part.args },
          };
          break;
        case "finish":
          yield { type: "finish", reason: part.finishReason };
          break;
        case "error":
          yield { type: "error", error: part.error instanceof Error ? part.error : new Error(String(part.error)) };
          break;
        default:
          break;
      }
    }
  }
}
