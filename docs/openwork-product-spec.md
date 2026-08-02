# Kolloq — Product Specification

**Version:** 1.0 (Draft for review)
**Date:** July 19, 2026
**Author:** Prepared for Chris York
**Status:** Pre-design product spec. No engineering architecture, API schemas, or data models included by design.

---

## 1. Product Vision

Kolloq is an AI workspace — delivered in the browser and as desktop apps for macOS, Windows, and Linux — modeled on Claude Chat and Claude Cowork, with one defining difference: it is **model-agnostic and multi-agent**. Users connect any LLM provider (Anthropic, OpenAI, Google, xAI, Mistral, DeepSeek, local models via Ollama, and others) using an API key. Each connection powers one or more user-defined **Agents** — named personas with a model, system prompt, skills, and tool access.

Agents can be used three ways:

1. **Chat** — pick any agent for a one-on-one conversation (parity with Claude Chat).
2. **Projects** — assign multiple agents to a shared workspace with files, tasks, and project knowledge (parity with Claude Cowork), so different agents handle different work in the same project.
3. **Advisory Council** — a new capability: pose a challenge to up to five agents, who debate in moderated rounds until they align on a recommended path forward.

The core bet: no single model is best at everything, and the most valuable answers come from structured disagreement between strong models — not from a single oracle.

---

## 2. Target Users and Primary Use Cases

**Primary persona — the "power decision-maker":** consultants, founders, product leaders, analysts, and technically comfortable professionals who already pay for two or more AI subscriptions and want them working together.

Representative use cases:

- Draft a strategy memo in a Project where a Claude agent writes, a GPT agent critiques, and a Gemini agent fact-checks.
- Run an Advisory Council on "Should we build or buy our billing system?" and receive a consensus recommendation with recorded dissent.
- Everyday chat with a favorite agent, with files, artifacts, and integrations — replacing the standalone chat apps.

---

## 3. Platforms & Application Structure

### 3.1 Platforms

Kolloq ships on four platforms to maximize reach: a **browser app** (Chrome, Edge, Safari, Firefox) and **native desktop apps for macOS, Windows, and Linux**. All platforms share one account, one feature set, and one UI, with platform-appropriate differences:

- **Desktop (macOS / Windows / Linux):** the full experience. Unrestricted working-folder access for Projects, credentials in the OS keychain (Keychain / Credential Manager / Secret Service), background scheduled tasks, auto-update.
- **Browser:** the entry point and trial surface — nothing to install, works from a link, ideal for Free-tier acquisition and Enterprise SSO rollouts. Chat, Agents, Advisory Council, and Settings are at full parity. **Honest constraint:** project working-folder access in the browser depends on the File System Access API, which is well-supported in Chrome and Edge but limited in Safari and Firefox; there, Projects fall back to uploaded knowledge files and downloadable outputs, with a prompt to get the desktop app for full folder access. Browser-entered API keys are held in encrypted browser storage scoped to the signed-in account (or the Enterprise tenant vault), not an OS keychain.
- Scheduled tasks require either the desktop app running in the background or (v2) server-side execution; the browser app alone cannot fire them reliably and says so in the UI.

The desktop apps are built from the same codebase as the web app (wrapper approach, e.g. Electron/Tauri-class) so features land on all four platforms simultaneously; Linux is a first-class target, not a port.

### 3.2 Application structure

On first launch the user signs in to an **Kolloq account** (see §8) before reaching the workspace; the app then opens to a left sidebar navigation with five top-level areas:

| Area | Purpose |
|---|---|
| **Chat** | Conversations with a single agent. Conversation history list, search, pinning. |
| **Projects** | Claude Cowork-style workspaces: connected folder, files, tasks, project knowledge, multiple assigned agents. |
| **Advisory Council** | Create and run multi-agent debates; browse past council sessions and their decision briefs. |
| **Agents** | Create, edit, duplicate, and archive agents. |
| **Settings** | Account & Plan, Connections, Skills, Plugins, Integrations, General, Usage & Billing. |

Global elements: model/agent switcher in the chat composer, universal search (Cmd/Ctrl-K), a status tray showing connection health for each provider, and a plan badge in the sidebar footer (Free / Pro / Max / Enterprise) that doubles as the upgrade entry point.

