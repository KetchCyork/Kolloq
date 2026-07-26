# Kolloq — Design Document (UI / UX Specification)

**Version:** 1.0 (Draft for review)
**Date:** July 20, 2026
**Author:** Prepared for Chris York
**Supports:** `docs/openwork-mockup.html` (the interactive mockup from NEW-73) and the *Kolloq — Product Specification* (`docs/openwork-product-spec.md`).
**Status:** Design specification. This document formalizes the visual design language, design tokens, component library, and screen anatomy realized in the mockup so that design and engineering share one source of truth. It does not add product scope — for what the product does, see the product spec; for how it looks and behaves, see here.

---

## 1. How to Use This Document

The mockup is the *reference implementation* of the design. This document is the *specification* behind it: it names the tokens, states, and rules the mockup encodes as ad-hoc CSS so they can be rebuilt as a real design system (CSS variables, a component library, or a Tauri/web front end) without re-deriving intent from the HTML.

- **Designers** use §3–§7 as the visual language and §8 as the per-screen blueprint.
- **Engineers** use §3 (tokens) and §6 (components) as the build contract, and §9 for motion/interaction behavior.
- Every token value below is taken directly from the mockup's CSS so the spec and the mockup never disagree. Where a value should change before build, it is flagged in §12.

Design north star, inherited from the product bet: **structured disagreement between strong models produces better decisions than a single oracle.** The UI's job is to make *which model said what* unambiguous, make *multi-agent state* legible at a glance, and make *cost and trust* always visible.

---

## 2. Design Principles

1. **Attribution is non-negotiable.** Every message, every seat, every card is bound to an agent identity and its underlying model. Color, name, and model label travel together everywhere (see §5, agent identity system).
2. **Calm dark surface, one bright accent.** The workspace is a near-black blue-gray field; teal is the *only* saturated interactive color. Saturation is a signal, not decoration — reserve it for what the user can act on or must notice.
3. **Legible multi-agent state.** Debate, rosters, and connection health are shown as compact, scannable status (dots, meters, badges) rather than prose.
4. **Honest system feedback.** Errors, rate limits, budget, and cost are surfaced inline, never hidden. A broken connection looks broken everywhere the agent appears.
5. **Editorial headings, functional body.** Serif headings give the product an advisory, considered voice; a system sans keeps dense UI fast to read.
6. **One UI, four platforms.** The same layout and tokens render on browser, macOS, Windows, and Linux; platform differences are constrained to affordances (folder pickers, keychain), never to look-and-feel.

---

## 3. Design Tokens

All tokens are defined as CSS custom properties on `:root` (dark, default) and overridden on `body.light`. Theme is a class swap — see §9.4.

### 3.1 Color — Dark theme (default)

| Token | Value | Role |
|---|---|---|
| `--bg` | `#12151d` | App background / topbar / deep surfaces |
| `--panel` | `#1b2029` | Cards, composer, modals, filled seats, bubbles |
| `--sidebar` | `#0e1219` | Primary nav rail, sign-in backdrop base |
| `--border` | `#2b3242` | Hairlines, card/field borders, dividers |
| `--text` | `#e6e9f0` | Primary text |
| `--muted` | `#8a92a6` | Secondary text, labels, meta, icon strokes |
| `--accent` | `#1fc29c` | **Interactive teal** — primary buttons, active nav, links, focus, selection, meters |
| `--accent-soft` | `#14332b` | Accent-tinted fills (active nav bg, badges, moderator bubble) |
| `--on-accent` | `#06231b` | Text/icon on an accent-filled surface |
| `--green` | `#6fce8f` | Success / healthy / "done" |
| `--amber` | `#d9a94a` | Caution / in-progress / budget |
| `--red` | `#e2705a` | Error / connection failure / destructive |

### 3.2 Color — Light theme (`body.light`)

| Token | Value | Notes |
|---|---|---|
| `--bg` | `#f5f6f8` | Light neutral field |
| `--panel` | `#ffffff` | White surfaces |
| `--sidebar` | `#eceef2` | Light nav rail |
| `--border` | `#dcdfe6` | Light hairline |
| `--text` | `#1a2744` | Navy text |
| `--muted` | `#5f6b85` | Muted navy |
| `--accent` | `#12a184` | **Darker teal** for contrast on white |
| `--accent-soft` | `#d8f3ea` | Pale teal fill |
| `--on-accent` | `#ffffff` | White on accent |
| `--green` / `--amber` / `--red` | `#2e7d4b` / `#9a6d1c` / `#b3402e` | Darkened status hues for AA contrast on light |

