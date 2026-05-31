// ================= AUDIT FRAMEWORK V6 — DELEGATION CHAIN BUILDER =================
// Iter 4 (DECISIONS addendum 2026-05-25). Emits the 6-step delegation chain
// from v6 App B.2.2 on the seller audit only (Item 4).
//
// Per-round entry shape (one entry per stepName per round):
//   {
//     round, stepName,
//     decidedBy, onAuthorityOf, authorityEnvelope,  ← 3 of 4 DCC properties (Item 5)
//     outcome, rationale,
//     dcc:               { propertiesEmitted: 4, propertiesFullSpec: 7, spec, deferredReason },
//     euAiActArticle14:  { monitorability, traceability, interventionPossible, overridePossible,
//                          attributesEmitted: 4, note },                       ← Item 6
//     signedAt,
//     signature: { kind: "HMAC", value, signedAt }                              ← 4th DCC property
//   }
//
// Scoping (Item 0 + Q-iter4-A option (b)):
//   - L2_EXECUTIVE_REASONER+: all 6 stepName entries per round (~18 for 3-round deal)
//   - BASIC_SALES_QUOTING_1 / L1_DELEGATED_ADVISORS: only `treasury-consultation`
//     per round (the one sub-agent BASIC mode actually calls). Honest partial
//     — the other 5 steps don't structurally exist in BASIC.
//
// Step name enum (Item 4): loaded from co-located delegation-steps.json
// so future iterations can extend without code edits.
//
// Signature (Item 7):
//   - signature.kind = "HMAC" (PlainHashSigner / HASH_ENVELOPE tier per iter-2)
//   - signature.value = sha256_hex(JSON.stringify(entry-minus-signature))
//   - signature.signedAt = ISO 8601 UTC at emit time
// The hashing convention matches iter-2's PlainHashSigner.hashPayload semantics
// (V8 insertion-order JSON.stringify, NOT sort-keys canonical). This is a
// deliberate parity with the iter-2 signer the addendum points at; if iter-9
// upgrades to KERI signing, the kind flips and the hash convention can be
// re-examined together.
//
// Top-level scope marker (Item 8): `delegationChainScope: "seller-only"`.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

// ────────────────────────────────────────────────────────────────────────────
// Canonical step list — loaded once at module init from co-located JSON
// (DECISIONS Q-iter4-C = Option 1: delegation-steps.json next to this file).
// ────────────────────────────────────────────────────────────────────────────

