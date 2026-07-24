import { generateText, streamText, tool as aiTool, type CoreMessage, type LanguageModel } from "ai";
import { z } from "zod";
import { extractAttachmentText } from "./attachment-text.js";
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

/**
 * A "file" content part is only reliably accepted by providers as application/pdf — Anthropic's
 * API rejects any other document media type outright (the literal error a user sees is something
 * like "must be a valid PDF"). Every other non-image attachment (Word, Excel, PowerPoint,
 * Markdown, plain text, ...) gets its text extracted and inlined instead of sent as an opaque blob.
 */
async function attachmentToContentPart(
  attachment: ChatAttachment,
): Promise<{ type: "image"; image: string; mimeType: string } | { type: "file"; data: string; mimeType: string; filename: string } | { type: "text"; text: string }> {
  if (attachment.kind === "image") {
    return { type: "image", image: attachment.data, mimeType: attachment.mimeType };
  }
  if (attachment.mimeType === "application/pdf") {
    return { type: "file", data: attachment.data, mimeType: attachment.mimeType, filename: attachment.name };
  }

  try {
    const extracted = await extractAttachmentText(attachment);
    if (extracted !== null) {
      return { type: "text", text: `--- ${attachment.name} (${attachment.mimeType}) ---\n${extracted}` };
    }
  } catch {
    // Fall through to the degrade note below — a corrupt/unreadable file shouldn't fail the whole request.
  }
  return { type: "text", text: `[Could not read "${attachment.name}" (${attachment.mimeType}) — unsupported or unreadable file type]` };
}

/**
 * Providers with no multimodal API can't receive image/file content parts, but text extraction
 * needs no multimodal capability at all — a Word/Markdown/Excel doc extracted to plain text is
 * just more text in the prompt. So extraction is attempted for every non-image attachment before
 * falling back to a "not sent" note; only images (and files extraction can't read) actually degrade.
 */
async function toIncapableProviderContent(providerId: string, message: ChatMessage): Promise<CoreMessage["content"]> {
  const textBlocks: string[] = [];
  const undelivered: ChatAttachment[] = [];

  for (const attachment of message.attachments ?? []) {
    if (attachment.kind !== "image") {
      try {
        const extracted = await extractAttachmentText(attachment);
        if (extracted !== null) {
          textBlocks.push(`--- ${attachment.name} (${attachment.mimeType}) ---\n${extracted}`);
          continue;
        }
      } catch {
        // Fall through to undelivered below — a corrupt/unreadable file shouldn't fail the whole request.
      }
    }
    undelivered.push(attachment);
  }

  const sections = [message.content, ...textBlocks];
  if (undelivered.length) {
    sections.push(attachmentsToText(providerId, undelivered));
  }
  return sections.filter(Boolean).join("\n\n");
}

/** Exported for unit testing the attachment-mapping/degradation logic without spinning up a live model. */
export async function toUserContent(providerId: string, message: ChatMessage): Promise<CoreMessage["content"]> {
  if (!message.attachments?.length) return message.content;

  if (ATTACHMENT_INCAPABLE_PROVIDERS.has(providerId)) {
    return toIncapableProviderContent(providerId, message);
  }

  const attachmentParts = await Promise.all(message.attachments.map(attachmentToContentPart));

  return [...(message.content ? [{ type: "text" as const, text: message.content }] : []), ...attachmentParts];
}

async function toCoreMessages(providerId: string, messages: ChatMessage[]): Promise<CoreMessage[]> {
  return Promise.all(
    messages.map(async (message): Promise<CoreMessage> => {
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
        return { role: "user", content: await toUserContent(providerId, message) } as CoreMessage;
      }

      return { role: message.role, content: message.content } as CoreMessage;
    }),
  );
}

/**
 * Some smaller/local models (observed with Llama 3.1 8B via Ollama's OpenAI-compatible tool
 * calling) serialize array/object-typed tool arguments as a JSON *string* instead of nested JSON,
 * e.g. `{"tasks": "[{\"name\":\"x\"}]"}` instead of `{"tasks": [{"name":"x"}]}`. That fails zod
 * validation before the call ever reaches our tool registry. Since this project's whole premise is
 * working with any configured LLM, repair those fields instead of rejecting the call outright.
 */
export function repairStringifiedToolArgs(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;

  const repaired: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  for (const [key, value] of Object.entries(repaired)) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) continue;
    try {
      repaired[key] = JSON.parse(trimmed);
    } catch {
      // Not actually JSON — leave it as-is and let normal schema validation report the mismatch.
    }
  }
  return repaired;
}

function toAiTools(tools?: ToolDefinition[]) {
  if (!tools || tools.length === 0) return undefined;

  return Object.fromEntries(
    tools.map((definition) => [
      definition.name,
      aiTool({
        description: definition.description,
        // `z.preprocess` only affects runtime parsing; zod-to-json-schema (used by the AI SDK to
        // advertise the tool's shape to the model) unwraps preprocess and emits the inner schema,
        // so the model still sees the real, un-stringified parameter types.
        parameters: z.preprocess(repairStringifiedToolArgs, definition.parameters),
        // Deliberately no `execute` here: if the AI SDK sees one, `generateText`/`streamText` runs
        // the tool themselves as part of assembling the response — independent of and in addition
        // to `AgentRunner.runToolCalls`, which would then run it again via `ToolRegistry.execute`.
        // That double-execution is silent and serious for anything with side effects (writes a
        // file twice, runs a shell command twice, spawns a sub-agent twice). Omitting `execute`
        // makes the AI SDK report the call as pending and stop there, so `AgentRunner` — which
        // already implements its own send/respond/execute-tools/repeat loop — is the only place
        // a tool call actually runs.
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
      messages: await toCoreMessages(this.id, request.messages),
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
      messages: await toCoreMessages(this.id, request.messages),
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