Light mode also re-tints the status *badge* backgrounds and several hardcoded dark surfaces (hover states, avatars, toggles, meters, the sign-in gradient, tier-strip fills) via `body.light` overrides. Rule for implementers: **any color hardcoded outside the token set must ship a `body.light` override.** Prefer adding a token over hardcoding.

### 3.3 Agent identity palette

Five fixed, perceptually distinct hues identify agents across the entire app. They are *identity*, not status — never reuse them for success/error.

| Token | Dark | Light | Example agent in mockup |
|---|---|---|---|
| `--a1` | `#e08a63` (terracotta) | `#c96a43` | Atlas · Claude Fable 5 |
| `--a2` | `#5b9bd5` (blue) | `#3b6ea5` | Critic · GPT-5 |
| `--a3` | `#5cb87a` (green) | `#2e7d4b` | Scout · Gemini 3 Pro |
| `--a4` | `#a97fd1` (purple) | `#7c53a5` | Sage · Grok 4 |
| `--a5` | `#d9a94a` (gold) | `#9a6d1c` | Forge · Llama 4 (local) |

Usage: a solid dot (chat composer, roster, scores, agents grid), a rounded-square avatar with a one-letter monogram in white (chat/council message authors), a left border on dissent blocks. The moderator is the exception — it uses `--accent`, marking it as system/neutral rather than a debating seat.

### 3.4 Typography

| Role | Family | Weight / size |
|---|---|---|
| Body / UI | `-apple-system, "Segoe UI", Helvetica, Arial, sans-serif` | 400/600; base **15px** root |
| Headings / editorial (`h1–h3`, `.serif`) | `Georgia, "Times New Roman", serif` | 500 |
| Code / paths | `ui-monospace, Menlo, Consolas, monospace` | 12px |

Representative type ramp (from the mockup): section eyebrow 11px uppercase + `.08em` tracking; convo/meta 11–13px; nav & body 13.5–14.5px; topbar title 17px; brief title 19px; stat numbers 22px; sign-in H1 24px. Message and brief body use `line-height:1.65` for reading comfort; dense UI uses ~1.4. Numeric stats (scores, limits, prices) use `font-variant-numeric: tabular-nums` so digits don't jitter.

Heading rule: serif is reserved for *titles that name a thing* (view titles, card/section headers, brief headings, tier names). Never set body copy, buttons, or labels in serif.

### 3.5 Shape, elevation, spacing

- **Radius:** `--radius: 12px` (cards, seats, tiers). Buttons/nav/fields 9–10px; chips & badges pill (20px); composer & modals 16px; sign-in card 18px; avatars/dots 50%.
- **Elevation (shadows):**
  - Resting surface — `--shadow: 0 1px 3px rgba(0,0,0,.35)` (dark) / `rgba(20,30,50,.08)` (light).
  - Dropdown/menu — `0 8px 24px rgba(0,0,0,.12)`.
  - Modal — `0 20px 60px rgba(0,0,0,.25)`.
  - Sign-in card — `0 24px 70px rgba(0,0,0,.5)`.
  Elevation is monotonic: higher-stacking surfaces cast larger, softer shadows.
- **Layout widths (fixed rails):** sidebar 250px · project sidebar 290px · council side panel 300px · settings nav 210px.
- **Content measures (max-width, centered):** chat/composer 760px · generic page 980px · council setup 860px · brief / council result 780px. Keep line-length bounded even on wide desktop windows.
- **Rhythm:** panels pad 14–30px; cards 16–18px; message stack gap 20–26px. Border color always `--border`; a 1px hairline separates every major region (topbar, rails, dividers).

---

## 4. Brand & Identity

