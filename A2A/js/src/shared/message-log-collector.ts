// ================= AUDIT FRAMEWORK V6 — MESSAGE LOG COLLECTOR ================
// Iter 2. Per-negotiation in-memory record of every A2A envelope sent and
// received. Read by logger.saveAuditJson() at deal close to emit the
// `messageLog[]` block.
//
// Used by:
//   - agents/buyer-agent/index.ts  — instrument every send/receive site
//   - agents/seller-agent/index.ts — instrument every send/receive site
//   - shared/logger.ts             — read at deal close
//
// Storage:
//   In-memory, keyed by negotiationId. Cleared by clear(negotiationId) after
//   the audit is written, or via _reset() in tests. No persistence; the
//   audit JSON itself is the durable record.
//
// Thread-safety:
//   Node.js single-threaded; no locking needed. Each agent process has its
//   own collector instance via the singleton accessor.
//
// Acceptance tests (per AUDIT-FRAMEWORK-V6-ITERATION-PLAN.md Part 3):
//   T3: count of envelopes in terminal log == messageLog[] count
//   T4: every messageLog[] entry has transportSignature.payloadHash populated
//
// T4 is structurally enforced: transportSignature is built from the
// SignedEnvelope, and payloadHash is a required field on SignedEnvelope.

import type {
  SealedMessage,
  SignedEnvelope,
  SigningMode,
  VerificationResult,
} from "../messaging/signed-message.js";
import type { MessageSigningStats } from "./audit-blocks/message-signing-posture.js";

/** One row in `messageLog[]`. */
export interface MessageLogEntry {
  /** Schema version. Bumped on breaking changes. */
  schemaVersion: 1;
  /** Did THIS agent send this message, or did it receive the message? */
  direction: "send" | "receive";
  /** Negotiation round this message belongs to, if known at record time. */
  round?: number;
  /**
   * Short label for the payload kind. Free-form; callers should pick a
   * canonical short string per kind (e.g. "OFFER", "COUNTER", "ACCEPT",
   * "REJECT", "ESCALATE", "DD_OFFER", "DD_ACCEPT", "DD_INVOICE",
   * "PO", "INVOICE", "IPEX_GRANT", "IPEX_ADMIT").
   */
  payloadKind: string;
  /** When this collector entry was recorded. ISO 8601 UTC. */
  recordedAt: string;
  /**
   * Transport-layer signature info, flattened from the SignedEnvelope.
   * `payloadHash` is required (T4 acceptance criterion).
   */
  transportSignature: {
    mode:            SigningMode;
    senderAgentId:   string;
    receiverAgentId: string;
    counter:         number;
    timestamp:       string;
    payloadHash:     string;
    envelopeHash:    string;
    /**
     * KRAM mode only: the sender's KERI AID (prefix) that produced `signature`.
     * Copied in-band from the envelope so a third party reading the audit can
     * resolve the signing verfer (via KERIA, or the agent's info-file
     * state.k[0]) and independently re-verify `signature` over the canonical
     * string (senderAid + timestamp + payloadHash). Without it the logged
     * signature is not independently verifiable. Absent in plain/vlei modes.
     */
    senderAid?:      string;
    /** Empty in plain mode; present in vlei mode. */
    signature?:      string;
  };
  /**
   * Verification result. Populated for receive entries (we ran verify()).
   * Undefined for send entries (we sealed; no verification on our side).
   */
  verification?: {
    valid:   boolean;
    reason?: string;
    detail?: string;
  };
  /**
   * Optional small summary of the payload for human inspection. Do NOT
   * store the full payload — that bloats the audit and may duplicate
   * sensitive data. Pick a handful of identifying fields (e.g. price,
   * round, action) when relevant.
   */
  payloadSummary?: Record<string, unknown>;
}

// ────────────────────────────────────────────────────────────────────────────
// Collector
// ────────────────────────────────────────────────────────────────────────────

class MessageLogCollectorImpl {
  private logs = new Map<string, MessageLogEntry[]>();

