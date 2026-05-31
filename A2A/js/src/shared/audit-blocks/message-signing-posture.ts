// ================= AUDIT FRAMEWORK V6 — MESSAGE SIGNING POSTURE BLOCK ========
// Iter 2. Declares the tamper-evidence and identity-proof level that every
// A2A message in this negotiation was actually wrapped at. The audit JSON's
// `messageSigningPosture.tier` is the honest label per Q15 + the iter-2 notes
// addendum in AUDIT-FRAMEWORK-V6-DECISIONS.md.
//
// Today only `HASH_ENVELOPE` is wired (via PlainHashSigner: sha256 + counter
// + timestamp). The other 4 tier values are reserved vocabulary so future
// iterations (iter-9 KERI signing, iter-14 full vLEI) can climb the ladder
// without breaking the audit schema.
//
// Acceptance tests (per AUDIT-FRAMEWORK-V6-ITERATION-PLAN.md Part 3):
//   T2: messageSigningPosture.tier honestly reflects current mode
//       (likely HASH_ENVELOPE today)
//
// The capability booleans below are NOT discovered at runtime — they're
// declared per tier so a regulator reading the audit knows exactly what
// protections were and were NOT in force.

import type { SigningMode } from "../../messaging/signed-message.js";

/**
 * The 5 honest tier values for `messageSigningPosture.tier`.
 *
 * Locked enum — see Notes addendum in AUDIT-FRAMEWORK-V6-DECISIONS.md
 * dated 2026-05-23. Q15 reserved `HASH_ENVELOPE`; Iter 2 codified the full
 * set of sibling values.
 *
 * Ordered from weakest (top) to strongest (bottom). Higher tiers strictly
 * subsume lower-tier capabilities.
 */
export type MessageSigningTier =
  | "NONE"            // no envelope; reserved for downgrade scenarios
  | "HASH_ENVELOPE"   // sha256 + counter + timestamp; CURRENT (PlainHashSigner)
  | "SIGNED_HASH"     // HASH_ENVELOPE + Ed25519 signature; reserved
  | "KERI_SEAL"       // SAID-anchored seal in a Key Event Log; reserved (iter-9/14)
  | "VLEI_BOUND";     // KERI_SEAL + GLEIF-bound delegation chain; reserved (iter-14)

/** What a given tier provides, declaratively. */
export interface TierCapabilities {
  /** sha256 (or equivalent) over the payload protects against payload tampering. */
  tamperEvidenceOnPayload:  boolean;
  /** sha256 over the envelope fields protects against header tampering. */
  tamperEvidenceOnEnvelope: boolean;
  /** Monotonic counter per (sender,receiver) pair rejects replays. */
  replayProtection:         boolean;
  /** Timestamp + max-age window rejects stale captures. */
  stalenessProtection:      boolean;
  /** Cryptographic signature proves the holder of a private key signed it. */
  cryptographicIdentity:    boolean;
  /** Signing key is provably delegated from a GLEIF-registered legal entity. */
  leiBoundIdentity:         boolean;
  /** Signature is anchored in a KERI Key Event Log with auditable rotation. */
  keriKeyEventLog:          boolean;
}

/** Per-deal aggregate stats over `messageLog[]`. */
export interface MessageSigningStats {
  /** Count of messages sealed (sent) by this agent during the negotiation. */
  messagesSealed:   number;
  /** Count of inbound messages that verified successfully. */
  messagesVerified: number;
  /** Count of inbound messages that failed verification. */
  messagesRejected: number;
  /** Honest list of failure reasons seen, in order. May be empty. */
  rejectionReasons: string[];
}

/** Configuration the active signer was running under at deal close. */
export interface MessageSigningConfig {
  /** Maximum allowed message age before TIMESTAMP_STALE. ms. */
  maxMessageAgeMs:  number;
  /** Maximum allowed future-skew before TIMESTAMP_FUTURE. ms. */
  maxFutureSkewMs:  number;
}