- **Mark:** a teal-to-green gradient ring enclosing a stylized **"w"** (rendered as an inline SVG so it stays crisp and inherits the gradient at any size). Gradient stops: `#41e0a7 → #17b394`, top-left to bottom-right.
- **Wordmark:** "Kolloq" in the bold system sans — white on dark surfaces, navy (`#1a2744`) on light.
- **Tagline (sign-in):** *"Every model. One workspace. Better decisions."*
- **Placement:** mark + wordmark top-left of the sidebar; mark + H1 centered on the sign-in card.
- **Enterprise override:** tenants may replace the mark and accent color and set a custom app name in title bars (e.g., "Acme Advisor, powered by Kolloq"). The design system exposes exactly two override points — the logo slot and `--accent` (with `--accent-soft`/`--on-accent` derived) — so a tenant theme is a token swap, not a redesign. See product spec §8.4.

---

## 5. The Agent Identity System (cross-cutting)

Because attribution is principle #1, agent identity is specified once and reused everywhere:

- **Composition:** color (`--a1…a5`) + name + underlying-model label. All three appear together; the model label is always in muted text next to or under the name.
- **Marks:**
  - *Dot* — 9–12px filled circle. Used in lists, pickers, rosters, score rows, agents grid.
  - *Avatar* — 28–30px rounded square (radius 8px), agent color fill, single-letter white monogram. Used as the message author chip in Chat and Council.
- **Status overlay:** identity color never changes; *health* is shown by a separate badge — `green "Ready"` or `red "Connection error"`. A broken connection shows the red badge on the agents grid, an error badge in every picker, and disables invocation (product spec §5.2).
- **The user** is not an agent: the user avatar is a neutral slate square (`#47526b` dark / `#6b7691` light) with initials, visually distinct from any agent hue.
- **The moderator** uses `--accent` (teal), signalling neutral/system authority rather than a partisan seat.

---

## 6. Component Library

Each component lists its purpose, key tokens, and states. Names match the mockup's CSS classes so the mapping is 1:1.

### 6.1 Buttons (`.btn`)
- **Variants:** default (panel fill, border), `.primary` (accent fill, `--on-accent` text, no border), `.small` (compact padding, 12.5px).
- **States:** hover (default → `#232a37` dark / `#eef0f4` light; primary → `brightness(1.12)`); `:disabled` → opacity .45, default cursor. Radius 9px, weight 600.

### 6.2 Badges (`.badge`)
Pill, 11px, weight 600. Semantic variants map to status: default (accent-soft/accent) = plan/neutral; `.green` = connected/consensus/ready; `.gray` = passive label (e.g., "knowledge"); `.red` = error; `.amber` = in-progress/caution. Light theme re-tints each background. Use badges for *state*, never for identity.

### 6.3 Cards (`.card`)
Panel fill, 1px border, radius 12px, resting shadow, 16–18px pad. The universal container for connections, agents, skills, plugins, integrations, usage stats, and plan blocks. A **dashed** card (`border-style:dashed`, muted centered text) is the "create new / empty" affordance (e.g., "＋ Create from template").

### 6.4 Chips (`.chip`)
Pill, bordered, 12.5px muted. Two uses: inline metadata/attachments (`📎 file.xlsx`) and the composer's **agent picker trigger** (dot + agent label + ▾). A chip with a leading `.dot` always denotes an agent.

### 6.5 Toggle (`.toggle` / `.toggle.on`)
36×20 track, 16px knob, 150ms slide. Off = neutral track; on = `--accent`. Used for per-skill enable and (semantically) any boolean setting.

### 6.6 Meter (`.meter`)
10px rounded track over `#2b3242` (dark) / `#e3e6ec` (light). Two fill modes:
- **Progress** — solid accent fill at a % width (plan-limit usage, budget).
- **Alignment** — `linear-gradient(90deg, --amber, --green)` fill that animates width as council consensus rises (600ms ease). The gradient encodes "moving from contested → aligned."

### 6.7 Form fields (`.field`)
Label (12.5px, weight 600) + control (input/textarea/select) at radius 10px, panel fill, 1px border; focus raises border to `--accent`. Optional `.hint` (12px muted) below. Used across council setup, connection modal, general settings.

### 6.8 Navigation item (`.nav-item`) & sidebar
Icon (17px, muted stroke) + label, radius 9px. States: hover (`rgba(255,255,255,.06)`), **active** (accent-soft fill, weight 600, icon stroke → accent). Sidebar sections use the 11px uppercase eyebrow. Recents are `.convo` rows (title + muted model subline, truncated). Footer pins the user avatar, name/email, and a clickable **plan pill** (accent, e.g., "PRO") that deep-links to Account & Plan.

