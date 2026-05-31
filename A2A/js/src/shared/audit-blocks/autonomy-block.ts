// ================= AUDIT FRAMEWORK V6 — AUTONOMY BLOCK ======================
// Iter 3. Emits the `autonomy` audit block: what autonomy the agent had,
// where the human sits relative to the loop, and what events would have
// fired a commit gate if one existed.
//
// Sources of data:
//   - `capabilitiesActive` — declared per the locked six-pillar enum
//     (AUDIT-FRAMEWORK-V6-DECISIONS.md § 2026-05-24 Item 1). The builder
//     accepts the default mapping today; future iterations can override
//     individual pillars without schema change.
//   - `humanOversightPosition` — declared per the locked enum
//     (DECISIONS.md Item 2). Current state: `"HOOTL_with_guardrails"`.
//   - `guardrails[]` — list of strings naming the active guardrails.
//     Current state: `["maxRounds=3", "treasury-ACTUS-veto",
//     "applySellerConstraints"]`.
//   - `commitGate.state` — always `"NOT_REQUIRED"` today (no human-approval
//     gate exists). 8-value enum reserved per Q32.
//   - `commitGate.wouldFireAt[]` — passed in from the agent's per-negotiation
//     `commitGateEvents` array, which both agents accumulate parallel to
//     `decisionTrail`. See `CommitGateEvent` in negotiation-types.ts.
//
// Acceptance tests (per AUDIT-FRAMEWORK-V6-ITERATION-PLAN.md Part 3 Iter 3):
//   T3: `autonomy.commitGate.wouldFireAt[]` has an entry for any treasury
//       rejection in the deal.
//   T4: `autonomy.humanOversightPosition` is set to `HOOTL_with_guardrails`.

import type { CommitGateEvent } from "../negotiation-types.js";

// ────────────────────────────────────────────────────────────────────────────
// Locked enum types (DECISIONS.md addendum 2026-05-24).
// ────────────────────────────────────────────────────────────────────────────

/**
 * Closed enum — adding a seventh pillar requires a new DECISIONS.md addendum.
 * Order is canonical and matches the order rows are emitted on the audit.
 */
export type AutonomyPillar =
  | "goalInterpretation"
  | "planning"
  | "toolInvocation"
  | "commitmentAuthority"
  | "peerCommunication"
  | "learningFromOutcome";

/** Strictly ordered list — the canonical emission order. */
export const AUTONOMY_PILLAR_ORDER: readonly AutonomyPillar[] = [
  "goalInterpretation",
  "planning",
  "toolInvocation",
  "commitmentAuthority",
  "peerCommunication",
  "learningFromOutcome",
] as const;

export interface PillarStatus {
  /** Whether the pillar is wired today. */
  active:       boolean;
  /** Honest one-line justification for why active=true|false. */
  justification: string;
  /** When active=false, an optional pointer to where this work is deferred to. */
  deferredTo?:  string;
}

/**
 * Ordered weakest → strongest human oversight. Closed enum.
 *
 *   HITC                       — Human In The Center: human makes every decision
 *   HITL                       — Human In The Loop: human approves every commit
 *   HITL_with_guardrails       — HITL + automatic walk-away guardrails
 *   HOTL                       — Human On The Loop: human monitors, can intervene
 *   HOTL_with_guardrails       — HOTL + guardrails
 *   HOOTL                      — Human Out Of The Loop: fully autonomous
 *   HOOTL_with_guardrails      — HOOTL but with hard-coded escalation rules
 *
 * Current state: HOOTL_with_guardrails.
 */
export type HumanOversightPosition =
  | "HITC"
  | "HITL"
  | "HITL_with_guardrails"
  | "HOTL"
  | "HOTL_with_guardrails"
  | "HOOTL"
  | "HOOTL_with_guardrails";

/**
 * Q32 — 8-value commitGate state enum. Today the runtime value is always
 * `"NOT_REQUIRED"` because no commit gate is wired; the other 7 values are
 * reserved vocabulary for future iterations.
 */
export type CommitGateState =
  | "NOT_REQUIRED"
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "DEFERRED"
  | "TIMED_OUT"
  | "CANCELLED"
  | "ESCALATED";

// ────────────────────────────────────────────────────────────────────────────
// Block shape.
// ────────────────────────────────────────────────────────────────────────────

export interface CommitGateBlock {
  /** Locked 8-value enum (Q32). Today always `"NOT_REQUIRED"`. */
  state:         CommitGateState;
  /** Honest one-line description of what `state` means right now. */
  description:   string;
  /**
   * Events that *would have* fired a human-approval gate if one existed.
   * Populated from the agent's `state.commitGateEvents` array. Empty array
   * (`[]`) when no such events happened — explicit, not omitted.
   */
  wouldFireAt:   CommitGateEvent[];
  /** Aggregate counts per event type for quick scan. */
  eventCounts: {
    TREASURY_VETO:             number;
    MAX_ROUNDS_REACHED:        number;
    COUNTERPARTY_REJECT_FINAL: number;
    GUARDRAIL_OVERRIDE:        number;
  };
}

export interface AutonomyBlock {
  schemaVersion: 1;
  /** The six pillars, in canonical order. Closed enum. */
  capabilitiesActive: Record<AutonomyPillar, PillarStatus>;
  /** Locked 7-value enum (DECISIONS.md addendum Item 2). */
  humanOversightPosition: HumanOversightPosition;
  /** Active guardrails as strings. Empty array if none active. */
  guardrails:    string[];
  /** Commit-gate state + would-have-fired events. */
  commitGate:    CommitGateBlock;
}

