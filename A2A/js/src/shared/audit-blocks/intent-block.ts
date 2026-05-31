// ================= AUDIT FRAMEWORK V6 — INTENT BLOCK ========================
// Iter 3. Emits the `intent` audit block: what the agent was told to do
// (the declared mandate) and how the actual deal outcome compared to it.
//
// Sources of data:
//   - `scenarioIntent?` on the agent's state (set in startNegotiation for the
//     buyer; set in handleBuyerOffer for the seller from OfferData.scenarioIntent).
//   - `actualOutcome` extracted from the deal-close state by the caller and
//     passed into `buildIntentBlock`.
//
// Acceptance tests (per AUDIT-FRAMEWORK-V6-ITERATION-PLAN.md Part 3 Iter 3):
//   T1: For a known scenario (e.g. `happy-path-cotton`),
//       `intent.expectedOutcome.likely` matches the scenario verbatim.
//   T2: `deviationFromIntent.dimensions[]` flags any case where the actual
//       outcome diverges from the declared intent.
//
// Vocabulary (locked in AUDIT-FRAMEWORK-V6-DECISIONS.md § "2026-05-24" Items 3 & 4):
//   - expectedOutcome.shape:  PRICE_RANGE_CLOSE | POINT_CLOSE | ESCALATION_EXPECTED
//                             | ABANDON_EXPECTED | FREE_TEXT
//   - dimensions[].dimension: outcomeShape | pricePerUnit | roundCount
//                             | productMismatch | quantityMismatch
//   - severity:               high | medium | low | none
//   - intentSource:           SCENARIO_DECLARED | AGENT_DEFAULT_CONFIG | NONE

import type {
  BuyerIntent,
  SellerIntent,
  Situation,
  ExpectedOutcome,
  ScenarioIntentExcerpt,
} from "../intent-types.js";
import type { AgentRole, NegotiationStatus } from "../negotiation-types.js";

// ────────────────────────────────────────────────────────────────────────────
// Locked enum types (see AUDIT-FRAMEWORK-V6-DECISIONS.md addendum Items 3/4).
// ────────────────────────────────────────────────────────────────────────────

export type IntentSource =
  | "SCENARIO_DECLARED"     // buyer was started with `--scenario <id>`
  | "AGENT_DEFAULT_CONFIG"  // no scenario; falling back to agent hardcoded defaults
  | "NONE";                 // defensive default; nothing known

export type ExpectedOutcomeShape =
  | "PRICE_RANGE_CLOSE"
  | "POINT_CLOSE"
  | "ESCALATION_EXPECTED"
  | "ABANDON_EXPECTED"
  | "FREE_TEXT";

export type DeviationDimensionName =
  | "outcomeShape"
  | "pricePerUnit"
  | "roundCount"
  | "productMismatch"
  | "quantityMismatch";

export type DeviationSeverity = "high" | "medium" | "low" | "none";

// ────────────────────────────────────────────────────────────────────────────
// Block shape (sibling-field discriminator pattern per Q31 Option A).
// ────────────────────────────────────────────────────────────────────────────

export interface IntentExpectedOutcomeBlock {
  /** Discriminator. Inferred from `likely` by `inferExpectedOutcomeShape`. */
  shape:        ExpectedOutcomeShape;
  /** Verbatim from scenario.expectedOutcome.likely. */
  likely:       string;
  /** Verbatim from scenario, when present. */
  possible?:    string;
  /** Verbatim from scenario, when present. */
  failureMode?: string;
  /** Derived only when shape === "PRICE_RANGE_CLOSE". */
  priceRange?: {
    minPerUnit: number;
    maxPerUnit: number;
    currency:   "INR" | "USD";
  };
  /** Derived only when a round count or range was parseable from `likely`. */
  roundRange?: {
    minRounds: number;
    maxRounds: number;
  };
}

export interface DeviationDimensionEntry {
  dimension: DeviationDimensionName;
  expected:  string;        // human-readable expected value
  actual:    string;        // human-readable actual value
  severity:  DeviationSeverity;
  note:      string;
}

export interface DeviationFromIntentBlock {
  /**
   * Empty array (`[]`) when there is no deviation OR no declared intent.
   * Never omitted, so absence is distinguishable from "never declared".
   */
  dimensions: DeviationDimensionEntry[];
  /** Summary severity = max severity across dimensions. "none" if empty. */
  overallSeverity: DeviationSeverity;
}

