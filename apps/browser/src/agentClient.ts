import type { AgentEvent, ChatAttachment, ChatMessage } from "@newvector/core";
import { AgentRunner, createProvider, defineTool, ToolRegistry } from "@newvector/core";
import { z } from "zod";
import type { AgentSession, StoredMessage } from "./types";

function buildTools(): ToolRegistry {
  const tools = new ToolRegistry();
  tools.register(
    defineTool({
      name: "get_time",
      description: "Get the current local time in ISO 8601 format.",
      parameters: z.object({}),
      execute: () => ({ now: new Date().toISOString() }),
    }),
  );
  return tools;
}

function toChatMessage({ id: _id, createdAt: _createdAt, ...message }: StoredMessage): ChatMessage {
  return message;
}

/**
 * Runs one conversational turn for a session. A fresh `AgentRunner` is built per call and seeded
 * with `priorMessages` so the browser app (which persists history to IndexedDB, not in-memory
 * runner state) can resume a session across renders, reloads, and provider switches.
 */
export function runSessionTurn(
  session: AgentSession,
  priorMessages: StoredMessage[],
  userInput: string,
  attachments: ChatAttachment[] | undefined,
  onEvent: (event: AgentEvent) => void,
): Promise<ChatMessage[]> {
  const provider = createProvider({
    provider: session.providerConfig.provider,
    model: session.providerConfig.model,
    apiKey: session.providerConfig.apiKey,
    baseURL: session.providerConfig.baseURL,
  });

  const runner = new AgentRunner({
    provider,
    tools: buildTools(),
    systemPrompt: session.systemPrompt || undefined,
    initialMessages: priorMessages.map(toChatMessage),
    onEvent,
  });

  return runner.runStream(userInput, attachments);
}
