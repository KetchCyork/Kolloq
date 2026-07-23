import type { AgentSpec, ChatAttachment, ChatMessage, ChatProvider, OrchestratedAgentEvent } from "@newvector/core";
import { AgentEvent, AgentOrchestrator, AgentRunner, createProvider, defineTool, ToolRegistry } from "@newvector/core";
import { z } from "zod";
import type { AgentSession, ProviderConfig, StoredMessage } from "./types";

/** Synthetic `agentId` for a single-agent session's one runner, so the live-turn view can share one event shape with multi-agent sessions. */
const ROOT_AGENT_ID = "root";

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

/** Number of tools available to a session's agent runner, for telemetry's `message_sent.toolCount`. */
export function getToolCount(): number {
  return buildTools().list().length;
}

/** A turn message tagged with which agent produced it — untagged (depth 0, no ids) for a plain single-agent turn. */
export interface TurnMessage extends ChatMessage {
  agentId?: string;
  agentName?: string;
  parentId?: string;
  depth?: number;
}

/**
 * Rebuilds the persisted transcript for every sub-agent a multi-agent turn spawned, from the
 * `OrchestratedAgentEvent`s it emitted. The root agent's own messages come from `orchestrator.run`'s
 * return value instead (see `runMultiAgentTurn`) since that's the complete, authoritative list —
 * this only covers depth > 0, mirroring how `AgentRunner` builds its own `turnMessages` array from
 * assistant-message/tool-result events.
 */
export function subAgentEventsToMessages(events: OrchestratedAgentEvent[]): TurnMessage[] {
  const messages: TurnMessage[] = [];
  for (const event of events) {
    if (event.depth === 0) continue;
    const tags = { agentId: event.agentId, agentName: event.agentName, parentId: event.parentId, depth: event.depth };
    if (event.type === "assistant-message") {
      messages.push({ ...event.message, ...tags });
    } else if (event.type === "tool-result") {
      const content = typeof event.result === "string" ? event.result : JSON.stringify(event.result);
      messages.push({ role: "tool", name: event.toolCall.name, toolCallId: event.toolCall.id, content, ...tags });
    }
  }
  return messages;
}

async function runMultiAgentTurn(
  session: AgentSession,
  provider: ChatProvider,
  priorMessages: StoredMessage[],
  userInput: string,
  attachments: ChatAttachment[] | undefined,
  onEvent: (event: OrchestratedAgentEvent) => void,
): Promise<TurnMessage[]> {
  const sharedTools = buildTools();
  const childEvents: OrchestratedAgentEvent[] = [];

  const orchestrator = new AgentOrchestrator({
    provider,
    sharedTools,
    maxDepth: session.multiAgent?.maxDepth,
    onEvent: (event) => {
      onEvent(event);
      if (event.depth > 0) childEvents.push(event);
    },
  });

  const rootSpec: AgentSpec = {
    name: session.identity.name,
    systemPrompt: session.systemPrompt || undefined,
    // The lead agent starts with every built-in tool; `delegate_task` can only narrow this set for
    // sub-agents, never grant them more (see AgentOrchestrator).
    allowedTools: sharedTools.list().map((tool) => tool.name),
  };

  const rootTurn = await orchestrator.run(rootSpec, userInput, {
    initialMessages: priorMessages.map(toChatMessage),
    attachments,
  });

  // Sub-agent activity happens while the root's `delegate_task` call is in flight, i.e. before the
  // root's own delegate_task tool-result message — so it reads correctly placed ahead of the root's
  // messages. (With more than one delegation round in a single turn, ordering between rounds isn't
  // preserved; a fully chronological merge wasn't worth the complexity for the common one-round case.)
  return [...subAgentEventsToMessages(childEvents), ...rootTurn];
}

/**
 * Runs one conversational turn for a session. Seeded with `priorMessages` so the browser app (which
 * persists history to IndexedDB, not in-memory runner state) can resume a session across renders,
 * reloads, and provider switches. Sessions with `multiAgent.enabled` run through the
 * `AgentOrchestrator` instead of a plain `AgentRunner`, so the top-level agent can delegate sub-tasks
 * via `delegate_task`; every other session keeps running exactly as before.
 */
export function runSessionTurn(
  session: AgentSession,
  priorMessages: StoredMessage[],
  userInput: string,
  attachments: ChatAttachment[] | undefined,
  onEvent: (event: OrchestratedAgentEvent) => void,
): Promise<TurnMessage[]> {
  const provider = createProvider({
    provider: session.providerConfig.provider,
    model: session.providerConfig.model,
    apiKey: session.providerConfig.apiKey,
    baseURL: session.providerConfig.baseURL,
    authType: session.providerConfig.authType,
    accessToken: session.providerConfig.accessToken,
  });

  if (session.multiAgent?.enabled) {
    return runMultiAgentTurn(session, provider, priorMessages, userInput, attachments, onEvent);
  }

  const runner = new AgentRunner({
    provider,
    tools: buildTools(),
    systemPrompt: session.systemPrompt || undefined,
    initialMessages: priorMessages.map(toChatMessage),
    onEvent: (event) => onEvent({ ...event, agentId: ROOT_AGENT_ID, agentName: session.identity.name, depth: 0 }),
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
