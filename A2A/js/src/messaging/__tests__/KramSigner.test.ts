// ================= KRAM SIGNER ROUND-TRIP TEST (A.5.5) =================
// REAL end-to-end signing/verification across two live KERIA-backed agents:
//   buyer  = tommyBuyerAgent   (seals)
//   seller = jupiterSellerAgent (verifies)
//
// NO MOCKS of signify-ts, KERIA, or the KERI key material. Both KramSigner
// instances connect to the SAME live KERIA the smoke connected to, resolve
// their real Signer (manager.get(hab).signers[0] — confirmed populated by the
// A.4 smoke), and build real Verfers from the counterparties' info-file
// state.k[0]. The ONLY mock anywhere in this file is a tightly-scoped clock
// swap used solely by test C (stale-timestamp) so the sealed timestamp +
// signature + envelopeHash are all produced consistently in the past; verify()
// then runs under the real clock and legitimately trips the staleness check.
//
// WHY 5 TESTS, NOT 4: the handoff's "(b) tampered payload -> KRAM_SIGNATURE_INVALID"
// does not match the real verify() ordering. In KramSigner.verify() the payload
// hash is checked (PAYLOAD_HASH_MISMATCH) BEFORE the KERI signature is verified,
// so a tampered payload never reaches the signature path. We therefore split it:
//   B1: tampered payload    -> PAYLOAD_HASH_MISMATCH      (what the code does)
//   B2: corrupted signature -> KRAM_SIGNATURE_INVALID     (the signature path)
// This is stricter coverage than the original spec, and honest about reasons.
//
// REQUIRED ENV (machine-specific paths stay OUT of source, like the smoke):
//   KERIA_ADMIN_URL    e.g. http://localhost:3901   (host-reachable)
//   KERIA_BOOT_URL     e.g. http://localhost:3903
//   KERIA_OOBI_BASE    e.g. http://localhost:3902   (host-reachable OOBI base;
//                      remaps the docker host in each counterparty info OOBI)
//   BUYER_INFO_PATH    abs path to tommyBuyerAgent-info.json
//   SELLER_INFO_PATH   abs path to jupiterSellerAgent-info.json
// OPTIONAL ENV (sensible repo-relative defaults; override if your layout differs):
//   BUYER_BRAN_PATH    default: src/agents/buyer-agent/.secret/agent-bran.txt
//   SELLER_BRAN_PATH   default: src/agents/seller-agent/.secret/agent-bran.txt
//
// RUN (PowerShell):
//   $env:KERIA_ADMIN_URL="http://localhost:3901"
//   $env:KERIA_BOOT_URL="http://localhost:3903"
//   $env:KERIA_OOBI_BASE="http://localhost:3902"
//   $env:BUYER_INFO_PATH="C:\...\legentvLEI\task-data\tommyBuyerAgent-info.json"
//   $env:SELLER_INFO_PATH="C:\...\legentvLEI\task-data\jupiterSellerAgent-info.json"
//   node --import tsx --test "src/messaging/__tests__/KramSigner.test.ts"
// (fallback if your tsx forwards --test: npx tsx --test "src/messaging/__tests__/KramSigner.test.ts")

import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { KramSigner } from "../KramSigner.js";

// Logical agent ids (independent of the KERI AIDs — verify() resolves the
// signing key by the in-band senderAid, not by these names).
const BUYER = "tommyBuyerAgent";
const SELLER = "jupiterSellerAgent";

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`[A.5.5] ${name} is required (see file header for the full env list)`);
  return v;
}

function envOrDefault(name: string, fallback: string): string {
  const v = process.env[name]?.trim();
  return v && v.length > 0 ? v : fallback;
}

function readAid(infoPath: string): string {
  const info = JSON.parse(fs.readFileSync(infoPath, "utf8")) as { aid?: string };
  if (!info.aid) throw new Error(`[A.5.5] ${infoPath} has no "aid"`);
  return info.aid;
}

/**
 * Construct a KramSigner for one role. KramSigner reads its paths from env IN
 * ITS CONSTRUCTOR, so we set the env, construct, and the instance captures it.
 * KERIA_ADMIN_URL/BOOT_URL are read later (at init()) and are shared, so we set
 * them once in before() and leave them.
 */
function buildSigner(branPath: string, ownInfoPath: string, counterpartyInfoPath: string): KramSigner {
  process.env.AGENT_BRAN_PATH = branPath;
  process.env.AGENT_INFO_PATH = ownInfoPath;
  process.env.KRAM_COUNTERPARTY_INFO_PATHS = counterpartyInfoPath;
  return new KramSigner();
}

/**
 * The sole mock in this file: run `fn` with `new Date()` / Date.now() pinned to
 * `atMs`. Used only by test C so the sealed envelope is internally consistent
 * at a past instant. Restored in finally; verify() always runs under real time.
 */
function atFixedClock<T>(atMs: number, fn: () => T): T {
  const RealDate = Date;
  const Mock = function (this: unknown, ...args: unknown[]) {
    // new Date()  -> the fixed instant; new Date(x) -> delegate to the real ctor
    return args.length === 0
      ? new (RealDate as unknown as new (ms: number) => Date)(atMs)
      : new (RealDate as unknown as new (...a: unknown[]) => Date)(...args);
  } as unknown as DateConstructor;
  Mock.now = () => atMs;
  (globalThis as { Date: DateConstructor }).Date = Mock;
  try {
    return fn();
  } finally {
    (globalThis as { Date: DateConstructor }).Date = RealDate;
  }
}