export interface IntentBlock {
  schemaVersion: 1;
  perspective:   AgentRole;
  intentSource:  IntentSource;
  /** Present when intentSource === "SCENARIO_DECLARED". */
  scenarioId?:    string;
  scenarioTitle?: string;
  /**
   * Buyer mandate. Present on both sides' audits when the scenario was
   * propagated; otherwise present only on the buyer audit (derived from
   * agent default config) and absent on the seller audit.
   */
  buyerIntent?:  BuyerIntent;
  /** Seller mandate. See `buyerIntent` for symmetry rules. */
  sellerIntent?: SellerIntent;
  /** Situation block (product, quantity, market hint). */
  situation?:    Situation;
  /** Expected outcome with locked `shape` discriminator. */
  expectedOutcome: IntentExpectedOutcomeBlock;
  /** Deviation analysis at deal close. */
  deviationFromIntent: DeviationFromIntentBlock;
}

// ────────────────────────────────────────────────────────────────────────────
// Heuristic: infer the expectedOutcome.shape from the scenario's `likely`
// free-text string. Honest fallback to FREE_TEXT; no false precision.
//
// Regex strategy:
//   1. Escalation keyword wins first (most-specific intent signal).
//   2. Abandon keyword wins second.
//   3. Price range (two numbers with separator) → PRICE_RANGE_CLOSE.
//   4. Single price target with action verb (closes/lands/settles at) → POINT_CLOSE.
//   5. Otherwise FREE_TEXT.
//
// roundRange parsing is independent and may co-exist with any shape value.
// ────────────────────────────────────────────────────────────────────────────

const ESCALATION_RE = /\bescalat/i;
const ABANDON_RE    = /\b(abandon|walk[\s-]?away)\b/i;

// Matches "₹370–₹390", "370-390", "370 to 390", "₹370 to ₹390" — captures
// two numbers separated by an en-dash, hyphen, or "to". Currency-symbol-agnostic.
const PRICE_RANGE_RE = /(?:[₹$]?\s*)(\d{2,5})\s*(?:[–\-—]|to)\s*(?:[₹$]?\s*)(\d{2,5})/i;

// Matches "closes at ₹373" / "lands at 380" / "settles at ₹400" — a single
// numeric target after a verb. Used only when PRICE_RANGE_RE does not match.
const POINT_CLOSE_RE = /\b(?:closes?|lands?|settles?|agrees?)\s+at\s+(?:[₹$]?\s*)(\d{2,5})/i;

// Matches "in 2–3 rounds" / "in 3 rounds" — captures one or two integers
// associated with the noun "rounds".
const ROUND_RANGE_RE = /(?:in\s+)?(\d{1,2})\s*(?:[–\-—]\s*(\d{1,2})\s*)?rounds?/i;

export function inferExpectedOutcomeShape(likely: string): {
  shape:       ExpectedOutcomeShape;
  priceRange?: IntentExpectedOutcomeBlock["priceRange"];
  roundRange?: IntentExpectedOutcomeBlock["roundRange"];
} {
  if (!likely || typeof likely !== "string") {
    return { shape: "FREE_TEXT" };
  }

  // Round-range is independent of shape and parsed first so any shape
  // outcome can carry it. Caller decides whether to include it.
  let roundRange: IntentExpectedOutcomeBlock["roundRange"] | undefined;
  const roundMatch = likely.match(ROUND_RANGE_RE);
  if (roundMatch) {
    const a = parseInt(roundMatch[1], 10);
    const b = roundMatch[2] ? parseInt(roundMatch[2], 10) : a;
    if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0 && b <= 50) {
      roundRange = { minRounds: Math.min(a, b), maxRounds: Math.max(a, b) };
    }
  }

  if (ESCALATION_RE.test(likely)) {
    return { shape: "ESCALATION_EXPECTED", roundRange };
  }
  if (ABANDON_RE.test(likely)) {
    return { shape: "ABANDON_EXPECTED", roundRange };
  }

  const rangeMatch = likely.match(PRICE_RANGE_RE);
  if (rangeMatch) {
    const a = parseInt(rangeMatch[1], 10);
    const b = parseInt(rangeMatch[2], 10);
    if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0) {
      // Currency inferred from presence of ₹ vs $. Default INR for this project.
      const currency: "INR" | "USD" = /\$/.test(likely) ? "USD" : "INR";
      return {
        shape: "PRICE_RANGE_CLOSE",
        priceRange: {
          minPerUnit: Math.min(a, b),
          maxPerUnit: Math.max(a, b),
          currency,
        },
        roundRange,
      };
    }
  }

  const pointMatch = likely.match(POINT_CLOSE_RE);
  if (pointMatch) {
    const v = parseInt(pointMatch[1], 10);
    if (Number.isFinite(v) && v > 0) {
      const currency: "INR" | "USD" = /\$/.test(likely) ? "USD" : "INR";
      return {
        shape: "POINT_CLOSE",
        priceRange: { minPerUnit: v, maxPerUnit: v, currency },
        roundRange,
      };
    }
  }

  return { shape: "FREE_TEXT", roundRange };
}