### 6.9 Message rows — Chat (`.msg`) and Council (`.cmsg`)
- **Chat `.msg`:** author avatar + body; `.meta` line carries `**Name** · Model · used skill …`; `.msg.user` gets the neutral slate avatar. A **switch divider** (`.switch-divider`) marks mid-conversation agent handoffs ("Switched agent — Critic now has the full conversation").
- **Council `.cmsg`:** author avatar + bordered bubble; `.cmsg.mod` styles the moderator bubble with accent-soft fill and accent name. Council messages fade/slide in (see §9).

### 6.10 Council seat (`.seat`)
Radius-12 tile. Empty = dashed border, muted, "＋ Add seat" (clickable to fill). Filled (`.seat.filled`) = solid border, panel fill, shadow, showing agent dot + name + model + optional stance line. Grid of up to 5.

### 6.11 Task row (`.task`)
Small panel row with a circular status node (`.st`). Default = hollow muted ring; `.task.done` = green filled node + struck-through muted text. Sub-line shows owner + state ("Assigned to Atlas · in progress" / "blocked").

### 6.12 Provider logo tile (`.provider-logo`)
34px rounded square, brand-colored fill, bold white monogram — the connection card's identity mark (Anthropic terracotta, OpenAI/xAI slate, Google blue, Ollama `⌂`). Paired with a status badge and a `.kv` metadata strip (models · agents · spend · Test).

### 6.13 Metadata strip (`.kv`)
Wrapping row of muted `label + **value**` pairs. The standard way to show dense attributes (models available, agent count, monthly spend) under a card heading. Values use tabular numerals for costs.

### 6.14 Modal (`.modal` over `.modal-back`)
Centered panel, radius 16, modal shadow, over a 60% scrim; opened/closed by an `.open` class; backdrop click closes. Used for the folder picker and add-connection flow. Modal titles are serif.

### 6.15 Tier card (`.tier`) and limit row (`.limit-row`)
- **Tier card:** serif tier name, large price, check-prefixed feature list; the current plan gets an accent border + ring (`.tier.current`). Four across (Free/Pro/Max/Enterprise).
- **Limit row:** label + `used of total` (tabular) over a progress meter — the "usage against entitlement" pattern on Account & Plan.

### 6.16 Folder bar (`.folder-bar`)
Project-scoped control: `📁 Working folder` label + monospace path + green "Read & write" badge + Change/Disconnect. Always visible at the top of a project so folder scope is never ambiguous (product spec §4, Projects).

### 6.17 Decision Brief (`.brief`) & dissent (`.dissent`)
The council's output artifact: serif title, muted sub-line (seats · date · consensus avg), then uppercase-eyebrow section headers (Recommendation, Rationale, Key contention & resolution, Dissents, Next steps). A **dissent block** is a left-accent-bordered (`--a4`) callout attributing a reservation to a named agent and score.

---

## 7. Iconography

- **Style:** single-weight (2px) line icons on a 24×24 grid, `stroke: --muted`, no fill; active nav flips stroke to `--accent`.
- **Set (sidebar):** Chat (speech bubble), Projects (folder-tab), Advisory Council (three linked nodes), Agents (robot), Settings (gear).
- **Inline glyphs:** the mockup uses emoji for lightweight affordances (📎 attach, 🛠 tools, 📁 folder, ⏸ pause, 💬 inject, 🗳 vote). For production these should be replaced by the line-icon set for visual consistency and cross-platform rendering (§12).

---

## 8. Screen Anatomy

The mockup is a single-window app shell (fixed sidebar + swapped main view). Screen numbers match the product spec's Screen Inventory (§12) and the mockup's `#v-*` sections.

**App shell (all screens):** left sidebar rail (250px) with logo, "New chat" CTA, five nav items, Recents, and the user/plan footer; a main column with a 1px-bordered **topbar** (view title in serif + contextual badges/actions) above the active view.

### 8.0 Sign-in (`#signin`)
Full-screen gate over a radial teal→dark gradient. Centered card: mark + "Kolloq" H1 + tagline, three SSO buttons (Google, Apple, company SSO), an "or" divider, email/password, primary Sign in, and a local-data reassurance note. Below the card, a three-tile **tier strip** markets Free/Pro/Max. Sign-in must clear before the workspace shows.

