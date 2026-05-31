// ================= KRAM SIGNER (A.5 implementation) =================
// KERI-backed signing mode over the EXISTING JSON envelope model.
//
// Architecture (locked decision #1): KRAM is a NEW signing mode that plugs into
// the EXISTING MessageSigner interface and SignedEnvelope shape. Like
// PlainHashSigner it returns a {envelope, payload} SealedMessage and reuses the
// payloadHash / envelopeHash / monotonic-counter machinery. UNLIKE it, the
// envelope carries a real KERI signature (in the existing `signature` field)
// plus the sender's AID (in the additive `senderAid` field), giving identity +
// non-repudiation.
//
// WHAT THE SIGNATURE COVERS: not envelopeHash, but the shared canonical string
// (senderAid + timestamp + payloadHash) from ./kram/kram-canonical.ts, so a
// signature produced here is reconstructable/verifiable by the A.6 server
// middleware over RFC 9530 headers. See that file for the rationale.
//
// SYNC seal / ASYNC verify (A.6): seal() is synchronous (own Signer is cached
// in init()). verify() is ASYNC because A.6 resolves the sender's CURRENT key
// live from KERIA at verify time (rotation-aware) rather than from a frozen
// snapshot. init() does the one-time async setup:
//   - getOrCreateClient(bran) + connect          (own private key access)
//   - resolve OWN AID -> own Signer (cached)      (for seal)
//   - record each counterparty's OOBI            (for verify; key resolved live)
// seal() uses the cached Signer synchronously (Signer.sign -> Cigar); verify()
// awaits VerferResolver (oobis().resolve + keyStates().query -> Verfer.verify).
//
// DEVIATIONS FROM THE .md A.5 (deliberate, see PHASE_A doc reconciliation):
//   - Replay protection reuses the envelope's monotonic counter
//     (-> KRAM_REPLAY_DETECTED). The .md's standalone TTL dedup-cache belongs
//     to the header model and is deferred to A.6.
//   - A.6 D1 (DONE): the counterparty Verfer is resolved LIVE via
//     oobis().resolve() + keyStates().query() at verify time (rotation-aware),
//     replacing the A.5 frozen info-file state.k[0] snapshot. verify() is async
//     as a result. Latest-key-state only; sn-pinned resolution is a future item.
//
// Constraints honored: no mocks; BRAN path + KERIA URLs + counterparty info
// paths from env; missing config throws at startup; pinned signify-ts.

import fs from "node:fs";
import crypto from "node:crypto";

import { MessageSigner } from "./MessageSigner.js";
import {
  SealedMessage,
  SignedEnvelope,
  VerificationResult,
  SignerConfig,
  SigningMode,
} from "./signed-message.js";
import { getOrCreateClient } from "./kram/signify-client.js";
import { buildKramSigningBytes } from "./kram/kram-canonical.js";
import { VerferResolver } from "./kram-internal/oobi-resolver.js";

import { Cigar } from "signify-ts";
import type { SignifyClient, Signer, Verfer } from "signify-ts";

/** Shape of the pipeline-produced <name>-info.json we read AIDs + keys from. */
interface AgentInfoFile {
  aid: string;
  oobi?: string;
  state?: { k?: string[] };
}

export class KramSigner implements MessageSigner {
  private readonly maxAgeMs: number;
  private readonly maxFutureMs: number;

  private readonly bran: string;
  /** Path to THIS agent's info file (own AID). From AGENT_INFO_PATH. */
  private readonly ownInfoPath: string;
  /** Paths to counterparties' info files (their AID + pubkey). */
  private readonly counterpartyInfoPaths: string[];

  private readonly sendCounters = new Map<string, number>();
  private readonly receiveCounters = new Map<string, number>();

  private client: SignifyClient | null = null;
  private initialized = false;

