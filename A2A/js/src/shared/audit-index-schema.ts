// ================= AUDIT FRAMEWORK V6 — INDEX.JSONL LINE SCHEMA =================
// One line per audit (one buyer line + one seller line per closed deal).
// Used by `index-jsonl-writer.ts` (writer) and the future Iteration 6 SQLite
// sidecar (reader).
//
// The shape is intentionally flat — every field is a primitive or a short
// fixed enum. Nested arrays (decisions[], thinkCycleTrace[], etc.) live
// inside the per-deal audit JSON; this index is for fast cross-deal scans
// (e.g. "all escalations this week", "all deals over $10M").
//
// Total fields: ~30 (per v6 design §3). Field set is locked for v6 — adding
// new fields means a new schema version.

/**
 * One line written to `audits/index.jsonl` per audit write.
 *
 * The writer (`index-jsonl-writer.ts`) appends one JSON-encoded object per
 * line (newline-delimited JSON, RFC 7159).
 */
export interface AuditIndexLine {
  // ── Schema versioning ─────────────────────────────────────────────────
  /** Schema version. Bumped when fields are added or removed. */
  schemaVersion: 1;

  // ── Identity ──────────────────────────────────────────────────────────
  /** Full negotiation ID. e.g. "NEG-1779515273352" */
  negotiationId: string;

  /** Which side wrote this audit line. */
  perspective: "BUYER" | "SELLER";

  /**
   * Relative path from `audits/` root to the per-deal audit JSON this line
   * indexes. Reader uses this to load the full audit on demand.
   * e.g. "2026-05-23/NEG-1779515273352/buyer.audit.json"
   */
  auditFile: string;

  // ── Timestamps ────────────────────────────────────────────────────────
  /** When the negotiation started. ISO 8601 UTC. */
  startedAt: string;

  /** When this audit was written. ISO 8601 UTC. */
  generatedAt: string;

  // ── Outcome ───────────────────────────────────────────────────────────
  /** Deal outcome. Mirrors the audit JSON's top-level `outcome` field. */
  outcome: "success" | "escalation";

  /** Final agreed price per unit, in the deal's currency. Null on escalation. */
  finalPrice: number | null;

  /** Total quantity in units. */
  quantity: number;

  /** Total deal value (finalPrice * quantity), null on escalation. */
  totalDealValue: number | null;

  /** Deal currency. */
  currency: string;

  // ── Negotiation shape ─────────────────────────────────────────────────
  /** Rounds actually used (1-based). */
  roundsUsed: number;

  /** Maximum rounds allowed for this deal. */
  maxRounds: number;

  // ── Counterparties ────────────────────────────────────────────────────
  /** LEI of the agent that wrote this audit (own side). */
  selfLei?: string;

  /** Legal entity name of the agent that wrote this audit. */
  selfEntityName?: string;

  /** LEI of the counterparty agent. */
  counterpartyLei?: string;

  /** Legal entity name of the counterparty. */
  counterpartyEntityName?: string;

  // ── Mode + posture ────────────────────────────────────────────────────
  /** Credential mode at deal close. "plain" today; "vlei" deferred to iter 14. */
  credentialMode: "plain" | "vlei";

  /**
   * Self-process mode resolved for this agent at deal close (was named
   * `sellerResponseMode` pre-v6; renamed per CONT8 Finding #1).
   * One of: "BASIC_SALES_QUOTING_1" | "L1_DELEGATED_ADVISORS" |
   * "L2_EXECUTIVE_REASONER" | "L3_STYLE_AND_AUTONOMY" | "L4_LEARNED_PROFILES_AND_PD"
   */
  selfProcessMode?: string;

  /**
   * Seller's live mode at deal close, fetched from seller's /api/self/mode-status.
   * Buyer-perspective audits only; null on seller-side audits.
   * Null when fetch failed.
   */
  sellerLiveMode?: string | null;

  // ── Quality metrics (mirrors outcomeQuality block) ────────────────────
  /** Whether the deal closed (true) or escalated (false). */
  closed: boolean;

  /** Buyer's reservation price (max willing to pay), null when unknown. */
  buyerMax: number | null;

  /** Seller's reservation price (min willing to accept), null when unknown. */
  sellerMin: number | null;

  /** Zone of Possible Agreement was non-empty (high >= low). */
  zopaFeasible?: boolean;

  /** Final agreement landed inside the ZOPA. */
  outsideZopa?: boolean;

  // ── Decision-trail summary ────────────────────────────────────────────
  /** Number of entries in the decisions[] array of the audit JSON. */
  decisionCount: number;

  // ── Treasury summary (seller-only) ────────────────────────────────────
  /** Whether treasury override was applied in at least one round. */
  treasuryOverrideApplied?: boolean;

  /** Final treasury-approved NPV, if treasury ran. */
  treasuryFinalNPV?: number;
}