  /** Record an outbound (sealed-by-us) message. */
  recordSend(opts: {
    negotiationId: string;
    sealed:        SealedMessage<unknown>;
    payloadKind:   string;
    round?:        number;
    payloadSummary?: Record<string, unknown>;
  }): void {
    const entry: MessageLogEntry = {
      schemaVersion: 1,
      direction:     "send",
      round:         opts.round,
      payloadKind:   opts.payloadKind,
      recordedAt:    new Date().toISOString(),
      transportSignature: envelopeToTransportSignature(opts.sealed.envelope),
      payloadSummary: opts.payloadSummary,
    };
    this.appendEntry(opts.negotiationId, entry);
  }

  /** Record an inbound (verified-by-us) message. */
  recordReceive(opts: {
    negotiationId: string;
    sealed:        SealedMessage<unknown>;
    verification:  VerificationResult;
    payloadKind:   string;
    round?:        number;
    payloadSummary?: Record<string, unknown>;
  }): void {
    const entry: MessageLogEntry = {
      schemaVersion: 1,
      direction:     "receive",
      round:         opts.round,
      payloadKind:   opts.payloadKind,
      recordedAt:    new Date().toISOString(),
      transportSignature: envelopeToTransportSignature(opts.sealed.envelope),
      verification: {
        valid:  opts.verification.valid,
        reason: opts.verification.reason,
        detail: opts.verification.detail,
      },
      payloadSummary: opts.payloadSummary,
    };
    this.appendEntry(opts.negotiationId, entry);
  }

  /** Get all entries for a negotiation (in insertion order). Empty if unknown. */
  getLog(negotiationId: string): MessageLogEntry[] {
    return this.logs.get(negotiationId) ?? [];
  }

  /** Compute aggregate stats for the signing-posture block. */
  computeStats(negotiationId: string): MessageSigningStats {
    const entries = this.getLog(negotiationId);
    let sealed = 0, verified = 0, rejected = 0;
    const reasons: string[] = [];
    for (const e of entries) {
      if (e.direction === "send") {
        sealed++;
      } else {
        if (e.verification?.valid) verified++;
        else {
          rejected++;
          if (e.verification?.reason) reasons.push(e.verification.reason);
        }
      }
    }
    return {
      messagesSealed:   sealed,
      messagesVerified: verified,
      messagesRejected: rejected,
      rejectionReasons: reasons,
    };
  }

  /** Drop a negotiation's log (call after writing the audit). */
  clear(negotiationId: string): void {
    this.logs.delete(negotiationId);
  }

  /** Drop EVERY log. Used by tests; production callers should use clear(id). */
  _resetAll(): void {
    this.logs.clear();
  }

  private appendEntry(negotiationId: string, entry: MessageLogEntry): void {
    const arr = this.logs.get(negotiationId);
    if (arr) {
      arr.push(entry);
    } else {
      this.logs.set(negotiationId, [entry]);
    }
  }
}

/** Public type alias so callers don't have to import the private class. */
export type MessageLogCollector = MessageLogCollectorImpl;

let singleton: MessageLogCollectorImpl | null = null;

/** Process-wide singleton accessor. Lazy. */
export function getMessageLogCollector(): MessageLogCollector {
  if (!singleton) singleton = new MessageLogCollectorImpl();
  return singleton;
}

/** Test helper — drop the singleton entirely. */
export function _resetMessageLogCollector(): void { singleton = null; }

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function envelopeToTransportSignature(env: SignedEnvelope): MessageLogEntry["transportSignature"] {
  return {
    mode:            env.mode,
    senderAgentId:   env.senderAgentId,
    receiverAgentId: env.receiverAgentId,
    counter:         env.counter,
    timestamp:       env.timestamp,
    payloadHash:     env.payloadHash,
    envelopeHash:    env.envelopeHash,
    senderAid:       env.senderAid,
    signature:       env.signature,
  };
}