**Visual design direction:** dark theme by default — near-black blue-gray surfaces with the **brand teal** as the interactive accent (buttons, badges, meters, selection states). **Brand:** the Kolloq mark is a teal-to-green gradient ring enclosing a "w", with a bold white sans-serif wordmark on dark surfaces and a dark navy wordmark on light surfaces, per the brand sheet. **Appearance setting:** Dark (default), Light (light surfaces, navy text, darker teal accent for contrast), or Match system (follows the OS and switches live when the OS changes). Enterprise tenants can override logo and accent — see §8.4.

---

## 4. Feature Set — Parity with Claude Chat / Claude Cowork

These behaviors replicate the reference apps and are table stakes:

**Chat.** Streaming responses; markdown rendering; code blocks with copy; file and image attachments; artifacts (rendered HTML/React/SVG/documents in a side panel); response regeneration; edit-and-resend; conversation renaming, pinning, deletion; export to Markdown/PDF. Each conversation is bound to one agent but the user can switch agents mid-conversation (a divider notes the switch, and full history is passed to the new agent).

**Projects (Claude Cowork parity).** Every project has a **working folder** — a local folder the project's agents can read and write. Folder selection is explicit and visible: creating a project prompts for a folder via the OS folder picker (or "start without a folder" for knowledge-only projects); the connected path is always displayed at the top of the project workspace with **Change** and **Disconnect** actions; changing the folder warns that agents lose access to the old path immediately. Access is scoped to the selected folder and its subfolders only — agents cannot touch anything outside it. Also included: project instructions (persistent system-level guidance); project knowledge files; a task list widget with statuses; scheduled tasks; artifacts persisted per project. **Kolloq extension:** a project has an *agent roster* — any number of assigned agents. The composer in a project shows an agent picker; tasks can be assigned to specific agents; any agent in the roster shares the project's context (instructions, knowledge, files).

**Skills.** Installable instruction packages (SKILL.md-style) that shape how an agent performs a category of task (e.g., "Board memo format," "Our brand voice"). Skills are installed globally in Settings and attached per-agent or per-project.

**Plugins.** Bundles of skills, connectors, and commands installable from a marketplace or from a local file/URL.