### 8.1 Chat (`#v-chat`)
Topbar: conversation title (serif) + agent badge + Share/Export. Scroll column capped at 760px with `.msg` rows; agent handoffs render a switch divider. **Composer** (`.composer`, radius 16): textarea + a control row with the **agent picker** (chip → dropdown of agents with model/provider sublines), attach/tools chips, and an accent send button. This screen is the parity-with-Claude-Chat surface.

### 8.2 Project (`#v-project`)
Topbar adds the **folder bar** (path, R&W badge, Change/Disconnect). Body is three zones: a 290px left panel (Agent roster → Tasks → Files → Project instructions), the chat main column, and its composer (with an "Auto-route ▾" agent selector). Demonstrates the Claude Cowork-parity + multi-agent-roster extension.

### 8.3 Council setup (`#v-council-setup`)
860px form: the **Challenge** textarea (+ attachment chips), optional decision criteria, a 5-across **seat grid** (four filled with stances, one "＋ Add fifth seat"), a diversity hint, and a three-up row of Moderator / Max rounds / Budget cap selects. A cost-estimate + session-quota hint precedes the primary "Convene the council →".

### 8.4 Council live (`#v-council-live`)
Split view. **Left (transcript):** round tags (`.round-tag`) separating Round 0 opening positions, Round 1 rebuttals, Round 2 convergence; agent bubbles + accent moderator bubbles animate in sequentially. **Right (300px side panel):** the **alignment meter**, per-agent agreement scores, the current leading proposal card, and session stats (round, running cost vs cap, moderator). Topbar carries a live status badge and Pause/Inject/Force-vote controls. This is the signature multi-agent screen.

### 8.5 Council result (`#v-council-result`)
780px `.brief` artifact (see §6.17) with a green consensus badge (round + cost) and Export PDF / Send to project actions, plus a link back to the full transcript.

### 8.6 Settings — Connections (`#t-connections`)
Provider cards, each: logo tile + name + masked credential + status badge + `.kv` (models · agents · spend · Test). "＋ Add connection" opens the modal: provider select → API-key vs subscription-login choice → key field + reassurance note → Validate & connect. Error state (xAI) shows a red badge and a "Replace key" action, and calls out the disabled dependent agent.

### 8.7 Agents grid & management lists
- **Agents (`#v-agents`):** 3-up card grid; each card = identity dot + name + health badge + model/persona subline + `.kv` (skills · tools · spend). A dashed "＋ Create from template" card closes the grid.
- **Skills / Plugins / Integrations / Usage** reuse the card + toggle + `.kv` patterns: skills as toggled cards with source + attachment, plugins with an Install/Installed action and a "bundles" subline, integrations as MCP connector cards with scopes + per-agent enablement, usage as stat cards + a per-agent spend strip.

### 8.8 Settings — Account & Plan (`#t-account`)
Current-plan card: name + plan badge + renewal/price + Upgrade, then three **limit rows** (agents, projects, council sessions) as used/total meters, and a reassurance note that limits never lock existing work. Below, the four-across **tier grid** with the current plan ringed in accent, and a placeholder-pricing disclaimer.

*(General settings (`#t-general`) hosts the appearance switch and defaults; see §9.4.)*

---

## 9. Interaction & Motion

Motion is functional and restrained — it clarifies state change, never decorates.

### 9.1 View & tab switching
`show(view)` toggles the active `.view` and syncs the active nav item (council sub-screens all map to the Advisory Council nav). Settings uses `stab(tab)` to swap the active `.stab` and `.spane`. Switches are instant (no cross-fade) to keep navigation snappy.

### 9.2 Menus & modals
Agent dropdown toggles on click and closes on any outside click (`.open` class). Modals open via `.open` on the backdrop and close on Cancel or scrim click. Dropdowns carry the menu shadow; modals the modal shadow.