  /** This agent's own AID + Signer, resolved in init(). */
  private ownAid: string | null = null;
  private ownSigner: Signer | null = null;
  /**
   * Live key resolver (A.6 D1): resolves a counterparty AID -> CURRENT Verfer
   * via KERIA (oobis().resolve + keyStates().query), replacing the A.5 static
   * info-file snapshot. Built in init() once the client is connected.
   */
  private resolver: VerferResolver | null = null;
  /** Counterparty AID -> its OOBI (from the info file), fed to the resolver. */
  private readonly oobiByAid = new Map<string, string>();

  constructor(config: SignerConfig = {}) {
    this.maxAgeMs =
      config.maxMessageAgeMs ?? Number(process.env.MAX_MESSAGE_AGE_MS ?? 300_000);
    this.maxFutureMs =
      config.maxFutureSkewMs ?? Number(process.env.MAX_FUTURE_SKEW_MS ?? 30_000);

    // ── BRAN: read synchronously, fail fast ────────────────────────────────
    const branPath = process.env.AGENT_BRAN_PATH?.trim();
    if (!branPath) {
      throw new Error(
        "[kram] AGENT_BRAN_PATH is not set. Point it at this agent's " +
          "BRAN file (e.g. <role>-agent/.secret/agent-bran.txt)."
      );
    }
    if (!fs.existsSync(branPath)) {
      throw new Error(`[kram] BRAN file not found at AGENT_BRAN_PATH=${branPath}`);
    }
    const bran = fs.readFileSync(branPath, "utf8").trim();
    if (bran.length === 0) {
      throw new Error(`[kram] BRAN file at ${branPath} is empty.`);
    }
    this.bran = bran;

    // ── Own info path: required (gives our own AID for seal) ────────────────
    const ownInfoPath = process.env.AGENT_INFO_PATH?.trim();
    if (!ownInfoPath) {
      throw new Error(
        "[kram] AGENT_INFO_PATH is not set. Point it at this agent's " +
          "<name>-info.json (provides our own KERI AID)."
      );
    }
    this.ownInfoPath = ownInfoPath;

    // ── Counterparty info paths: required for verify() ──────────────────────
    // Comma-separated list of the OTHER agents' *-info.json files. We build a
    // verfer per counterparty AID so verify() can check inbound signatures.
    const cp = process.env.KRAM_COUNTERPARTY_INFO_PATHS?.trim();
    if (!cp) {
      throw new Error(
        "[kram] KRAM_COUNTERPARTY_INFO_PATHS is not set. Provide a " +
          "comma-separated list of the counterparties' <name>-info.json paths " +
          "so verify() can resolve their signing keys."
      );
    }
    this.counterpartyInfoPaths = cp.split(",").map((p) => p.trim()).filter(Boolean);
    if (this.counterpartyInfoPaths.length === 0) {
      throw new Error("[kram] KRAM_COUNTERPARTY_INFO_PATHS is empty after parsing.");
    }
  }

  mode(): SigningMode {
    return "kram";
  }

  // ── Async one-time setup ───────────────────────────────────────────────────
  async init(): Promise<void> {
    if (this.initialized) return;

    // Connect (unlocks our private key material via signify).
    this.client = await getOrCreateClient(this.bran);

    // Resolve OUR own AID from our info file, then our Signer from the manager.
    const ownInfo = this.readInfoFile(this.ownInfoPath);
    this.ownAid = ownInfo.aid;

    if (!this.client.manager) {
      throw new Error("[kram] signify client has no manager after connect().");
    }
    // RUNTIME-PENDING(1): identifiers().get(prefix) -> HabState, then
    // manager.get(hab).signers[0] is our Signer. Types confirm the shape;
    // the A.4 smoke confirms signers[] is populated at runtime.
    const hab = await this.client.identifiers().get(this.ownAid);
    const km = this.client.manager.get(hab);
    if (!km.signers || km.signers.length === 0) {
      throw new Error(
        `[kram] no signer resolved for own AID ${this.ownAid}. ` +
          `Is this BRAN the controller of that AID on this KERIA?`
      );
    }
    this.ownSigner = km.signers[0];

    // A.6 D1 (live resolution): instead of snapshotting each counterparty's
    // Verfer from the info-file state.k[0] (frozen; not rotation-aware), record
    // each counterparty's OOBI and resolve the CURRENT key from KERIA at verify
    // time via the resolver. The info file supplies the OOBI; KERIA supplies
    // the live key state.
    const oobiBase = process.env.KERIA_OOBI_BASE?.trim();
    if (!oobiBase) {
      throw new Error(
        "[kram] KERIA_OOBI_BASE is not set. Set it to the host-reachable KERIA " +
          "OOBI base (e.g. http://localhost:3902). It remaps the docker-internal " +
          "OOBI host in each counterparty info file so live key resolution works."
      );
    }
    this.resolver = new VerferResolver(this.client, { oobiBase });

    for (const p of this.counterpartyInfoPaths) {
      const info = this.readInfoFile(p);
      if (!info.oobi) {
        throw new Error(
          `[kram] counterparty info ${p} has no "oobi" (needed for live key ` +
            `resolution). Re-run the pipeline to regenerate the info file.`
        );
      }
      this.oobiByAid.set(info.aid, info.oobi);
    }

    this.initialized = true;
  }

