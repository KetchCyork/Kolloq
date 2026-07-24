# Advisory Council

Advisory Council brings multiple agents — each on its own provider/account — together to debate a
question and produce one synthesized answer, instead of asking a single model.

## How it works

1. **Independent answers (round 0).** Every member answers the question with no visibility into
   the others' responses.
2. **Revision rounds.** From round 1 on, each member sees every other member's latest position and
   either revises (prefixing its reply with `DISSENT: <reason>`) or agrees (`CONCUR`). Debate
   continues until every member concurs in the same round, or the round cap is hit.
3. **Moderator synthesis.** The first member's account acts as moderator, reading the full
   transcript and writing the final answer. If the moderator's own call fails, the debate is never
   discarded — a deterministic fallback summary (final positions + unresolved dissent) is shown
   instead.

If a member's provider call errors mid-debate, that member is dropped from the rest of the rounds
(the transcript shows a "dropped after a provider error" note) and the remaining members continue.

## Configuring a council

Open a council's **Council setup** panel to:

- **Add/remove members** (2–5), each pointed at a saved account. Two members can't share the same
  account.
- Give a member an optional **role** label (e.g. "skeptic", "domain expert") — it's surfaced in
  prompts and the transcript.
- Set the **round cap** (default 4, range 2–8) — the hard limit on debate rounds if members never
  reach consensus.

## Round cap

A council run is `members × rounds` provider calls, plus one moderator call. Raising the round cap
raises the ceiling on how many calls a single question can trigger before consensus is forced by
the cap rather than reached organically — the setup panel shows this warning next to the control.
The transcript distinguishes the three ways a debate can end:

- **Consensus reached** — every member concurred in the same round.
- **No consensus after N rounds (round cap)** — the cap was hit with active dissent still on the
  table.
- **No answer from any member** — every member's provider call failed before any of them could
  respond; the moderator still attempts a fallback summary.

While a council is debating, the transcript shows live "Round N of M" progress.

## Cost

No provider in this codebase returns real token usage, so the cost note shown per member position
and per turn (top-right of each answer) is a client-side estimate — character count ÷ 4 as a token
proxy, times a flat per-provider rate — not a billing figure. Ollama accounts are always shown as
free (local). Because a council multiplies calls across members and rounds, its total cost scales
faster than a single-agent chat turn of the same length; the round cap is the main lever for
bounding that.