/** Full messageSigningPosture audit block. */
export interface MessageSigningPostureBlock {
  /** Schema version. Bumped on breaking changes. */
  schemaVersion: 1;
  /** Honest tier label. See Notes addendum in DECISIONS.md. */
  tier:         MessageSigningTier;
  /** One-line human description of what the tier actually does. */
  tierDescription: string;
  /** Which signer implementation produced the envelopes. */
  provider:     string;
  /** Raw signing mode from `MessageSigner.mode()` (i.e. "plain" | "vlei"). */
  signingMode:  SigningMode;
  /** Declarative capability matrix for this tier. */
  capabilities: TierCapabilities;
  /** Live signer configuration at deal close. */
  config:       MessageSigningConfig;
  /** Per-deal aggregate stats. */
  stats:        MessageSigningStats;
  /** Explicit note describing what this tier does NOT protect against. */
  honestNote:   string;
}

// ────────────────────────────────────────────────────────────────────────────
// Tier ↔ behaviour tables. These are the SOURCE OF TRUTH for what each tier
// means; the builder function below selects rows by tier name.
// ────────────────────────────────────────────────────────────────────────────

const CAPABILITIES_BY_TIER: Record<MessageSigningTier, TierCapabilities> = {
  NONE: {
    tamperEvidenceOnPayload:  false,
    tamperEvidenceOnEnvelope: false,
    replayProtection:         false,
    stalenessProtection:      false,
    cryptographicIdentity:    false,
    leiBoundIdentity:         false,
    keriKeyEventLog:          false,
  },
  HASH_ENVELOPE: {
    tamperEvidenceOnPayload:  true,
    tamperEvidenceOnEnvelope: true,
    replayProtection:         true,
    stalenessProtection:      true,
    cryptographicIdentity:    false,
    leiBoundIdentity:         false,
    keriKeyEventLog:          false,
  },
  SIGNED_HASH: {
    tamperEvidenceOnPayload:  true,
    tamperEvidenceOnEnvelope: true,
    replayProtection:         true,
    stalenessProtection:      true,
    cryptographicIdentity:    true,
    leiBoundIdentity:         false,
    keriKeyEventLog:          false,
  },
  KERI_SEAL: {
    tamperEvidenceOnPayload:  true,
    tamperEvidenceOnEnvelope: true,
    replayProtection:         true,
    stalenessProtection:      true,
    cryptographicIdentity:    true,
    leiBoundIdentity:         false,
    keriKeyEventLog:          true,
  },
  VLEI_BOUND: {
    tamperEvidenceOnPayload:  true,
    tamperEvidenceOnEnvelope: true,
    replayProtection:         true,
    stalenessProtection:      true,
    cryptographicIdentity:    true,
    leiBoundIdentity:         true,
    keriKeyEventLog:          true,
  },
};

const DESCRIPTION_BY_TIER: Record<MessageSigningTier, string> = {
  NONE:
    "No envelope wrapping. Plain payload over HTTP. No protections.",
  HASH_ENVELOPE:
    "sha256 over payload + monotonic counter + ISO timestamp + sha256 over envelope. " +
    "Detects tampering and replays; does NOT prove sender identity.",
  SIGNED_HASH:
    "HASH_ENVELOPE + an Ed25519 signature over the KRAM canonical string " +
    "(sender AID + ISO timestamp + SHA-256 payload digest), NOT the envelope hash. " +
    "Proves the holder of the private key signed; key is not bound to a legal entity.",
  KERI_SEAL:
    "KERI seal: envelope hash anchored under a self-addressing identifier in a Key Event Log. " +
    "Adds auditable key history and rotation; identity is a KERI AID, not yet LE-bound.",
  VLEI_BOUND:
    "KERI_SEAL whose signing AID is provably delegated via the GLEIF chain " +
    "GLEIF_ROOT → QVI → LE → OOR → agent. Signature legally binds the represented legal entity.",
};