// ────────────────────────────────────────────────────────────────────────────
// Deviation analysis. Compares the parsed expected outcome against the
// actual deal-close facts and produces a closed-vocabulary list of
// dimensions that deviated.
// ────────────────────────────────────────────────────────────────────────────

/** Facts about the actual deal at close. All optional except status. */
export interface ActualOutcomeFacts {
  /** Final status from the agent's state. */
  status:         NegotiationStatus;
  /** Unit price agreed at close, if a deal was struck. */
  finalPrice?:    number;
  /** Quantity at close. */
  finalQuantity?: number;
  /** Product code at close. */
  finalProduct?:  string;
  /** Rounds actually used (currentRound at close). */
  roundsUsed?:    number;
}

/**
 * Map NegotiationStatus → the ExpectedOutcomeShape that it "looks like".
 * Used by the outcomeShape deviation check.
 */
function statusToShape(status: NegotiationStatus): ExpectedOutcomeShape {
  switch (status) {
    case "ACCEPTED":
    case "COMPLETED":
    case "DD_COMPLETED":
      return "PRICE_RANGE_CLOSE"; // closed deals look like a price-close outcome
    case "ESCALATED":
      return "ESCALATION_EXPECTED";
    case "FAILED":
    case "REJECTED":
      return "ABANDON_EXPECTED";
    case "INITIATED":
    case "NEGOTIATING":
    default:
      return "FREE_TEXT";
  }
}

const SEVERITY_RANK: Record<DeviationSeverity, number> = {
  none: 0, low: 1, medium: 2, high: 3,
};

function maxSeverity(a: DeviationSeverity, b: DeviationSeverity): DeviationSeverity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