  // ── Sealing ─────────────────────────────────────────────────────────────────
  seal<T>(payload: T, senderAgentId: string, receiverAgentId: string): SealedMessage<T> {
    if (!this.initialized || !this.ownSigner || !this.ownAid) {
      throw new Error(
        "[kram] seal() called before init(). Call `await signer.init()` once " +
          "after construction (the factory logs this reminder)."
      );
    }

    const pairKey = `${senderAgentId}\u2192${receiverAgentId}`;
    const counter = (this.sendCounters.get(pairKey) ?? 0) + 1;
    this.sendCounters.set(pairKey, counter);

    const timestamp = new Date().toISOString();
    const payloadHash = this.hashPayload(payload);
    const envelopeHash = this.hashEnvelope({
      senderAgentId, receiverAgentId, counter, timestamp, payloadHash,
    });

    // KERI signature over the SHARED canonical string (portable to A.6).
    // RFC 9530: the canonical content-digest is STANDARD base64 of the RAW
    // sha-256 digest. payloadHash is hex (envelope/tamper layer) -> convert.
    const contentDigestB64 = Buffer.from(payloadHash, "hex").toString("base64");
    const signingBytes = buildKramSigningBytes({
      senderAid: this.ownAid,
      timestamp,
      contentDigestB64,
    });
    // RUNTIME-PENDING(3): Signer.sign(bytes) with no index returns a Cigar
    // (non-indexed). cigar.qb64 is the CESR signature for the envelope.
    const result = this.ownSigner.sign(signingBytes);
    const cigar = result as Cigar;
    const signature = (cigar as unknown as { qb64: string }).qb64;
    if (!signature) {
      throw new Error("[kram] signer.sign() did not yield a qb64 signature.");
    }

    const envelope: SignedEnvelope = {
      mode: "kram",
      senderAgentId,
      receiverAgentId,
      counter,
      timestamp,
      payloadHash,
      envelopeHash,
      signature,
      senderAid: this.ownAid,
    };

    return { envelope, payload };
  }

