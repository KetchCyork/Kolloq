import { useState } from "react";
import {
  DEFAULT_COUNCIL_MAX_ROUNDS,
  estimateCouncilCostRange,
  formatCouncilCostRange,
  validateCouncilMembers,
} from "../councilReducer";
import { useStore } from "../store";
import type { CouncilSession } from "../types";
import { CouncilSetupForm } from "./CouncilSetupForm";

/**
 * Pre-first-turn setup screen: challenge + optional decision criteria, roster, rules, and a cost
 * estimate, ending in "Convene the council". The challenge (plus criteria, if given) becomes the
 * first question passed to `askCouncil` — there's no separate "draft session" concept in this app,
 * so roster/rule edits made here already persist immediately via `updateCouncilSession`, same as
 * editing them later from the live/brief header toggle.
 */
export function CouncilSetupView({
  session,
  onConvene,
  error,
  busy,
}: {
  session: CouncilSession;
  onConvene: (question: string) => void;
  error: string | null;
  busy: boolean;
}) {
  const { accounts, updateCouncilSession } = useStore();
  const [challenge, setChallenge] = useState("");
  const [criteria, setCriteria] = useState("");

  const validationError = validateCouncilMembers(session.members, accounts);
  const maxRounds = session.maxRounds ?? DEFAULT_COUNCIL_MAX_ROUNDS;
  const costRange = estimateCouncilCostRange(session.members, accounts, maxRounds, session.moderatorAccountId);

  function handleConvene() {
    const text = challenge.trim();
    if (!text || Boolean(validationError) || busy) return;
    const question = criteria.trim() ? `${text}\n\nDecision criteria to weigh: ${criteria.trim()}` : text;
    onConvene(question);
  }

  return (
    <div className="council-setup-page">
      <div className="council-setup-page-inner">
        <div className="field">
          <label>The challenge</label>
          <textarea
            rows={3}
            placeholder="What decision should the council debate?"
            value={challenge}
            disabled={busy}
            onChange={(e) => setChallenge(e.target.value)}
          />
        </div>
        <div className="field">
          <label>Decision criteria (optional)</label>
          <input
            type="text"
            placeholder="e.g. total cost, engineering effort, migration risk"
            value={criteria}
            disabled={busy}
            onChange={(e) => setCriteria(e.target.value)}
          />
        </div>

        <CouncilSetupForm session={session} onChange={(patch) => updateCouncilSession(session.id, patch)} />

        <div className="hint council-cost-estimate">
          Consensus rule: all seats must concur on the leading proposal. Estimated cost:{" "}
          <b>{formatCouncilCostRange(costRange)}</b>
        </div>

        {error && <div className="council-setup-error">{error}</div>}

        <div className="council-setup-actions">
          <button
            type="button"
            className="primary-btn"
            disabled={!challenge.trim() || Boolean(validationError) || busy}
            onClick={handleConvene}
          >
            {busy ? "Convening…" : "Convene the council →"}
          </button>
        </div>
      </div>
    </div>
  );
}
