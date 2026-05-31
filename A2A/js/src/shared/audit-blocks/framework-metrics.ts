// ================= AUDIT FRAMEWORK V6 — FRAMEWORK METRICS BUILDER =================
// Iter 5 (DECISIONS addendum 2026-05-25, Item 1). Emits the `frameworkMetrics`
// block on BOTH the buyer audit and the seller audit. Cost / outcome /
// risk-avoided summary in one place so a regulator or CFO reading the audit
// can answer "what did this deal cost, what did it accomplish, what risk did
// it dodge" without navigating to four different blocks.
//
// Scope marker: `frameworkMetricsScope: "both"` (DECISIONS iter-5 Item 5).
//
// Design (DECISIONS iter-5 Item 1):
//   - cost.totalCostUSD = sum of estimatedCostUSD across every Gemini call
//     made by THIS side of the deal. Source for seller = walking
//     thinkCycleTrace[].steps[stepName=geminiCall].gemini.estimatedCostUSD.
//     Source for buyer = wherever buyer-agent stores its LLM telemetry.
//     The builder is agnostic; callers normalize to the typed input shape.
//   - cost.byModel keyed by gen_ai.request.model.
//   - When a side made zero LLM calls, totalCostUSD = 0 and byModel = {}
//     (Item 0 honesty — emit, don't omit).
//   - outcome.surplusCapturedShare is sourced from
//     outcomeQuality.surplusSplit.<side>Share. Null when deal didn't close.
//   - riskAvoided mirrors autonomy.commitGate.eventCounts (iter-3 addendum
//     Item 5) into the metrics block so a one-block reader has the summary.

// ────────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────────

export interface FrameworkMetricsCost {
    totalCostUSD: number;
    currency:     "USD";
    byModel:      Record<string, {
        calls:        number;
        inputTokens:  number;
        outputTokens: number;
        costUSD:      number;
    }>;
    perCallSource: string;
}

export interface FrameworkMetricsOutcome {
    closed:               boolean;
    finalPrice:           number | null;
    currency:             string;
    surplusCapturedShare: number | null;
}

export interface FrameworkMetricsRiskAvoided {
    treasuryVetoes:          number;
    maxRoundsReached:        number;
    counterpartyRejectFinal: number;
    guardrailOverrides:      number;
    source:                  string;
}

export interface FrameworkMetricsInputs {
    cost:        FrameworkMetricsCost;
    outcome:     FrameworkMetricsOutcome;
    riskAvoided: FrameworkMetricsRiskAvoided;
}

