// ================= AUDIT FRAMEWORK V6 — COMPLIANCE CROSSWALK BUILDER =================
// Iter 5 (DECISIONS addendum 2026-05-25, Item 4). Emits the `compliance`
// block on BOTH the buyer audit and the seller audit. Each entry maps an
// external framework (NIST AI RMF, ISO 42001, EU AI Act Article 14,
// DCC-2026, OpenTelemetry GenAI semconv, VERIFAGENT-2025) to the audit
// fields that serve as evidence for compliance with it.
//
// Scope marker: `complianceScope: "both"` (Item 5).
//
// Locked framework id ordering (Item 4):
//   1. NIST_AI_RMF
//   2. ISO_42001
//   3. EU_AI_Act_Article_14
//   4. DCC_2026
//   5. OpenTelemetry_GenAI
//   6. VERIFAGENT_2025
//
// evidenceRefs[] convention: RFC-6901 JSON Pointers, extended with `*` as a
// non-standard wildcard meaning "every index in the array at the parent
// path." The block carries the convention as an `evidenceRefConvention`
// string so a reader sees how to expand the pointers. A wildcard pointing
// into an absent array (e.g. `/thinkCycleTrace/*` on the buyer audit)
// resolves to zero concrete pointers — the honest cross-side N/A state
// per Item 0. The `complianceScope` remains `"both"` because the crosswalk
// itself applies uniformly; the resolved evidence count varies by side.

// ────────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────────

export type ComplianceFrameworkId =
    | "NIST_AI_RMF"
    | "ISO_42001"
    | "EU_AI_Act_Article_14"
    | "DCC_2026"
    | "OpenTelemetry_GenAI"
    | "VERIFAGENT_2025";

export interface ComplianceFrameworkEntry {
    id:            ComplianceFrameworkId;
    version:       string;
    mappedTo:      string[];
    evidenceRefs:  string[];
}

export interface ComplianceBlock {
    complianceScope:        "both";
    evidenceRefConvention:  string;
    frameworks:             ComplianceFrameworkEntry[];
}

// ────────────────────────────────────────────────────────────────────────────
// The locked crosswalk (Item 4). Order matters — emitted in this order.
// ────────────────────────────────────────────────────────────────────────────

const EVIDENCE_REF_CONVENTION =
    "RFC-6901 JSON Pointers, extended with non-standard wildcard '*' meaning " +
    "'every index in the array at the parent path'. A reader expanding a wildcard " +
    "MUST emit one concrete pointer per array index found on the audit being " +
    "inspected; a wildcard pointing into an absent array (e.g. /thinkCycleTrace/* " +
    "on a buyer audit) resolves to zero concrete pointers, which is the honest " +
    "cross-side state per iter-5 addendum Item 0.";

const FRAMEWORKS: ComplianceFrameworkEntry[] = [
    {
        id:           "NIST_AI_RMF",
        version:      "1.0",
        mappedTo:     ["GOVERN-1.1", "MEASURE-2.7", "MANAGE-4.1"],
        evidenceRefs: ["/autonomy", "/decisions", "/intent/deviationFromIntent"],
    },
    {
        id:           "ISO_42001",
        version:      "2023",
        mappedTo:     ["6.1.2", "8.2", "9.1"],
        evidenceRefs: ["/autonomy/capabilitiesActive", "/decisions"],
    },
    {
        id:           "EU_AI_Act_Article_14",
        version:      "Reg 2024/1689",
        mappedTo:     ["human-oversight"],
        evidenceRefs: ["/delegationChain/*/euAiActArticle14", "/autonomy/humanOversightPosition"],
    },
    {
        id:           "DCC_2026",
        version:      "Patil arXiv 2604.02767 (deferred)",
        mappedTo:     ["4-of-7 properties per iter-4 Item 5"],
        evidenceRefs: ["/delegationChain/*/dcc"],
    },
    {
        id:           "OpenTelemetry_GenAI",
        version:      "semconv v1.28",
        mappedTo:     ["gen_ai.system", "gen_ai.request.model", "gen_ai.usage.*"],
        evidenceRefs: ["/thinkCycleTrace/*/steps"],
    },
    {
        id:           "VERIFAGENT_2025",
        version:      "deferred (post-WEDGE1)",
        mappedTo:     ["challenge-response (not yet wired)"],
        evidenceRefs: [],
    },
];

// ────────────────────────────────────────────────────────────────────────────
// Main builder
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build the compliance block. The crosswalk is static (locked by
 * DECISIONS iter-5 Item 4), so this function takes no inputs — it just
 * returns the locked structure. Both buyer and seller audits emit the
 * same crosswalk; differences in resolved evidence per side are a
 * property of the audit data, not of the crosswalk itself (Item 4).
 *
 * Returning a fresh object on each call rather than a shared module-level
 * constant so a caller mutating one block (e.g. adding a future
 * project-specific framework) doesn't accidentally affect another audit
 * being built in parallel.
 */
export function buildCompliance(): ComplianceBlock {
    return {
        complianceScope:       "both",
        evidenceRefConvention: EVIDENCE_REF_CONVENTION,
        frameworks:            FRAMEWORKS.map(f => ({
            id:           f.id,
            version:      f.version,
            mappedTo:     [...f.mappedTo],
            evidenceRefs: [...f.evidenceRefs],
        })),
    };
}