interface StepsFileShape {
    schemaVersion: number;
    source:        string;
    description:   string;
    steps:         Array<{ stepName: string; description: string }>;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const STEPS_PATH = path.join(__dirname, "delegation-steps.json");

const STEPS_FILE: StepsFileShape = JSON.parse(fs.readFileSync(STEPS_PATH, "utf8"));

/** Canonical step name enum, sourced from delegation-steps.json. */
export const CANONICAL_STEP_NAMES: readonly string[] =
    STEPS_FILE.steps.map((s) => s.stepName);

const CANONICAL_STEP_SET = new Set(CANONICAL_STEP_NAMES);

// ────────────────────────────────────────────────────────────────────────────
// Locked text constants (DECISIONS Items 5 + 6)
// ────────────────────────────────────────────────────────────────────────────

/** DCC partial marker text (Item 5). Verbatim from addendum. */
const DCC_DEFAULT_DEFERRED_REASON =
    "[DCC-2026] Patil arxiv 2604.02767 not accessible at iter-4 lock time " +
    "(2026-05-25). Remaining 3 properties to be added in a future addendum " +
    "once the spec is read.";

const DCC_SPEC_REFERENCE = "FRAMEWORK-V2 §8 (4 of 7)";

/** EU AI Act Art 14 note text (Item 6). Verbatim from addendum. */
const EU_AI_ACT_NOTE =
    "Honest current-state booleans per ITERATION-PLAN Iter 4 T5. Article 14 " +
    "as a regulation defines additional attributes; those are deferred until " +
    "the code supports intervention and override paths.";

// ────────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────────

export interface AuthorityEnvelope {
    description: string;
    limits:      Record<string, unknown>;
}

/**
 * Per-step inputs from the caller. The seller-agent builds these from its
 * accumulated ConsultationBundle + L2 decisions + legacy treasury results.
 */
export interface DelegationStepInputs {
    round:             number;
    /** Must be one of CANONICAL_STEP_NAMES. Builder throws otherwise. */
    stepName:          string;
    decidedBy:         string;
    onAuthorityOf:     string;
    authorityEnvelope: AuthorityEnvelope;
    outcome:           Record<string, unknown>;
    rationale:         string;
    /** Optional override of the default DCC deferred-reason text. */
    dccDeferredReason?: string;
}

export interface DccMarker {
    propertiesEmitted: 4;
    propertiesFullSpec: 7;
    spec: string;
    deferredReason: string;
}

export interface EuAiActArticle14Block {
    monitorability:       true;
    traceability:         true;
    interventionPossible: false;
    overridePossible:     false;
    attributesEmitted:    4;
    note:                 string;
}

export interface DelegationSignature {
    kind:     "HMAC";
    value:    string;
    signedAt: string;
}

export interface DelegationChainEntry {
    round:             number;
    stepName:          string;
    decidedBy:         string;
    onAuthorityOf:     string;
    authorityEnvelope: AuthorityEnvelope;
    outcome:           Record<string, unknown>;
    rationale:         string;
    dcc:               DccMarker;
    euAiActArticle14:  EuAiActArticle14Block;
    signedAt:          string;
    signature:         DelegationSignature;
}

export interface DelegationChainBlock {
    delegationChainScope: "seller-only";
    delegationChain:      DelegationChainEntry[];
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Compute the HMAC signature value over an entry-minus-signature (Item 7).
 *
 * Hashing convention: sha256(JSON.stringify(entry-minus-signature)) — matches
 * iter-2 PlainHashSigner.hashPayload exactly (V8 insertion-order JSON, NOT
 * sort-keys canonical). The addendum says "reuse whatever iter-2's message-
 * log signer uses"; that is what iter-2 uses, so that is what we use here.
 *
 * The function is exported so test scripts can re-derive the value from the
 * persisted audit JSON and verify it matches signature.value (T4-style
 * acceptance test).
 */
export function computeDelegationSignatureValue(
    entryMinusSignature: Omit<DelegationChainEntry, "signature">,
): string {
    const json = JSON.stringify(entryMinusSignature);
    return crypto.createHash("sha256").update(json).digest("hex");
}

function buildDccMarker(deferredReason?: string): DccMarker {
    return {
        propertiesEmitted:  4,
        propertiesFullSpec: 7,
        spec:               DCC_SPEC_REFERENCE,
        deferredReason:     deferredReason ?? DCC_DEFAULT_DEFERRED_REASON,
    };
}

function buildEuAiActBlock(): EuAiActArticle14Block {
    return {
        monitorability:       true,
        traceability:         true,
        interventionPossible: false,
        overridePossible:     false,
        attributesEmitted:    4,
        note:                 EU_AI_ACT_NOTE,
    };
}

/**
 * Build one delegation chain entry from inputs. Validates stepName against
 * the canonical list. Computes the signature at the end.
 *
 * Field ordering matters for the signature: JSON.stringify uses insertion
 * order. We build the entry-minus-signature in a stable order, hash, then
 * attach signature. A test can reproduce by reading the entry, stripping
 * signature, JSON.stringify-ing in the same order, and rehashing.
 */
function buildEntry(inputs: DelegationStepInputs, signedAt: string): DelegationChainEntry {
    if (!CANONICAL_STEP_SET.has(inputs.stepName)) {
        throw new Error(
            `[delegation-chain] Unknown stepName "${inputs.stepName}". ` +
            `Must be one of: ${CANONICAL_STEP_NAMES.join(", ")}. ` +
            `If a new step is needed, add it to delegation-steps.json.`,
        );
    }

    const entryMinusSignature: Omit<DelegationChainEntry, "signature"> = {
        round:             inputs.round,
        stepName:          inputs.stepName,
        decidedBy:         inputs.decidedBy,
        onAuthorityOf:     inputs.onAuthorityOf,
        authorityEnvelope: inputs.authorityEnvelope,
        outcome:           inputs.outcome,
        rationale:         inputs.rationale,
        dcc:               buildDccMarker(inputs.dccDeferredReason),
        euAiActArticle14:  buildEuAiActBlock(),
        signedAt,
    };

    const signature: DelegationSignature = {
        kind:     "HMAC",
        value:    computeDelegationSignatureValue(entryMinusSignature),
        signedAt,
    };

    return { ...entryMinusSignature, signature };
}

// ────────────────────────────────────────────────────────────────────────────
// Main builder
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build the delegationChain block.
 *
 * All entries within a single buildDelegationChain() call share the same
 * `signedAt` timestamp — the time at which the audit is being emitted.
 * This is the same convention iter-2 uses for messageSigningPosture stats:
 * derived-at-audit-emit-time, not per-event-time. Each step's `outcome`
 * field will typically reference its own per-event timestamp inside.
 */
export function buildDelegationChain(steps: DelegationStepInputs[]): DelegationChainBlock {
    const signedAt = new Date().toISOString();
    const entries  = steps.map((s) => buildEntry(s, signedAt));
    return {
        delegationChainScope: "seller-only",
        delegationChain:      entries,
    };
}