### 9.3 Council simulation (the signature sequence)
On "Convene the council," transcript steps reveal on a timed cascade (~900ms between steps). Each `.cmsg` transitions from `opacity:0; translateY(6px)` to visible (400ms). As steps fire, the side panel updates live: the **alignment meter** width climbs (30% → 58% → 74% → 88%) with a caption per stage, running **cost** ticks up ($0.90 → $1.55 → $2.10) against the $5 cap, the **round counter** advances, the **leading proposal** populates, per-agent **scores** fill in, and the status badge flips amber → green "✓ Consensus reached," revealing the "View Decision Brief →" button. This choreography *is* the product's core demonstration: watching disagreement resolve into alignment.

### 9.4 Theming (`setTheme`)
Three modes: **Dark** (default), **Light**, **Match system**. Implementation toggles `body.light`; "Match system" reads `prefers-color-scheme` and subscribes to OS changes live via `matchMedia`. Selecting a mode updates the appearance switch's selected state. Because the whole palette is tokenized, theming is a single class flip — the guardrail from §3.2 (every hardcoded color needs a `body.light` twin) is what keeps it correct.

### 9.5 Micro-interactions
Toggle knob slides 150ms; meter fills ease 600ms; buttons brighten/darken on hover; field borders raise to accent on focus. Keep all transitions ≤ 600ms and easing gentle.

---

## 10. States, Feedback & Edge Cases

- **Connection health:** Connected (green) / Error (red) / Rate limited (amber) badges on connection and agent cards. An errored provider names its impact ("Key rejected — 1 agent (Sage) disabled") and offers the recovery action inline.
- **Agent unavailable:** identity color persists; a red "Connection error" badge appears everywhere the agent shows, and it cannot be invoked until fixed.
- **Empty / create affordances:** dashed cards and dashed seats are the consistent "nothing here yet — add one" pattern.
- **Entitlement limits:** meters show used/total; hitting a cap blocks *creating the next item* (inline upgrade prompt), never viewing or editing existing work — the note text states this explicitly.
- **Cost transparency:** any fan-out action (a council, multi-agent tasks) shows an *estimate before* and a *live meter during*; a budget cap has a hard stop. Free/local (Ollama) agents are labeled "free (local)."
- **Disabled controls:** opacity .45, default cursor (e.g., the current plan's button).

---

## 11. Accessibility & Platform Notes

- **Contrast:** the light theme deliberately darkens accent and status hues (`#12a184`, `#2e7d4b`, etc.) for AA text/icon contrast on white; dark-theme body text (`#e6e9f0` on `#12151d`) clears AA. Any new token pair must be contrast-checked in *both* themes before merge.
- **Color is never the only signal:** agent color is always accompanied by the agent's name and model text; status color is always paired with a word ("Ready," "Error," "Connected") — colorblind users lose nothing.
- **Focus & keyboard:** production must add visible focus rings (accent outline) and honor the product spec's universal search (Cmd/Ctrl-K) and shortcuts; the mockup omits these.
- **Motion:** respect `prefers-reduced-motion` — the council cascade should collapse to an instant reveal when the user opts out.
- **Platform parity:** identical layout on browser + macOS/Windows/Linux desktop; platform-specific affordances (native folder picker, OS keychain messaging, background-task availability) swap behind the same components, per product spec §3.1.

---

## 12. Open Design Questions & Pre-Build Cleanups

1. **Iconography:** replace inline emoji affordances (§7) with the line-icon set for consistent cross-platform rendering.
2. **Tokenize the strays:** a handful of colors are hardcoded in the mockup (neutral avatars, some hover fills, meter track). Promote these to named tokens so light/dark and enterprise theming stay a pure token swap.
3. **Spacing scale:** the mockup uses one-off pixel values. Formalize a 4px-based spacing scale before building the component library.
4. **Type scale:** ramp is currently ad-hoc per element; define a named type scale (e.g., xs/sm/base/lg/xl + heading tiers) mapped to the sizes in §3.4.
5. **Enterprise theming:** confirm the two override points (logo, accent) are sufficient, or whether tenants also need a neutral-surface override.
6. **Responsive behavior:** the mockup targets desktop widths. Define breakpoints/collapse behavior for the sidebar and the council split view on narrow windows (and the browser-tab case).
7. **Reduced-motion + focus-visible:** specify both explicitly for the component library.

---

*This design document is a companion to the product specification and the interactive mockup. When the mockup and this document diverge, treat the mockup as the current visual truth and update this document to match — or, once a real component library exists, treat this document's tokens as the contract and regenerate the mockup from it.*