  // ── Verification ──────────────────────────────────────────────────────────
  async verify<T>(
    sealed: SealedMessage<T>,
    expectedReceiver: string
  ): Promise<VerificationResult> {
    if (!this.initialized || !this.resolver) {
      throw new Error("[kram] verify() called before init().");
    }
    if (!sealed || !sealed.envelope) {
      return { valid: false, reason: "MISSING_ENVELOPE", detail: "No envelope" };
    }
    const env = sealed.envelope;

    if (env.mode !== "kram") {
      return {
        valid: false, reason: "MODE_MISMATCH",
        detail: `Envelope claims mode "${env.mode}" but receiver is in kram mode`,
        envelope: env,
      };
    }
    if (env.receiverAgentId !== expectedReceiver) {
      return {
        valid: false, reason: "ENVELOPE_HASH_MISMATCH",
        detail: `Envelope addressed to "${env.receiverAgentId}", we are "${expectedReceiver}"`,
        envelope: env,
      };
    }
    if (!env.senderAid) {
      return {
        valid: false, reason: "KRAM_SIGNATURE_INVALID",
        detail: "Envelope missing senderAid (cannot resolve signing key)",
        envelope: env,
      };
    }
    if (!env.signature) {
      return {
        valid: false, reason: "KRAM_SIGNATURE_INVALID",
        detail: "Envelope missing signature", envelope: env,
      };
    }

    // ── Timestamp (KRAM-specific staleness reason) ────────────────────────
    const ts = Date.parse(env.timestamp);
    if (isNaN(ts)) {
      return { valid: false, reason: "KRAM_TIMESTAMP_STALE",
        detail: `Unparseable timestamp: ${env.timestamp}`, envelope: env };
    }
    const ageMs = Date.now() - ts;
    if (ageMs > this.maxAgeMs) {
      return { valid: false, reason: "KRAM_TIMESTAMP_STALE",
        detail: `Message ${Math.floor(ageMs / 1000)}s old, max ${this.maxAgeMs / 1000}s`,
        envelope: env };
    }
    if (ageMs < -this.maxFutureMs) {
      return { valid: false, reason: "TIMESTAMP_FUTURE",
        detail: `Timestamp ${Math.floor(-ageMs / 1000)}s in the future`, envelope: env };
    }

    // ── Replay via monotonic counter (reused from envelope model) ─────────
    const pairKey = `${env.senderAgentId}\u2192${env.receiverAgentId}`;
    const lastSeen = this.receiveCounters.get(pairKey) ?? 0;
    if (env.counter <= lastSeen) {
      return { valid: false, reason: "KRAM_REPLAY_DETECTED",
        detail: `counter=${env.counter} but last accepted was ${lastSeen}`, envelope: env };
    }

    // ── Payload + envelope tamper-evidence (hash layer) ───────────────────
    const recomputedPayloadHash = this.hashPayload(sealed.payload);
    if (recomputedPayloadHash !== env.payloadHash) {
      return { valid: false, reason: "PAYLOAD_HASH_MISMATCH",
        detail: "Payload altered in flight", envelope: env };
    }
    const recomputedEnvelopeHash = this.hashEnvelope({
      senderAgentId: env.senderAgentId, receiverAgentId: env.receiverAgentId,
      counter: env.counter, timestamp: env.timestamp, payloadHash: env.payloadHash,
    });
    if (recomputedEnvelopeHash !== env.envelopeHash) {
      return { valid: false, reason: "ENVELOPE_HASH_MISMATCH",
        detail: "Envelope fields altered", envelope: env };
    }

    // ── KERI signature (identity layer) ───────────────────────────────────
    // A.6 D1: resolve the sender's CURRENT signing key live from KERIA
    // (rotation-aware), rather than a frozen info-file snapshot.
    const oobi = this.oobiByAid.get(env.senderAid);
    if (!oobi) {
      return { valid: false, reason: "KRAM_SIGNATURE_INVALID",
        detail: `No known OOBI for sender AID ${env.senderAid}. ` +
          `Add its info file to KRAM_COUNTERPARTY_INFO_PATHS.`,
        envelope: env };
    }
    let verfer: Verfer;
    try {
      verfer = await this.resolver.resolveVerfer(env.senderAid, oobi);
    } catch (e) {
      return { valid: false, reason: "KRAM_SIGNATURE_INVALID",
        detail: `Live key resolution failed for AID ${env.senderAid}: ${(e as Error).message}`,
        envelope: env };
    }
    const contentDigestB64 = Buffer.from(env.payloadHash, "hex").toString("base64");
    const signingBytes = buildKramSigningBytes({
      senderAid: env.senderAid, timestamp: env.timestamp, contentDigestB64,
    });
    // RUNTIME-PENDING(4): decode the qb64 signature back to raw bytes (via
    // Cigar) and verify against the verfer. Types confirm the path; the
    // round-trip test confirms the CESR decode + verify.
    let ok: boolean;
    try {
      const sigRaw = (new Cigar({ qb64: env.signature }) as unknown as { raw: Uint8Array }).raw;
      ok = verfer.verify(sigRaw, signingBytes);
    } catch (e) {
      return { valid: false, reason: "KRAM_SIGNATURE_INVALID",
        detail: `Signature decode/verify threw: ${(e as Error).message}`, envelope: env };
    }
    if (!ok) {
      return { valid: false, reason: "KRAM_SIGNATURE_INVALID",
        detail: "KERI signature did not verify against sender's key", envelope: env };
    }

    // Commit counter only on full success.
    this.receiveCounters.set(pairKey, env.counter);
    return { valid: true, envelope: env };
  }

