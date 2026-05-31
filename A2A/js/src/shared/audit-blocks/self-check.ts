// ================= AUDIT FRAMEWORK V6 — SELF-CHECK BUILDER =================
// Iter 5 (DECISIONS addendum 2026-05-25, Items 2 + 3). Emits the `selfCheck`
// block on BOTH the buyer audit and the seller audit. 5 boolean checks
// (with seller-only checks emitted as tri-state `null` on the buyer side)
// plus a derived `overallVerdict` from the locked Q6 enum.
//
// Scope marker: `selfCheckScope: "both"` (Item 5).
//
// The 5 check names are locked (Item 2):
//   1. identityVerified         -> /identityProof          (both sides)
//   2. messageIntegrityIntact   -> /messageSigningPosture  (both sides)
//   3. intentDeclaredAndTracked -> /intent                 (both sides)
//   4. reasoningAuditable       -> /thinkCycleTrace        (seller-only)
//   5. delegationAttested       -> /delegationChain        (seller-only)
//
// Verdict derivation (Item 3, uses Q6 enum):
//   critical      = identityVerified === true AND messageIntegrityIntact === true
//   allPassedOrNA = every check is true OR null
//   if (!critical)          -> OFF_TRACK
//   else if (allPassedOrNA) -> ON_TRACK
//   else                    -> ON_TRACK_BUT_FLAGGED
//   (NEEDS_REVIEW is reserved vocabulary, not produced by clean iter-5)

// ────────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────────

export type SelfCheckPerspective = "BUYER" | "SELLER";

export type SelfCheckVerdict =
    | "ON_TRACK"
    | "ON_TRACK_BUT_FLAGGED"
    | "OFF_TRACK"
    | "NEEDS_REVIEW";

export type SelfCheckName =
    | "identityVerified"
    | "messageIntegrityIntact"
    | "intentDeclaredAndTracked"
    | "reasoningAuditable"
    | "delegationAttested";

/** Per-check entry. `passed: null` means "not applicable on this side". */
export interface SelfCheckEntry {
    name:   SelfCheckName;
    passed: boolean | null;
    ref:    string;
    note?:  string;
}

/**
 * Inputs are the 5 already-computed booleans (or nulls) from the caller.
 * The caller (logger.ts saveAuditJson) is responsible for inspecting the
 * assembled audit object and producing each boolean per the rules in
 * DECISIONS iter-5 Item 2. Notes are optional per check.
 */
export interface SelfCheckInputs {
    perspective: SelfCheckPerspective;
    checks: {
        identityVerified:         boolean;
        messageIntegrityIntact:   boolean;
        intentDeclaredAndTracked: boolean;
        reasoningAuditable:       boolean | null;
        delegationAttested:       boolean | null;
    };
    notes?: Partial<Record<SelfCheckName, string>>;
}

export interface SelfCheckBlock {
    selfCheckScope:  "both";
    overallVerdict:  SelfCheckVerdict;
    checks:          SelfCheckEntry[];
}

// ────────────────────────────────────────────────────────────────────────────
// Internal: the locked check order + ref pointers (Item 2)
// ────────────────────────────────────────────────────────────────────────────

const CHECK_ORDER: SelfCheckName[] = [
    "identityVerified",
    "messageIntegrityIntact",
    "intentDeclaredAndTracked",
    "reasoningAuditable",
    "delegationAttested",
];

const CHECK_REFS: Record<SelfCheckName, string> = {
    identityVerified:         "/identityProof",
    messageIntegrityIntact:   "/messageSigningPosture",
    intentDeclaredAndTracked: "/intent",
    reasoningAuditable:       "/thinkCycleTrace",
    delegationAttested:       "/delegationChain",
};

const SELLER_ONLY_CHECKS: SelfCheckName[] = ["reasoningAuditable", "delegationAttested"];

const CROSS_SIDE_NA_NOTE =
    "scope: seller-only per iter-4 addendum Item 1/4 — not applicable on buyer audit";