const HONEST_NOTE_BY_TIER: Record<MessageSigningTier, string> = {
  NONE:
    "Anyone in the middle can rewrite, replay, or forge. No tamper-evidence, no identity.",
  HASH_ENVELOPE:
    "Detects tampering and replays but does NOT prove sender identity. " +
    "Anyone with access to the agent source code could mint a valid envelope claiming to be this agent.",
  SIGNED_HASH:
    "Proves the holder of the signing key produced this message, but the signing key " +
    "is not bound to the agent's legal entity via GLEIF. Non-repudiation only against the key holder.",
  KERI_SEAL:
    "KERI seal proves the signing AID produced this message and provides auditable key rotation, " +
    "but does NOT yet prove the AID legally represents the GLEIF-registered legal entity.",
  VLEI_BOUND:
    "Strongest tier: every message is legally bound to the represented legal entity via the " +
    "GLEIF → QVI → LE → OOR → agent delegation chain. Non-repudiation against the legal entity.",
};

/**
 * Default mapping from raw signer mode → audit-block tier.
 *
 * Today only one mode → one tier:
 *   "plain" → HASH_ENVELOPE  (PlainHashSigner)
 *   "vlei"  → VLEI_BOUND     (reserved; iter-14 wires this)
 *
 * Iter-9/iter-14 may introduce intermediate signer implementations; if so,
 * callers can override by passing `tier` directly to buildMessageSigningPostureBlock().
 */
export function defaultTierForMode(mode: SigningMode): MessageSigningTier {
  switch (mode) {
    case "plain": return "HASH_ENVELOPE";
    case "vlei":  return "VLEI_BOUND";
    case "kram":  return "SIGNED_HASH";
    default:
      // Exhaustiveness check — adding a new SigningMode requires a new tier mapping.
      const _exhaustive: never = mode;
      return "NONE";
  }
}

/**
 * Build the `messageSigningPosture` audit block.
 *
 * @param opts.signingMode   `MessageSigner.mode()` of the active signer.
 * @param opts.provider      Class name of the signer (e.g. "PlainHashSigner").
 *                           Used only for display in the audit.
 * @param opts.maxMessageAgeMs  Active staleness window. Defaults to 300_000.
 * @param opts.maxFutureSkewMs  Active future-skew window. Defaults to 30_000.
 * @param opts.stats         Aggregate stats from message-log-collector for
 *                           this negotiation. Defaults to zero-counts.
 * @param opts.tierOverride  Optional explicit tier. Use when a future signer
 *                           does not map cleanly through defaultTierForMode().
 */
export function buildMessageSigningPostureBlock(opts: {
  signingMode:      SigningMode;
  provider:         string;
  maxMessageAgeMs?: number;
  maxFutureSkewMs?: number;
  stats?:           MessageSigningStats;
  tierOverride?:    MessageSigningTier;
}): MessageSigningPostureBlock {
  const tier = opts.tierOverride ?? defaultTierForMode(opts.signingMode);
  return {
    schemaVersion:   1,
    tier,
    tierDescription: DESCRIPTION_BY_TIER[tier],
    provider:        opts.provider,
    signingMode:     opts.signingMode,
    capabilities:    CAPABILITIES_BY_TIER[tier],
    config: {
      maxMessageAgeMs: opts.maxMessageAgeMs ?? Number(process.env.MAX_MESSAGE_AGE_MS ?? 300_000),
      maxFutureSkewMs: opts.maxFutureSkewMs ?? Number(process.env.MAX_FUTURE_SKEW_MS ?? 30_000),
    },
    stats: opts.stats ?? {
      messagesSealed:   0,
      messagesVerified: 0,
      messagesRejected: 0,
      rejectionReasons: [],
    },
    honestNote: HONEST_NOTE_BY_TIER[tier],
  };
}
