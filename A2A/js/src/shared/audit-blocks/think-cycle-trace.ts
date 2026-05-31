// ================= AUDIT FRAMEWORK V6 — THINK CYCLE TRACE BUILDER =================
// Iter 4 (DECISIONS addendum 2026-05-25). Emits the 5-step think cycle
// from FRAMEWORK-V2 §6 on the seller audit only (Item 1).
//
// Five steps (verbatim from V2 §6 / DECISIONS Item 1):
//   1. receiveOffer        — receive buyer offer + load state
//   2. advisorConsultation — call advisors in parallel
//   3. mathAggregator      — effective floor / NBS / utility
//   4. geminiCall          — build prompt, call Gemini, get response
//   5. guardrails          — apply tier-appropriate guardrails to LLM output
//
// Scoping (DECISIONS Item 0 + Q-iter4-A option (b)):
//   - L2_EXECUTIVE_REASONER+: all 5 steps populated (the structure genuinely exists)
//   - BASIC_SALES_QUOTING_1 / L1_DELEGATED_ADVISORS: only steps 4 + 5 populated
//     (steps 1–3 don't structurally exist — there's no advisor pipeline,
//     no math aggregator, no executive synthesis). Each entry's `mode` marker
//     identifies which mode produced it so a reader can interpret the partial.
//
// Step 4 specifics (DECISIONS Items 2 + 3):
//   - gen_ai.* fields named per OTel semconv (dot-separated keys)
//   - Honest superset of what the Gemini SDK returns — fields the SDK didn't
//     return are OMITTED (not nulled). On non-GEMINI_OK decisionPaths, the
//     gen_ai.usage.* keys are omitted because the SDK didn't provide them.
//   - prompt.hash is always present when the prompt was built
//   - prompt.text is gated by env var AUDIT_INCLUDE_PROMPT_TEXT (default true);
//     when "false", the .text key is OMITTED entirely (not nulled).
//
// Top-level scope marker (DECISIONS Item 8): `thinkCycleTraceScope: "seller-only"`.

import type { LLMResponseWithAudit } from "../llm-client.js";

// ────────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────────

/** Minimal view of an LLM call's audit metadata, as surfaced by llm-client. */
export type LLMCallAuditMinimal = NonNullable<LLMResponseWithAudit["audit"]>;

/**
 * Per-round inputs to the think-cycle-trace builder. The caller (seller-agent)
 * normalizes its own state into this shape; the builder does not depend on
 * any L2-specific types directly (loose coupling between audit-blocks/ and
 * agent internals).
 *
 * Any step subfield being undefined means "this step did not run for this
 * round" — the builder emits the step entry only when its subfield is
 * present. This is how BASIC/L1 mode honesty works: the caller supplies
 * step1/2/3 as undefined.
 */
export interface ThinkCycleRoundInputs {
    round: number;
    /** SellerResponseMode value, used for the per-entry `mode` marker. */
    mode:  string;

    /** Step 1 — receiveOffer. Always present in any mode where a deal ran. */
    step1_receiveOffer?: {
        incomingOffer:    number;
        timestamp:        string;
        /** Optional context fields observable at this step. */
        lastSellerOffer?: number;
        historyLength?:   number;
    };

    /** Step 2 — advisorConsultation. Present only when advisors were called (L2+). */
    step2_advisorConsultation?: {
        /** Which advisors were called this round (names only, not contents). */
        advisorsCalled:   string[];
        /** Per-advisor success boolean — derived from the ConsultationBundle. */
        advisorOutcomes:  Record<string, { success: boolean; note?: string }>;
        /** Router latency, when measured. */
        routerLatencyMs?: number;
    };

    /** Step 3 — mathAggregator. Present only when advisor math ran (L2+). */
    step3_mathAggregator?: {
        /** Observable outputs of the math aggregator + tactics trace. */
        tacticsTrace?:    Record<string, unknown>;
        effectiveFloor?:  number;
        utility?:         number;
    };

    /**
     * Step 4 — geminiCall. Present whenever an LLM call was attempted (BASIC
     * to L2+). Absent only when the round was decided by rules-fallback alone
     * with no LLM call (rare; usually there's at least an attempted call
     * even on fallback paths).
     */
    step4_geminiCall?: {
        llmAudit: LLMCallAuditMinimal;
    };