// ────────────────────────────────────────────────────────────────────────────
// Helpers — pure functions that callers may use to compute the 5 booleans
// from an assembled audit object. Each helper is tolerant of missing fields
// and returns false (or null for seller-only on buyer side) honestly.
// ────────────────────────────────────────────────────────────────────────────

/** Check #1 — identityProof has both LEIs and counterparty verified === true. */
export function checkIdentityVerified(audit: {
    identityProof?: {
        self?:         { lei?: string };
        counterparty?: { lei?: string; verified?: boolean };
    };
}): boolean {
    const ip = audit.identityProof;
    if (!ip || !ip.self || !ip.counterparty) return false;
    const selfLei  = (ip.self.lei         ?? "").trim();
    const cpLei    = (ip.counterparty.lei ?? "").trim();
    if (!selfLei || !cpLei) return false;
    // Plain mode: counterparty.verified is set to true by the verifier
    // (iter-2 identity-proof.ts). Other modes may not set it; treat
    // missing-field as false honestly.
    return ip.counterparty.verified === true;
}

/** Check #2 — messageSigningPosture.tier ∈ enum AND every receive entry has verification.valid === true. */
export function checkMessageIntegrityIntact(audit: {
    messageSigningPosture?: { tier?: string };
    messageLog?: Array<{
        direction?: string;
        verification?: { valid?: boolean };
    }>;
}): boolean {
    const ALLOWED_TIERS = ["NONE", "HASH_ENVELOPE", "SIGNED_HASH", "KERI_SEAL", "VLEI_BOUND"];
    const tier = audit.messageSigningPosture?.tier;
    if (!tier || !ALLOWED_TIERS.includes(tier)) return false;

    for (const entry of audit.messageLog ?? []) {
        if (entry.direction !== "receive") continue;
        if (entry.verification?.valid !== true) return false;
    }
    return true;
}

/** Check #3 — intent.intentSource !== "NONE" AND deviationFromIntent present. */
export function checkIntentDeclaredAndTracked(audit: {
    intent?: {
        intentSource?: string;
        deviationFromIntent?: unknown;
    };
}): boolean {
    const intent = audit.intent;
    if (!intent) return false;
    if (!intent.intentSource || intent.intentSource === "NONE") return false;
    return intent.deviationFromIntent !== undefined && intent.deviationFromIntent !== null;
}

/**
 * Check #4 (seller-only) — every thinkCycleTrace[] round has a geminiCall
 * step with valid prompt.hash, and (if prompt.text present) sha256(text)
 * matches hash. Returns null on the buyer side (cross-side N/A).
 *
 * The hash verification uses a caller-supplied verifier so this file
 * doesn't import crypto / Buffer. logger.ts wires in the verifier.
 */
export function checkReasoningAuditable(
    audit: {
        thinkCycleTrace?: Array<{
            steps?: Array<Record<string, unknown>>;
        }>;
    },
    perspective: SelfCheckPerspective,
    verifySha256Hex: (text: string, expectedHex: string) => boolean,
): boolean | null {
    if (perspective === "BUYER") return null;
    if (!audit.thinkCycleTrace || audit.thinkCycleTrace.length === 0) return false;

    for (const round of audit.thinkCycleTrace) {
        const steps = round.steps ?? [];
        const gemini = steps.find(s => s["stepName"] === "geminiCall");
        if (!gemini) return false;
        const hash = gemini["prompt.hash"] as string | undefined;
        if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return false;

        const text = gemini["prompt.text"] as string | undefined;
        if (text !== undefined && text.length > 0) {
            if (!verifySha256Hex(text, hash)) return false;
        }
        // prompt.text absent is acceptable (AUDIT_INCLUDE_PROMPT_TEXT=false path);
        // hash-shape check above is sufficient when text isn't there.
    }
    return true;
}

/**
 * Check #5 (seller-only) — every delegationChain[] entry has a 64-hex
 * HMAC signature.value that matches computeDelegationSignatureValue
 * (caller-supplied verifier). Returns null on the buyer side.
 *
 * `verifyEntrySignature` is wired by logger.ts to whatever helper the
 * project uses (matching the iter-4 delegation-chain.ts signing
 * convention).
 */