export interface FrameworkMetricsBlock {
    frameworkMetricsScope: "both";
    cost:                  FrameworkMetricsCost;
    outcome:               FrameworkMetricsOutcome;
    riskAvoided:           FrameworkMetricsRiskAvoided;
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers used by logger.ts when extracting from an assembled audit object
// ────────────────────────────────────────────────────────────────────────────

/**
 * Walk a seller audit's thinkCycleTrace[] and aggregate per-model Gemini
 * costs and token counts. Returns the FrameworkMetricsCost shape ready to
 * pass to buildFrameworkMetrics.
 *
 * Tolerant of missing fields (Item 0): a step with no estimatedCostUSD
 * contributes 0; a step with no gen_ai.request.model is skipped (we don't
 * know which model bucket to credit it to).
 */
export function aggregateSellerCostFromThinkCycleTrace(
    thinkCycleTrace: Array<{ steps?: Array<Record<string, unknown>> }> | undefined
): FrameworkMetricsCost {
    const byModel: FrameworkMetricsCost["byModel"] = {};
    let totalCostUSD = 0;

    if (thinkCycleTrace) {
        for (const round of thinkCycleTrace) {
            for (const step of round.steps ?? []) {
                if (step["stepName"] !== "geminiCall") continue;
                const model = (step["gen_ai.request.model"] as string) ?? null;
                if (!model) continue;

                const inTok    = (step["gen_ai.usage.input_tokens"]  as number) ?? 0;
                const outTok   = (step["gen_ai.usage.output_tokens"] as number) ?? 0;
                const costUSD  = (step["gemini.estimatedCostUSD"]    as number) ?? 0;

                const bucket = byModel[model] ?? { calls: 0, inputTokens: 0, outputTokens: 0, costUSD: 0 };
                bucket.calls        += 1;
                bucket.inputTokens  += inTok;
                bucket.outputTokens += outTok;
                bucket.costUSD      += costUSD;
                byModel[model] = bucket;

                totalCostUSD += costUSD;
            }
        }
    }

    // Round to 8 decimal places to keep T5 verification arithmetic stable
    // across JS double-precision quirks. Granularity is ~1e-8 USD per call;
    // for any realistic deal this is well below 1 cent.
    totalCostUSD = Math.round(totalCostUSD * 1e8) / 1e8;
    for (const m of Object.keys(byModel)) {
        byModel[m].costUSD = Math.round(byModel[m].costUSD * 1e8) / 1e8;
    }

    return {
        totalCostUSD,
        currency: "USD",
        byModel,
        perCallSource: "shared/llm-client.ts estimateCostUSD (GEMINI_PRICING table dated May 2026)",
    };
}

/**
 * Build the cost shape from a list of LLM-call audit records the caller
 * already has in hand. Use this on the BUYER side, where LLM-call telemetry
 * lives in whichever accumulator the buyer-agent uses (not in
 * thinkCycleTrace — that's seller-only per iter-4 Item 1).
 *
 * Records must minimally carry `modelRequested` (the resolved model name)
 * and `estimatedCostUSD`. promptTokens/completionTokens are optional and
 * contribute 0 to the bucket if absent.
 */
export function aggregateCostFromLlmCallRecords(
    records: Array<{
        modelRequested:    string;
        promptTokens?:     number;
        completionTokens?: number;
        estimatedCostUSD?: number;
    }> | undefined
): FrameworkMetricsCost {
    const byModel: FrameworkMetricsCost["byModel"] = {};
    let totalCostUSD = 0;

    for (const r of records ?? []) {
        const model = r.modelRequested;
        if (!model) continue;
        const inTok   = r.promptTokens     ?? 0;
        const outTok  = r.completionTokens ?? 0;
        const costUSD = r.estimatedCostUSD ?? 0;

        const bucket = byModel[model] ?? { calls: 0, inputTokens: 0, outputTokens: 0, costUSD: 0 };
        bucket.calls        += 1;
        bucket.inputTokens  += inTok;
        bucket.outputTokens += outTok;
        bucket.costUSD      += costUSD;
        byModel[model] = bucket;

        totalCostUSD += costUSD;
    }

    totalCostUSD = Math.round(totalCostUSD * 1e8) / 1e8;
    for (const m of Object.keys(byModel)) {
        byModel[m].costUSD = Math.round(byModel[m].costUSD * 1e8) / 1e8;
    }

    return {
        totalCostUSD,
        currency: "USD",
        byModel,
        perCallSource: "shared/llm-client.ts estimateCostUSD (GEMINI_PRICING table dated May 2026)",
    };
}

/**
 * Extract the four risk-avoided counts from an `autonomy.commitGate`
 * sub-block (iter-3). Tolerant of missing fields (each count defaults to
 * 0).
 */
export function aggregateRiskAvoidedFromCommitGate(
    commitGate: { eventCounts?: Record<string, number> } | undefined
): FrameworkMetricsRiskAvoided {
    const ec = commitGate?.eventCounts ?? {};
    return {
        treasuryVetoes:          ec["TREASURY_VETO"]            ?? 0,
        maxRoundsReached:        ec["MAX_ROUNDS_REACHED"]        ?? 0,
        counterpartyRejectFinal: ec["COUNTERPARTY_REJECT_FINAL"] ?? 0,
        guardrailOverrides:      ec["GUARDRAIL_OVERRIDE"]        ?? 0,
        source:                  "/autonomy/commitGate/eventCounts",
    };
}

/**
 * Extract outcome metrics from an assembled audit object, parameterized by
 * which side we're emitting for (determines which of buyerShare /
 * sellerShare we read from outcomeQuality.surplusSplit).
 */
export function extractOutcomeMetrics(
    audit: {
        outcome?: string;
        negotiation?: { finalPrice?: number };
        outcomeQuality?: {
            closed?: boolean;
            closedPrice?: number;
            currency?: string;
            surplusSplit?: { buyerShare?: number; sellerShare?: number };
        };
    },
    perspective: "BUYER" | "SELLER",
): FrameworkMetricsOutcome {
    const closed     = audit.outcomeQuality?.closed ?? (audit.outcome === "success");
    const finalPrice = audit.outcomeQuality?.closedPrice ?? audit.negotiation?.finalPrice ?? null;
    const currency   = audit.outcomeQuality?.currency ?? "INR";
    const share      = perspective === "BUYER"
        ? audit.outcomeQuality?.surplusSplit?.buyerShare
        : audit.outcomeQuality?.surplusSplit?.sellerShare;

    return {
        closed,
        finalPrice: finalPrice ?? null,
        currency,
        surplusCapturedShare: (typeof share === "number") ? share : null,
    };
}

// ────────────────────────────────────────────────────────────────────────────
// Main builder
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build the frameworkMetrics block. Pure function over typed inputs — the
 * caller (logger.ts saveAuditJson, just before serialization) is
 * responsible for extracting the three sub-shapes from the assembled
 * audit object using the helpers above (or its own equivalents).
 *
 * Scope marker is hardcoded "both" per DECISIONS iter-5 Item 5; if a
 * future iteration restricts the block to one side, the marker flips and
 * an addendum is added (Item 8).
 */
export function buildFrameworkMetrics(input: FrameworkMetricsInputs): FrameworkMetricsBlock {
    return {
        frameworkMetricsScope: "both",
        cost:                  input.cost,
        outcome:               input.outcome,
        riskAvoided:           input.riskAvoided,
    };
}