    /**
     * Step 5 — guardrails. Present whenever any constraint adjustment or
     * defensive action was considered (always, even when no override fired
     * — the absence of an override is itself observable output).
     */
    step5_guardrails?: {
        llmProposed:           { action: string; price?: number };
        finalAfterGuardrails:  { action: string; price?: number };
        overrideApplied:       boolean;
        overrideReason?:       string;
        /** Which guardrail produced the override. Free-form. */
        overrideSource?:       string;
        /** L2 path only: defensive actions logged this round. */
        defensiveActions?:     Array<Record<string, unknown>>;
    };
}

/** One step in a per-round entry. Index signature allows OTel dot-keyed fields. */
export interface ThinkCycleStep {
    stepNumber: 1 | 2 | 3 | 4 | 5;
    stepName:   "receiveOffer" | "advisorConsultation" | "mathAggregator" | "geminiCall" | "guardrails";
    [k: string]: unknown;
}

/** One round in `thinkCycleTrace[]`. */
export interface ThinkCycleTraceEntry {
    round: number;
    /** SellerResponseMode marker — helps a reader interpret which steps are present. */
    mode:  string;
    steps: ThinkCycleStep[];
}

/** Return type of buildThinkCycleTrace — array + scope marker (Item 8). */
export interface ThinkCycleTraceBlock {
    thinkCycleTraceScope: "seller-only";
    thinkCycleTrace:      ThinkCycleTraceEntry[];
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Read `AUDIT_INCLUDE_PROMPT_TEXT` env var. Default true. The literal string
 * "false" (case-insensitive) opts out. Resolves at call time so a flip can
 * take effect at the next deal-close without restart.
 */
function shouldIncludePromptText(): boolean {
    const raw = (process.env.AUDIT_INCLUDE_PROMPT_TEXT ?? "true").toLowerCase().trim();
    return raw !== "false";
}

/**
 * Build the step-4 object. Maps llm-client audit fields onto OTel semconv
 * keys, omitting (not nulling) fields the SDK didn't return.
 *
 * gen_ai.usage.* keys are emitted ONLY when decisionPath === "GEMINI_OK"
 * (the only path where the SDK actually returned usage metadata). On
 * fallback paths, the 0-defaults inside llm-client are stand-ins for
 * missing data; per Item 0 we omit rather than emit stand-in zeros.
 */
function buildStep4(audit: LLMCallAuditMinimal): ThinkCycleStep {
    const step: ThinkCycleStep = {
        stepNumber: 4,
        stepName:   "geminiCall",
        "gen_ai.system":        "gemini",
        "gen_ai.request.model": audit.modelRequested,
    };

    // OTel: emit response.model only when it differs from request.model
    // (e.g. provider rerouted the request — Gemini does not, but be honest).
    if (audit.modelUsed && audit.modelUsed !== audit.modelRequested) {
        step["gen_ai.response.model"] = audit.modelUsed;
    }

    // Usage fields are emitted only on the success path (Item 0: omit missing).
    if (audit.decisionPath === "GEMINI_OK") {
        if (audit.promptTokens     !== undefined) step["gen_ai.usage.input_tokens"]  = audit.promptTokens;
        if (audit.completionTokens !== undefined) step["gen_ai.usage.output_tokens"] = audit.completionTokens;
        if (audit.totalTokens      !== undefined) step["gen_ai.usage.total_tokens"]  = audit.totalTokens;
    }

    // Project-specific extension fields (NOT OTel) — namespaced under `gemini.`
    // so a reader can see they're project-defined, not standard semconv.
    step["gemini.latencyMs"]     = audit.latencyMs;
    step["gemini.decisionPath"]  = audit.decisionPath;
    step["gemini.retries"]       = audit.retries;
    if (audit.estimatedCostUSD !== undefined && audit.decisionPath === "GEMINI_OK") {
        step["gemini.estimatedCostUSD"] = audit.estimatedCostUSD;
    }

    // Prompt capture (Items 2 + 3). hash always when prompt was built; text
    // gated by AUDIT_INCLUDE_PROMPT_TEXT. When the prompt was never built
    // (GEMINI_TOKEN_CEILING_REACHED), llm-client omits `prompt` entirely.
    if (audit.prompt) {
        step["prompt.hash"] = audit.prompt.hash;
        if (shouldIncludePromptText()) {
            step["prompt.text"] = audit.prompt.text;
        }
        // else: .text key omitted entirely (Item 3 — omit, not null).
    }

    return step;
}

function buildStep1(s: NonNullable<ThinkCycleRoundInputs["step1_receiveOffer"]>): ThinkCycleStep {
    const step: ThinkCycleStep = {
        stepNumber:    1,
        stepName:      "receiveOffer",
        incomingOffer: s.incomingOffer,
        timestamp:     s.timestamp,
    };
    if (s.lastSellerOffer !== undefined) step.lastSellerOffer = s.lastSellerOffer;
    if (s.historyLength   !== undefined) step.historyLength   = s.historyLength;
    return step;
}

function buildStep2(s: NonNullable<ThinkCycleRoundInputs["step2_advisorConsultation"]>): ThinkCycleStep {
    const step: ThinkCycleStep = {
        stepNumber:      2,
        stepName:        "advisorConsultation",
        advisorsCalled:  s.advisorsCalled,
        advisorOutcomes: s.advisorOutcomes,
    };
    if (s.routerLatencyMs !== undefined) step.routerLatencyMs = s.routerLatencyMs;
    return step;
}

function buildStep3(s: NonNullable<ThinkCycleRoundInputs["step3_mathAggregator"]>): ThinkCycleStep {
    const step: ThinkCycleStep = {
        stepNumber: 3,
        stepName:   "mathAggregator",
    };
    if (s.tacticsTrace    !== undefined) step.tacticsTrace    = s.tacticsTrace;
    if (s.effectiveFloor  !== undefined) step.effectiveFloor  = s.effectiveFloor;
    if (s.utility         !== undefined) step.utility         = s.utility;
    return step;
}

function buildStep5(s: NonNullable<ThinkCycleRoundInputs["step5_guardrails"]>): ThinkCycleStep {
    const step: ThinkCycleStep = {
        stepNumber:           5,
        stepName:             "guardrails",
        llmProposed:          s.llmProposed,
        finalAfterGuardrails: s.finalAfterGuardrails,
        overrideApplied:      s.overrideApplied,
    };
    if (s.overrideReason   !== undefined) step.overrideReason   = s.overrideReason;
    if (s.overrideSource   !== undefined) step.overrideSource   = s.overrideSource;
    if (s.defensiveActions !== undefined) step.defensiveActions = s.defensiveActions;
    return step;
}

// ────────────────────────────────────────────────────────────────────────────
// Main builder
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build the thinkCycleTrace block. Inputs come from the seller's state +
 * accumulators at deal close.
 *
 * Per round, emit one ThinkCycleTraceEntry. Each entry contains only the
 * steps whose inputs are present. In L2 mode the caller supplies all 5
 * step subfields; in BASIC/L1 the caller supplies only step4 + step5,
 * and the entry has only those two steps in its `steps[]` array (DECISIONS
 * Q-iter4-A option (b)).
 */
export function buildThinkCycleTrace(rounds: ThinkCycleRoundInputs[]): ThinkCycleTraceBlock {
    const entries: ThinkCycleTraceEntry[] = rounds.map((r) => {
        const steps: ThinkCycleStep[] = [];
        if (r.step1_receiveOffer)        steps.push(buildStep1(r.step1_receiveOffer));
        if (r.step2_advisorConsultation) steps.push(buildStep2(r.step2_advisorConsultation));
        if (r.step3_mathAggregator)      steps.push(buildStep3(r.step3_mathAggregator));
        if (r.step4_geminiCall)          steps.push(buildStep4(r.step4_geminiCall.llmAudit));
        if (r.step5_guardrails)          steps.push(buildStep5(r.step5_guardrails));
        return {
            round: r.round,
            mode:  r.mode,
            steps,
        };
    });

    return {
        thinkCycleTraceScope: "seller-only",
        thinkCycleTrace:      entries,
    };
}