export function checkDelegationAttested(
    audit: {
        delegationChain?: Array<{
            signature?: { kind?: string; value?: string };
        }>;
    },
    perspective: SelfCheckPerspective,
    verifyEntrySignature: (entry: Record<string, unknown>) => boolean,
): boolean | null {
    if (perspective === "BUYER") return null;
    if (!audit.delegationChain || audit.delegationChain.length === 0) return false;

    for (const entry of audit.delegationChain) {
        const sig = entry.signature;
        if (!sig || sig.kind !== "HMAC" || !sig.value) return false;
        if (!/^[0-9a-f]{64}$/.test(sig.value)) return false;
        if (!verifyEntrySignature(entry as Record<string, unknown>)) return false;
    }
    return true;
}

// ────────────────────────────────────────────────────────────────────────────
// Verdict derivation (Item 3)
// ────────────────────────────────────────────────────────────────────────────

function deriveVerdict(checks: SelfCheckInputs["checks"]): SelfCheckVerdict {
    const critical = checks.identityVerified === true && checks.messageIntegrityIntact === true;
    if (!critical) return "OFF_TRACK";

    const allPassedOrNA = (
        (checks.identityVerified         === true)                                              &&
        (checks.messageIntegrityIntact   === true)                                              &&
        (checks.intentDeclaredAndTracked === true)                                              &&
        (checks.reasoningAuditable       === true || checks.reasoningAuditable === null)        &&
        (checks.delegationAttested       === true || checks.delegationAttested === null)
    );

    return allPassedOrNA ? "ON_TRACK" : "ON_TRACK_BUT_FLAGGED";
}

// ────────────────────────────────────────────────────────────────────────────
// Main builder
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build the selfCheck block. Pure function over typed inputs — the caller
 * (logger.ts saveAuditJson) computes the 5 booleans from the assembled
 * audit object using the helpers above (or its own equivalents) and
 * passes them in.
 *
 * The output array preserves the locked CHECK_ORDER on both sides; on the
 * buyer audit, seller-only checks carry `passed: null` and the standard
 * cross-side N/A note. The Q6 enum verdict is derived from the same inputs.
 */
export function buildSelfCheck(input: SelfCheckInputs): SelfCheckBlock {
    const { perspective, checks, notes } = input;

    const checkEntries: SelfCheckEntry[] = CHECK_ORDER.map((name) => {
        const isSellerOnly = SELLER_ONLY_CHECKS.includes(name);
        const rawValue     = checks[name];
        // On buyer side, seller-only checks are forced to null regardless of
        // what the caller passed (defense in depth — caller MUST pass null
        // per the typed shape, but if they pass true/false by mistake we
        // honor the scope per Item 0).
        const passed: boolean | null =
            (isSellerOnly && perspective === "BUYER") ? null : rawValue;

        const entry: SelfCheckEntry = {
            name,
            passed,
            ref: CHECK_REFS[name],
        };

        // Note precedence: explicit caller note > cross-side N/A note (if applicable)
        const callerNote = notes?.[name];
        if (callerNote) {
            entry.note = callerNote;
        } else if (passed === null && isSellerOnly && perspective === "BUYER") {
            entry.note = CROSS_SIDE_NA_NOTE;
        }

        return entry;
    });

    // Build the effective-checks object the verdict derivation sees, with
    // buyer-side seller-only forced to null (same rule as above).
    const effectiveChecks: SelfCheckInputs["checks"] = {
        identityVerified:         checks.identityVerified,
        messageIntegrityIntact:   checks.messageIntegrityIntact,
        intentDeclaredAndTracked: checks.intentDeclaredAndTracked,
        reasoningAuditable:       (perspective === "BUYER") ? null : checks.reasoningAuditable,
        delegationAttested:       (perspective === "BUYER") ? null : checks.delegationAttested,
    };

    return {
        selfCheckScope: "both",
        overallVerdict: deriveVerdict(effectiveChecks),
        checks:         checkEntries,
    };
}