const samplePayload = () => ({
  kind: "counter-offer",
  invoiceId: "INV-A55-001",
  proposedDiscountBps: 125,
  note: "A.5.5 round-trip",
});

let buyer: KramSigner;
let seller: KramSigner;
let buyerAid: string;

before(async () => {
  // Shared KERIA endpoints (read by getOrCreateClient at init()).
  process.env.KERIA_ADMIN_URL = requireEnv("KERIA_ADMIN_URL");
  process.env.KERIA_BOOT_URL = requireEnv("KERIA_BOOT_URL");
  // A.6: live key resolution remaps the docker-internal OOBI host to this base.
  process.env.KERIA_OOBI_BASE = requireEnv("KERIA_OOBI_BASE");

  const buyerBran = envOrDefault("BUYER_BRAN_PATH", "src/agents/buyer-agent/.secret/agent-bran.txt");
  const sellerBran = envOrDefault("SELLER_BRAN_PATH", "src/agents/seller-agent/.secret/agent-bran.txt");
  const buyerInfo = requireEnv("BUYER_INFO_PATH");
  const sellerInfo = requireEnv("SELLER_INFO_PATH");

  buyerAid = readAid(buyerInfo);

  // Buyer signs; needs the seller's key as a counterparty (and vice versa) so
  // either side could verify the other. For these tests buyer seals, seller verifies.
  buyer = buildSigner(buyerBran, buyerInfo, sellerInfo);
  await buyer.init();

  seller = buildSigner(sellerBran, sellerInfo, buyerInfo);
  await seller.init();
});

beforeEach(() => {
  // Isolate counters so each test starts from a clean (sender,receiver) state.
  buyer.resetCounters();
  seller.resetCounters();
});

// ── A: happy path — buyer seal -> seller verify succeeds ─────────────────────
test("A: buyer seal -> seller verify succeeds with a real KERI signature", async () => {
  const sealed = buyer.seal(samplePayload(), BUYER, SELLER);

  assert.equal(sealed.envelope.mode, "kram");
  assert.equal(sealed.envelope.senderAid, buyerAid, "envelope carries the buyer's real AID");
  assert.ok(sealed.envelope.signature && sealed.envelope.signature.length > 0, "signature present");

  const res = await seller.verify(sealed, SELLER);
  assert.equal(res.valid, true, `expected valid, got reason=${res.reason} detail=${res.detail}`);
  assert.equal(res.reason, undefined);
});

// ── B1: tampered payload -> PAYLOAD_HASH_MISMATCH (fires before signature) ───
test("B1: tampered payload is rejected with PAYLOAD_HASH_MISMATCH", async () => {
  const sealed = buyer.seal(samplePayload(), BUYER, SELLER);
  // Mutate the payload after sealing; payloadHash recompute will not match.
  (sealed.payload as Record<string, unknown>).proposedDiscountBps = 999;

  const res = await seller.verify(sealed, SELLER);
  assert.equal(res.valid, false);
  assert.equal(res.reason, "PAYLOAD_HASH_MISMATCH");
});

// ── B2: corrupted signature (hashes intact) -> KRAM_SIGNATURE_INVALID ────────
test("B2: corrupted signature is rejected with KRAM_SIGNATURE_INVALID", async () => {
  const sealed = buyer.seal(samplePayload(), BUYER, SELLER);
  const sig = sealed.envelope.signature!;
  // Flip one character in the signature material (keep length/format so the
  // CESR Cigar still decodes, then verifies false). Pick a char near the end
  // and swap it for a guaranteed-different base64 char.
  const i = sig.length - 5;
  const swapped = sig[i] === "A" ? "B" : "A";
  sealed.envelope.signature = sig.slice(0, i) + swapped + sig.slice(i + 1);

  const res = await seller.verify(sealed, SELLER);
  assert.equal(res.valid, false);
  assert.equal(res.reason, "KRAM_SIGNATURE_INVALID");
});

// ── C: stale timestamp (clock-mocked seal only) -> KRAM_TIMESTAMP_STALE ──────
test("C: stale timestamp is rejected with KRAM_TIMESTAMP_STALE", async () => {
  // Seal 10 minutes in the past (> the 5-min default MAX_MESSAGE_AGE_MS). The
  // signature and envelopeHash are produced for that past timestamp, so verify()
  // reaches the staleness check rather than failing on a hash/sig mismatch.
  const tenMinAgo = Date.now() - 10 * 60 * 1000;
  const sealed = atFixedClock(tenMinAgo, () => buyer.seal(samplePayload(), BUYER, SELLER));

  const res = await seller.verify(sealed, SELLER);
  assert.equal(res.valid, false);
  assert.equal(res.reason, "KRAM_TIMESTAMP_STALE");
});

// ── D: replay (same envelope verified twice) -> KRAM_REPLAY_DETECTED ─────────
test("D: replayed envelope is rejected with KRAM_REPLAY_DETECTED", async () => {
  const sealed = buyer.seal(samplePayload(), BUYER, SELLER); // counter = 1

  const first = await seller.verify(sealed, SELLER);
  assert.equal(first.valid, true, `first verify should pass, got ${first.reason}`);

  // Re-presenting the identical envelope: counter (1) <= last accepted (1).
  const second = await seller.verify(sealed, SELLER);
  assert.equal(second.valid, false);
  assert.equal(second.reason, "KRAM_REPLAY_DETECTED");
});