// ────────────────────────────────────────────────────────────────────────────
// Defaults — encode the locked addendum's "current state" so callers don't
// have to re-supply the same answers every call. Callers can still override
// individual pillars via opts.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Default pillar truth table for the current procurement system.
 * Maps verbatim to DECISIONS.md § 2026-05-24 Item 1.
 */
export const DEFAULT_PILLAR_STATUS: Record<AutonomyPillar, PillarStatus> = {
  goalInterpretation: {
    active:        true,
    justification: "Agent loads scenario via scenario-loader or parses CLI form via cli-parser without human relay.",
  },
  planning: {
    active:        true,
    justification: "Buyer's decideAction and seller's L2 reasoner choose the round-by-round action sequence.",
  },
  toolInvocation: {
    active:        true,
    justification: "Inventory / credit / logistics / treasury sub-agents and ACTUS contracts are invoked without per-call human approval.",
  },
  commitmentAuthority: {
    active:        true,
    justification: "Buyer auto-commits the PO/Invoice on an ACCEPT_OFFER without human approval.",
  },
  peerCommunication: {
    active:        true,
    justification: "Buyer↔seller and both↔treasury communicate directly over A2A without human relay.",
  },
  learningFromOutcome: {
    active:        false,
    justification: "No per-deal feedback loop updates agent parameters today.",
    deferredTo:    "L4_LEARNED_PROFILES_AND_PD (out of v6 audit scope)",
  },
};

/** Locked current state (DECISIONS.md addendum Item 2). */
export const DEFAULT_HUMAN_OVERSIGHT_POSITION: HumanOversightPosition = "HOOTL_with_guardrails";

/** Locked current guardrails list (DECISIONS.md addendum Item 2). */
export const DEFAULT_GUARDRAILS: readonly string[] = [
  "maxRounds=3",
  "treasury-ACTUS-veto",
  "applySellerConstraints",
] as const;

// ────────────────────────────────────────────────────────────────────────────
// Builder.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build the `autonomy` audit block.
 *
 * @param opts.commitGateEvents  Per-negotiation event array from agent state.
 *                               Pass the same array you stored on
 *                               `state.commitGateEvents`. Pass `[]` if none.
 * @param opts.pillarOverrides   Optional per-pillar overrides. Merged onto
 *                               DEFAULT_PILLAR_STATUS. Useful when a future
 *                               agent wires a pillar (e.g. learningFromOutcome).
 * @param opts.humanOversightPosition  Override the locked default. Useful
 *                               for tests that need to assert non-default values.
 * @param opts.guardrails        Override the default guardrails list.
 */
export function buildAutonomyBlock(opts: {
  commitGateEvents:         CommitGateEvent[];
  pillarOverrides?:         Partial<Record<AutonomyPillar, PillarStatus>>;
  humanOversightPosition?:  HumanOversightPosition;
  guardrails?:              string[];
  commitGateState?:         CommitGateState;
}): AutonomyBlock {
  // Build capabilitiesActive in canonical order, applying overrides per pillar.
  const capabilitiesActive = {} as Record<AutonomyPillar, PillarStatus>;
  for (const pillar of AUTONOMY_PILLAR_ORDER) {
    capabilitiesActive[pillar] = opts.pillarOverrides?.[pillar] ?? DEFAULT_PILLAR_STATUS[pillar];
  }

  const events = opts.commitGateEvents ?? [];

  // Aggregate counts per event type. All four keys always present (zero if empty).
  const eventCounts = {
    TREASURY_VETO:             0,
    MAX_ROUNDS_REACHED:        0,
    COUNTERPARTY_REJECT_FINAL: 0,
    GUARDRAIL_OVERRIDE:        0,
  };
  for (const e of events) {
    if (e.eventType in eventCounts) {
      eventCounts[e.eventType] += 1;
    }
  }

  const state: CommitGateState = opts.commitGateState ?? "NOT_REQUIRED";
  const description = COMMIT_GATE_STATE_DESCRIPTION[state];

  return {
    schemaVersion:          1,
    capabilitiesActive,
    humanOversightPosition: opts.humanOversightPosition ?? DEFAULT_HUMAN_OVERSIGHT_POSITION,
    guardrails:             [...(opts.guardrails ?? DEFAULT_GUARDRAILS)],
    commitGate: {
      state,
      description,
      wouldFireAt: events,
      eventCounts,
    },
  };
}

const COMMIT_GATE_STATE_DESCRIPTION: Record<CommitGateState, string> = {
  NOT_REQUIRED:
    "No human-approval gate exists in code today. Agent commits autonomously; wouldFireAt[] records events a future gate could have caught.",
  PENDING:     "A human-approval request has been issued and is awaiting response.",
  APPROVED:    "The human approved the agent's proposed commitment.",
  REJECTED:    "The human rejected the agent's proposed commitment.",
  DEFERRED:    "The human deferred the decision; the agent is paused on this commitment.",
  TIMED_OUT:   "The approval window elapsed without a human response.",
  CANCELLED:   "The approval request was withdrawn (agent or counterparty).",
  ESCALATED:   "The approval was escalated to a higher authority than the initially-asked human.",
};