export function computeDeviationDimensions(
  expected:  IntentExpectedOutcomeBlock,
  situation: Situation | undefined,
  actual:    ActualOutcomeFacts,
): DeviationDimensionEntry[] {
  const out: DeviationDimensionEntry[] = [];

  // 1. outcomeShape — most important. Did the deal go the way the author expected?
  const actualShape = statusToShape(actual.status);
  // FREE_TEXT expected means we cannot say anything; skip that dimension entirely.
  if (expected.shape !== "FREE_TEXT" && actualShape !== expected.shape) {
    // ESCALATION_EXPECTED ↔ actual escalation is a match even though the
    // ordinal comparison fails; statusToShape already handles this.
    out.push({
      dimension: "outcomeShape",
      expected:  expected.shape,
      actual:    `${actual.status} (${actualShape})`,
      severity:  "high",
      note:      "Final negotiation status does not match the declared expectedOutcome.shape.",
    });
  }

  // 2. pricePerUnit — only meaningful when a deal closed AND we have a parsed range.
  if (
    expected.priceRange &&
    typeof actual.finalPrice === "number" &&
    (actual.status === "ACCEPTED" || actual.status === "COMPLETED" || actual.status === "DD_COMPLETED")
  ) {
    const lo = expected.priceRange.minPerUnit;
    const hi = expected.priceRange.maxPerUnit;
    if (actual.finalPrice < lo || actual.finalPrice > hi) {
      // How far outside? Drives severity.
      const reference = (lo + hi) / 2;
      const deltaPct = Math.abs(actual.finalPrice - reference) / reference;
      const severity: DeviationSeverity =
        deltaPct >= 0.15 ? "high"
        : deltaPct >= 0.05 ? "medium"
        : "low";
      out.push({
        dimension: "pricePerUnit",
        expected:  `${lo}–${hi} ${expected.priceRange.currency}`,
        actual:    `${actual.finalPrice} ${expected.priceRange.currency}`,
        severity,
        note:      `Final price ${actual.finalPrice} is outside the declared range ${lo}–${hi}.`,
      });
    }
  }

  // 3. roundCount — only meaningful when we parsed a range AND have actual rounds.
  if (expected.roundRange && typeof actual.roundsUsed === "number") {
    const lo = expected.roundRange.minRounds;
    const hi = expected.roundRange.maxRounds;
    if (actual.roundsUsed < lo || actual.roundsUsed > hi) {
      const overshoot = Math.max(0, actual.roundsUsed - hi);
      const severity: DeviationSeverity =
        overshoot >= 3 ? "high"
        : overshoot >= 1 ? "medium"
        : "low";
      out.push({
        dimension: "roundCount",
        expected:  `${lo}–${hi} rounds`,
        actual:    `${actual.roundsUsed} rounds`,
        severity,
        note:      `Round count ${actual.roundsUsed} is outside the declared range ${lo}–${hi}.`,
      });
    }
  }

  // 4. productMismatch — only when both sides know a product.
  if (situation?.product && actual.finalProduct && situation.product !== actual.finalProduct) {
    out.push({
      dimension: "productMismatch",
      expected:  situation.product,
      actual:    actual.finalProduct,
      severity:  "high",
      note:      "Closed product differs from the declared situation.product.",
    });
  }

  // 5. quantityMismatch — only when both sides know a quantity.
  if (
    typeof situation?.quantity === "number" &&
    typeof actual.finalQuantity === "number" &&
    situation.quantity !== actual.finalQuantity
  ) {
    const expectedQty = situation.quantity;
    const deltaPct = Math.abs(actual.finalQuantity - expectedQty) / Math.max(expectedQty, 1);
    const severity: DeviationSeverity =
      deltaPct >= 0.10 ? "high"
      : deltaPct >= 0.02 ? "medium"
      : "low";
    out.push({
      dimension: "quantityMismatch",
      expected:  String(expectedQty),
      actual:    String(actual.finalQuantity),
      severity,
      note:      "Closed quantity differs from the declared situation.quantity.",
    });
  }

  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Builder.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build the `intent` audit block.
 *
 * @param opts.perspective     "BUYER" or "SELLER" — whose audit this is.
 * @param opts.scenarioIntent  ScenarioIntentExcerpt captured on agent state.
 *                             When undefined, intentSource is computed from
 *                             `opts.defaultBuyerIntent` / `opts.defaultSellerIntent`
 *                             being present (AGENT_DEFAULT_CONFIG) or absent (NONE).
 * @param opts.actual          Facts extracted from deal-close state.
 * @param opts.defaultBuyerIntent  Used only when scenarioIntent is undefined
 *                             AND perspective is BUYER. Optional fallback so
 *                             the buyer's audit can still describe its own
 *                             mandate from CLI-supplied defaults.
 * @param opts.defaultSellerIntent  Same but for SELLER.
 * @param opts.defaultSituation Same: used to build a minimal Situation block
 *                             when no scenario was declared.
 */
export function buildIntentBlock(opts: {
  perspective:           AgentRole;
  scenarioIntent?:       ScenarioIntentExcerpt;
  actual:                ActualOutcomeFacts;
  defaultBuyerIntent?:   BuyerIntent;
  defaultSellerIntent?:  SellerIntent;
  defaultSituation?:     Situation;
}): IntentBlock {
  const { perspective, scenarioIntent, actual } = opts;

  let intentSource: IntentSource;
  let buyerIntent:  BuyerIntent  | undefined;
  let sellerIntent: SellerIntent | undefined;
  let situation:    Situation    | undefined;
  let expected:     ExpectedOutcome;
  let scenarioId:    string | undefined;
  let scenarioTitle: string | undefined;

  if (scenarioIntent) {
    intentSource  = "SCENARIO_DECLARED";
    scenarioId    = scenarioIntent.scenarioId;
    scenarioTitle = scenarioIntent.scenarioTitle;
    buyerIntent   = scenarioIntent.buyerIntent;
    sellerIntent  = scenarioIntent.sellerIntent;
    situation     = scenarioIntent.situation;
    expected      = scenarioIntent.expectedOutcome;
  } else if (opts.defaultBuyerIntent || opts.defaultSellerIntent || opts.defaultSituation) {
    intentSource  = "AGENT_DEFAULT_CONFIG";
    buyerIntent   = perspective === "BUYER"  ? opts.defaultBuyerIntent  : undefined;
    sellerIntent  = perspective === "SELLER" ? opts.defaultSellerIntent : undefined;
    situation     = opts.defaultSituation;
    expected      = {
      likely: "No expectedOutcome declared (agent-default config; bare CLI form).",
    };
  } else {
    intentSource = "NONE";
    expected     = {
      likely: "No intent declared.",
    };
  }

  // Infer the shape discriminator + parsed sub-fields from the free-text `likely`.
  const inferred = inferExpectedOutcomeShape(expected.likely);

  const expectedOutcome: IntentExpectedOutcomeBlock = {
    shape:       inferred.shape,
    likely:      expected.likely,
    possible:    expected.possible,
    failureMode: expected.failureMode,
    priceRange:  inferred.priceRange,
    roundRange:  inferred.roundRange,
  };

  // Compute deviation. Empty array when no declared intent — explicit, not omitted.
  const dimensions = intentSource === "SCENARIO_DECLARED"
    ? computeDeviationDimensions(expectedOutcome, situation, actual)
    : [];

  let overallSeverity: DeviationSeverity = "none";
  for (const d of dimensions) overallSeverity = maxSeverity(overallSeverity, d.severity);

  return {
    schemaVersion: 1,
    perspective,
    intentSource,
    scenarioId,
    scenarioTitle,
    buyerIntent,
    sellerIntent,
    situation,
    expectedOutcome,
    deviationFromIntent: { dimensions, overallSeverity },
  };
}
