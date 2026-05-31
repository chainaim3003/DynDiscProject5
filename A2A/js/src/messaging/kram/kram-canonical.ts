// ================= KRAM CANONICAL SIGNING STRING (shared contract) =================
// THE single source of truth for the bytes a KRAM KERI signature covers.
//
// WHY THIS FILE EXISTS:
// The signature must mean the same thing on BOTH transports:
//   - A.5 (this codebase): buyer<->seller over the JSON envelope model.
//   - A.6 (vLEI server):   DD->server over HTTP headers (RFC 9530).
// If each side composed its own signing bytes, a signature produced by
// KramSigner.seal() could never be re-verified by the server middleware.
// So the signature covers exactly three fields that map 1:1 to the RFC 9530
// headers A.6 will use:
//
//   canonical "resource"        <-> Signify-Resource   (the sender KERI AID)
//   canonical "created"         <-> Signify-Timestamp  (ISO-8601 send time)
//   canonical "content-digest"  <-> Content-Digest     (sha-256 of the body)
//
// It deliberately does NOT include the envelope's counter or receiverAgentId:
// those are envelope-only concepts the header transport never sees. Replay and
// envelope-tamper protection are handled separately by the envelope's counter
// and envelopeHash checks; the SIGNATURE is about identity over portable bytes.
//
// A.6 UPDATE (RFC 9530): the content-digest is the STANDARD base64 of the raw
// SHA-256 of the body, formatted as the RFC 9530 structured-field Byte Sequence
// `:<base64>:`. This matches exactly what the `Content-Digest: sha-256=:...:`
// header carries, so the A.6 server middleware reconstructs this exact string
// from the parsed header. Changed ONCE, here, for both transports -- do not
// fork it. (Pre-A.6 this field was lowercase hex; A.6 moved it to RFC-9530
// base64. The envelope's own `payloadHash` stays hex for the separate
// tamper-hash layer; only the SIGNED canonical bytes changed.)

const KRAM_SIGNING_VERSION = "kram-v1";

export interface KramSigningInput {
  /** Sender KERI AID prefix (maps to Signify-Resource). */
  senderAid: string;
  /** ISO-8601 timestamp (maps to Signify-Timestamp). */
  timestamp: string;
  /**
   * RFC 9530 Content-Digest value: STANDARD base64 (NOT hex, NOT base64url) of
   * the raw SHA-256 digest of the serialized payload. Maps 1:1 to the byte
   * sequence inside `Content-Digest: sha-256=:<base64>:`.
   */
  contentDigestB64: string;
}

/**
 * Build the canonical signing string. Deterministic: same inputs -> same bytes.
 * Both seal() and verify() (and the A.6 server) call this so they agree.
 */
export function buildKramSigningString(input: KramSigningInput): string {
  if (!input.senderAid) throw new Error("[kram-canonical] senderAid is required");
  if (!input.timestamp) throw new Error("[kram-canonical] timestamp is required");
  if (!input.contentDigestB64) {
    throw new Error("[kram-canonical] contentDigestB64 is required");
  }
  // Newline-joined, fixed field order, explicit labels. The content-digest line
  // is the RFC 9530 structured-field Byte Sequence form `sha-256=:<base64>:`, so
  // the A.6 server rebuilds it verbatim from the parsed Content-Digest header.
  return [
    KRAM_SIGNING_VERSION,
    `resource:${input.senderAid}`,
    `created:${input.timestamp}`,
    `content-digest:sha-256=:${input.contentDigestB64}:`,
  ].join("\n");
}

/** Convenience: the signing string as the UTF-8 bytes that get signed/verified. */
export function buildKramSigningBytes(input: KramSigningInput): Uint8Array {
  return new TextEncoder().encode(buildKramSigningString(input));
}