  // ── A.6 HTTP producer ───────────────────────────────────────────────────
  // Sign `payload` for transmission over RFC 9530 / Signify HTTP headers,
  // mirroring seal() but emitting the 4 headers the A.6 server middleware
  // verifies (instead of the JSON envelope). The signature covers the SAME
  // canonical bytes as seal() (kram-canonical.buildKramSigningBytes), so the
  // server re-derives them verbatim from the headers.
  //
  // `body` is the EXACT bytes the caller must send as the request body: the
  // server hashes the raw received bytes and compares to Content-Digest, so the
  // transmitted body must be this string unchanged (same JSON serialization the
  // digest was computed over).
  produceHttpHeaders<T>(payload: T): { body: string; headers: Record<string, string> } {
    if (!this.initialized || !this.ownSigner || !this.ownAid) {
      throw new Error(
        "[kram] produceHttpHeaders() called before init(). Call `await signer.init()` first."
      );
    }
    const body = JSON.stringify(payload);
    // STANDARD base64 of the raw sha-256 of the body bytes (RFC 9530). Equals
    // seal()'s contentDigestB64 for the same payload (both hash JSON.stringify).
    const contentDigestB64 = crypto.createHash("sha256").update(body).digest("base64");
    const timestamp = new Date().toISOString();

    const signingBytes = buildKramSigningBytes({
      senderAid: this.ownAid,
      timestamp,
      contentDigestB64,
    });
    const cigar = this.ownSigner.sign(signingBytes) as Cigar;
    const signature = (cigar as unknown as { qb64: string }).qb64;
    if (!signature) {
      throw new Error("[kram] produceHttpHeaders: signer.sign() did not yield a qb64 signature.");
    }

    return {
      body,
      headers: {
        "Content-Type": "application/json",
        "Content-Digest": `sha-256=:${contentDigestB64}:`,
        "Signify-Resource": this.ownAid,
        "Signify-Timestamp": timestamp,
        "Signify-Signature": signature,
      },
    };
  }

  resetCounters(): void {
    this.sendCounters.clear();
    this.receiveCounters.clear();
  }

  // ── Internals ───────────────────────────────────────────────────────────
  private readInfoFile(path: string): AgentInfoFile {
    if (!fs.existsSync(path)) {
      throw new Error(`[kram] info file not found: ${path}`);
    }
    let parsed: AgentInfoFile;
    try {
      parsed = JSON.parse(fs.readFileSync(path, "utf8")) as AgentInfoFile;
    } catch (e) {
      throw new Error(`[kram] failed to parse info file ${path}: ${(e as Error).message}`);
    }
    if (!parsed.aid) throw new Error(`[kram] info file ${path} has no "aid".`);
    return parsed;
  }

  private hashPayload(payload: unknown): string {
    return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  }

  private hashEnvelope(parts: {
    senderAgentId: string; receiverAgentId: string;
    counter: number; timestamp: string; payloadHash: string;
  }): string {
    const canonical = [
      parts.senderAgentId, parts.receiverAgentId,
      String(parts.counter), parts.timestamp, parts.payloadHash,
    ].join("|");
    return crypto.createHash("sha256").update(canonical).digest("hex");
  }
}