**Integrations (MCP connectors).** Connect external tools — Google Drive, Gmail, Slack, GitHub, Notion, calendars, databases — via MCP servers. Managed in Settings; enabled per-agent (an agent's tool access list) and per-project. Per-integration permission prompts on first use.

---

## 5. Connections and Agents (the differentiating layer)

### 5.1 Connections

*Terminology note: this section covers connecting **LLM providers** to Kolloq. The user's own **Kolloq account** sign-in and subscription tiers are separate — see §8.*

A **Connection** is authenticated access to an LLM provider, established with an **API key** (or endpoint + key for OpenAI-compatible/local servers). Kolloq validates the key with a test call, then lists the models the key can access. Keys are stored in the OS keychain and never displayed again after entry (masked, with "Replace key" action). *(Board decision, 2026-07-22: subscription login — signing in with an existing consumer plan such as Claude Pro/Max or ChatGPT Plus — was considered and explicitly withdrawn; API keys are the only connection method.)*

Connection card shows: provider, status (Connected / Error / Rate limited), models available, monthly spend, and actions (Test, Replace credentials, Remove).

### 5.2 Agents

An **Agent** = Name + Avatar/color + Connection + Model + System prompt/persona + attached Skills + allowed Integrations + parameters (temperature, max output, reasoning effort where supported).

Behaviors:

- Creating an agent requires at least one working connection.
- Agents are reusable everywhere: Chat, Projects, and Council.
- Duplicating an agent copies everything but the name.
- If an agent's underlying connection breaks, the agent shows an error badge everywhere it appears and cannot be invoked until fixed.
- Deleting a connection warns which agents depend on it.
- Suggested starter templates on first run: "Generalist," "Skeptical Critic," "Researcher," "Writer," "Engineer."

---

## 6. Advisory Council

### 6.1 Concept

The user poses a **Challenge** — a decision or problem statement — to a council of **2 to 5 agents**. Agents debate in structured, moderated rounds until they converge on a recommended path forward, or until the round limit is reached. The output is a **Decision Brief**.

### 6.2 Setup flow

1. **Challenge.** Free-text statement plus optional context attachments (files, project knowledge, links). Optional "decision criteria" the council must weigh (e.g., cost, speed, risk).
2. **Council selection.** Pick 2–5 agents from the roster. The UI encourages model diversity (a hint appears if all seats use the same underlying model). Each seat can optionally be given a stance or role for the debate (e.g., "argue the contrarian view," "represent the finance perspective") without editing the agent itself.
3. **Moderator.** One agent (default: a built-in Moderator preset on the user's most capable connection) serves as moderator. The moderator does not argue; it runs the debate.
4. **Rules.** Max rounds (default 4, cap 8), consensus threshold (default: all members rate agreement ≥ 8/10 on the leading proposal), and per-session budget cap in dollars/tokens with a hard stop.

### 6.3 Debate protocol (moderated rounds)

- **Round 0 — Opening positions.** Each agent independently (without seeing the others) proposes a path forward with rationale.
- **Round N — Rebuttal and revision.** The moderator summarizes the state of debate, identifies the key points of disagreement, and asks each agent to respond to specific conflicts and revise its position. Agents see each other's latest positions from this round on.
- **Convergence check.** After each round, the moderator states the leading proposal and each agent scores its agreement 0–10 with a one-line justification. A visible **alignment meter** tracks the average.
- **Termination.**
  - *Consensus:* threshold met → moderator drafts the Decision Brief.
  - *Deadlock:* round limit reached without consensus → moderator produces a Decision Brief that presents the top options, the crux of disagreement, and each agent's final stance, and asks the user to decide.
  - *Budget stop:* budget cap reached → same as deadlock, flagged as budget-terminated.
- **User intervention.** At any time the user may pause, inject a message ("assume budget is $50k"), remove or add an agent (allowed only between rounds), or force a final vote.

### 6.4 Live session UI

Split view: left, a chronological debate transcript with color-coded agent messages and moderator interjections; right, a status panel with the alignment meter, round counter, current leading proposal, per-agent agreement scores, and running cost. Controls: Pause, Inject message, Force vote, End session.

### 6.5 Decision Brief

Structured artifact produced at termination: the challenge, the recommendation (or the options in a deadlock), rationale, key points of contention and how they were resolved, dissenting opinions (attributed by agent), assumptions and risks, and suggested next steps. Saved to the council session; exportable to Markdown/PDF; can be sent into a Project as knowledge.

### 6.6 Council non-goals (v1)

No parallel sub-debates, no agent-to-agent private channels, no tool use by agents during debate (positions argued from provided context only — tool-augmented debate is a v2 candidate), no more than 5 seats.

---

## 7. Settings — Detailed Behavior

- **Account & Plan:** current tier with usage-against-limits meters (agents, projects this month, council sessions this month), tier comparison with upgrade/downgrade, billing portal link, sign out, Enterprise/SSO contact. See §8.
- **Connections:** list of provider cards, "Add connection" flow (pick provider → enter API key → validate → name it). Local/self-hosted option accepts a base URL.
- **Agents:** managed from the sidebar's Agents area (not a Settings tab). Create/edit drawer with live "test message" box.
- **Skills:** installed skills with per-skill toggle, source (marketplace / local file / URL), and "attach by default to..." agent picker.
- **Plugins:** marketplace browser plus installed list; each plugin expands to show what it bundles (skills, connectors, commands).
- **Integrations:** MCP connector directory and installed connectors, each with granted-permission scopes and a per-agent access matrix.
- **General:** appearance (Dark default / Light / Match system), default agent for new chats, keyboard shortcuts, data location, export/erase all local data.
- **Usage & Billing:** per-connection and per-agent token/cost dashboards, per-month; budget alerts; Council sessions itemized.

---

## 8. Accounts, Subscription Tiers & Enterprise

### 8.1 Kolloq account and sign-in

Kolloq requires authentication on first launch. Sign-in options: email + password (with verification), Google/Apple OAuth, or — for Enterprise tenants — the organization's SSO (§8.4). The account is what plans, entitlements, and (v2) sync attach to. Conversations and files remain local; the account governs *what the app is allowed to do*, not where data lives.

### 8.2 Tiers and entitlements

Three self-serve tiers plus Enterprise. Limits below are **placeholders — final numbers TBD** pending pricing work; the structure is the commitment, not the values.

| Capability | Free | Pro | Max | Enterprise |
|---|---|---|---|---|
| Agents | 2 | 10 | Unlimited | Unlimited |
| Active projects | 1, max 3 new/month | 10, 20 new/month | Unlimited | Unlimited |
| Advisory Council sessions | 1 per month, max 3 seats | 25/month, 5 seats | Unlimited, 5 seats | Unlimited + admin policies |
| LLM connections | 2 | Unlimited | Unlimited | Unlimited (admin-managed allowlist) |
| Skills / plugins / integrations | 3 total | Unlimited | Unlimited | Unlimited + private catalog |
| Scheduled tasks | — | 10 | Unlimited | Unlimited |
| Priority support | — | — | ✓ | ✓ + SLA |

Tier behavior rules: hitting a limit never blocks viewing existing work — it blocks *creating* the next agent/project/session, with an inline upgrade prompt stating exactly which limit was hit. Downgrading never deletes anything; over-limit items become read-only until the count is back under the cap. Monthly counters reset on the billing anniversary.

### 8.3 Entitlement security (product-level requirements)

- Entitlements are **verified server-side** and delivered to the client as a short-lived signed token; the app checks the token before gated actions. Limits must not be enforceable-by-editing-a-local-config — a tampered client should fail entitlement checks, not unlock features.
- The app functions offline for a grace period (target: 7 days) on the last valid token, after which gated features (not existing data) lock until it can re-verify.
- Payment and subscription management via a hosted billing portal (e.g., Stripe-hosted); the desktop app never handles card data.
- Account deletion removes server-side account/entitlement data; local data remains the user's.

### 8.4 Enterprise edition

For organizations, sold per-seat with an annual contract:

- **Single sign-on:** SAML 2.0 and OIDC against the customer's IdP (Okta, Entra ID, Google Workspace); enforced domain capture (users with a claimed domain must go through SSO); SCIM provisioning/deprovisioning.
- **Custom branding:** tenant logo replaces the Kolloq mark in the sidebar and sign-in screen; tenant accent color; optional custom app name in title bars ("Acme Advisor, powered by Kolloq").
- **Admin console (web):** seat management, provider allowlist (e.g., "no data to xAI"), mandatory org-wide connections (company API keys so employees never handle keys), usage and cost reporting by team, private skill/plugin catalog, data-retention policy for transcripts.
- **Security posture:** org-managed keys stored server-side in the tenant vault rather than personal keychains; audit log of council sessions and integration grants; no training on customer data — contractual.

## 9. Cross-cutting Product Rules

- **Key security:** on desktop, credentials live only in the OS keychain; in the browser, in encrypted account-scoped storage or the Enterprise tenant vault (§3.1). Never in exports, logs, or sync.
- **Cost transparency:** any action that will fan out to multiple paid models (Council, multi-agent project tasks) shows an estimated cost before starting and a live meter while running.
- **Provider failures:** rate limits and outages surface inline with retry/backoff, never silent stalls. In a Council, a failed agent's seat is marked "unavailable"; the moderator continues with remaining agents if ≥ 2 remain, else pauses.
- **Attribution:** every message everywhere is labeled with agent name and underlying model — no ambiguity about which model said what.
- **Local-first:** conversations, projects, and council transcripts stored locally; optional encrypted sync is a v2 item.

---

## 10. Out of Scope (v1)

Mobile apps; shared/collaborative workspaces (Enterprise v1 is per-seat with central admin, not real-time collaboration); agent marketplaces with paid agents; tool use during Council debates; fine-tuning or model hosting; voice.

## 11. Open Questions

1. ~~Which providers can legally/technically support subscription login at launch?~~ Resolved 2026-07-22 (board decision, see NEW-69): subscription login is out of scope for LLM connections — API keys only (§5.1).
2. Should the Moderator be user-configurable per council, or a locked system preset for consistency? (Spec assumes configurable with a strong default.)
3. Council pricing UX: hard budget cap default value ($5? $20?) — needs user testing.
4. Do project tasks auto-route to the "best" agent, or is assignment always manual? (Spec assumes manual in v1.)
5. Final tier limit values and price points for Free / Pro / Max (§8.2 numbers are placeholders).
6. Does Free tier require the user's own LLM keys only, or does Kolloq bundle a small metered allowance of hosted model calls to remove the cold-start problem? (Bundling changes cost structure materially.)

---

## 12. Screen Inventory (matches the mockup)

0. **Sign-in** — email/OAuth sign-in, SSO entry point, tier marketing.
1. **Chat** — sidebar history + conversation + composer with agent picker.
2. **Project view** — working-folder bar (path, Change, Disconnect), files/tasks/knowledge panel, agent roster, chat.
3. **Council setup** — challenge, seat picker (5 seats), rules.
4. **Council live** — transcript + alignment panel (the mockup includes a simulated debate).
5. **Council result** — Decision Brief.
6. **Settings → Connections** — provider cards + add-connection flow.
7. **Agents** (sidebar) and **Settings → Skills / Plugins / Integrations / Usage** — management lists.
8. **Settings → Account & Plan** — current tier, usage against limits, tier comparison, Enterprise/SSO contact.
