import type { AgentEvent, ChatAttachment, ChatMessage } from "@newvector/core";
import { AgentRunner, createOfficeProxyTools, createProvider, defineTool, ToolRegistry } from "@newvector/core";
import { z } from "zod";
import { createTauriNodeExec, nodeContextAvailable } from "./nodeContext";
import type { AgentSession, ProviderConfig, StoredMessage } from "./types";

/**
 * Builds the tools a session's agent can call. `get_time` is always available. Under the desktop
 * (Tauri) shell there's a Node execution context (a sidecar), so the Node-only Office generators are
 * registered too — as proxies that run out-of-process, scoped to this session's sandbox. In a plain
 * browser build there's no Node runtime to reach, so those tools are simply absent.
 */
function buildTools(sessionId?: string): ToolRegistry {
  const tools = new ToolRegistry();
  tools.register(
    defineTool({
      name: "get_time",
      description: "Get the current local time in ISO 8601 format.",
      parameters: z.object({}),
      execute: () => ({ now: new Date().toISOString() }),
    }),
  );
  if (sessionId && nodeContextAvailable()) {
    for (const tool of createOfficeProxyTools("the session sandbox", createTauriNodeExec(sessionId))) {
      tools.register(tool);
    }
  }
  return tools;
}

function toChatMessage({ id: _id, createdAt: _createdAt, ...message }: StoredMessage): ChatMessage {
  return message;
}

/** Number of tools available to a session's agent runner, for telemetry's `message_sent.toolCount`. */
export function getToolCount(sessionId?: string): number {
  return buildTools(sessionId).list().length;
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
    authType: session.providerConfig.authType,
    accessToken: session.providerConfig.accessToken,
  });

  const runner = new AgentRunner({
    provider,
    tools: buildTools(session.id),
    systemPrompt: session.systemPrompt || undefined,
    initialMessages: priorMessages.map(toChatMessage),
    onEvent,
  });

  return runner.runStream(userInput, attachments);
}

/**
 * Runs one turn for a project chat message, answered by whichever roster member was routed the
 * message. Unlike `runSessionTurn` this takes provider config directly rather than a whole
 * `AgentSession` (a project turn is answered by one of several roster members, not a single fixed
 * session) and skips the tool registry — project chat is plain conversation for v1, no tool use.
 */
export function runProjectTurn(
  providerConfig: ProviderConfig,
  systemPrompt: string,
  priorMessages: ChatMessage[],
  userInput: string,
  attachments: ChatAttachment[] | undefined,
  onEvent: (event: AgentEvent) => void,
): Promise<ChatMessage[]> {
  const provider = createProvider({
    provider: providerConfig.provider,
    model: providerConfig.model,
    apiKey: providerConfig.apiKey,
    baseURL: providerConfig.baseURL,
    authType: providerConfig.authType,
    accessToken: providerConfig.accessToken,
  });

  const runner = new AgentRunner({
    provider,
    systemPrompt: systemPrompt || undefined,
    initialMessages: priorMessages,
    onEvent,
  });

  return runner.runStream(userInput, attachments);
}
