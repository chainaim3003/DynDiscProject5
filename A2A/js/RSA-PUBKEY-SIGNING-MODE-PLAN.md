# Implementation Plan — `pubkey` Signing Mode (raw public-key signing, no KERI)

> **Status:** DESIGN — not yet built. To be developed in a later cycle.
> **Author of plan:** drafted with Claude, grounded in the live `MessageSigner`
> interface as of 2026-05-31. Forward-looking sections are labelled.
>
> **Honesty note (read first):** A plan describes things that do not exist yet,
> so it cannot be "verified from code" the way a fact can. Throughout this doc:
> - **[VERIFIED]** = read from the actual codebase this session.
> - **[PROPOSAL]** = a design choice you can change; nothing in code yet.
> - **[VERIFY BEFORE BUILDING]** = assumed true but must be re-checked against
>   the live code before a developer writes it.
> Do not treat [PROPOSAL] / [VERIFY...] items as established fact.

---

## 0. What this mode is (and is not)

This adds a **third** message-signing tier between the two that exist today,
so the ladder becomes:

| Mode | Class | What it does | Status |
|---|---|---|---|
| `plain` | `PlainHashSigner` | sha256 hash + counter + timestamp. Tamper/replay detection, **no identity**. | [VERIFIED] exists |
| `pubkey` | `PubKeySigner` *(new)* | Raw public-key digital signature (Ed25519). Proves "who sent it" via a keypair, **without** KERI's key-history / rotation / vLEI machinery. | **this plan** |
| `kram` | `KramSigner` | KERI-keyed Ed25519 signature, live key resolution, path to vLEI legal binding. | [VERIFIED] exists |

**`pubkey` is "public-key signing minus KERI."** It gives real cryptographic
proof of sender (better than `plain`) but is simpler than `kram`: keys are flat
files, there is no Key Event Log, no rotation history, no witness/OOBI
resolution, no vLEI. It is the right choice when you want genuine message
authenticity without standing up the KERI/KERIA stack.

### Naming + crypto decisions (lock these before Iteration 1)

- **DECISION A — mode name.** [PROPOSAL] use `pubkey` (class `PubKeySigner`).
  Neutral, says what it is, crypto-agnostic. Alternatives: `simplekey`,
  `ed25519`. *You chose a neutral name; `pubkey` is the recommendation.*
- **DECISION B — algorithm.** [PROPOSAL] use **Ed25519**, NOT RSA. Reason:
  Ed25519 is already in the codebase (KRAM uses it via signify-ts), it is
  smaller and faster than RSA, and it needs no extra heavyweight dependency.
  Choose RSA only if an external system specifically requires RSA verification.
  *(The earlier working name "RSA" is kept here only as the colloquial label;
  the implementation should be Ed25519 unless you override.)*
- **DECISION C — key source.** [PROPOSAL] each agent reads its own private key
  from a PEM/raw key file via an env var (mirrors how `kram` reads its BRAN
  file), and reads each counterparty's **public** key from a file/agent-card.
  No network, no KERIA.

---

## 1. Grounding — the contract every signer must satisfy [VERIFIED]

Read from `src/messaging/MessageSigner.ts` this session. `PubKeySigner` MUST
implement this interface exactly:

```
mode(): SigningMode
seal<T>(payload: T, senderAgentId: string, receiverAgentId: string): SealedMessage<T>
verify<T>(sealed: SealedMessage<T>, expectedReceiver: string): Promise<VerificationResult>
init?(): Promise<void>          // optional one-time async setup
resetCounters?(): void          // optional; tests only
```

Key facts that constrain the design [VERIFIED]:
- `seal()` is **synchronous**; `verify()` is **async** (`Promise<VerificationResult>`).
- `verify()` MUST NOT throw — it returns `{ valid:false, reason, detail }` on
  failure. Receivers decide what to do.
- Mode selection is in `src/messaging/index.ts` via `getMessageSigner()` reading
  `process.env.SIGNING_MODE`. Today it recognises `plain`, `kram`, and throws on
  `vlei`. [VERIFIED]
- The envelope type is `SignedEnvelope` in `src/messaging/signed-message.ts`,
  carrying at least `mode, senderAgentId, receiverAgentId, counter, timestamp,
  payloadHash, envelopeHash` and (for signed modes) `signature` + `senderAid`.
  [VERIFY BEFORE BUILDING — re-read this file to confirm exact fields; the
  `senderAid` field name may want a more neutral `senderKeyId` for pubkey.]

---

## 2. The unsealed-message gap (must be addressed by this work) [VERIFIED]

Both agents' `execute()` currently process an **unsealed** message (no envelope)
with only a warning, in any signing mode. For a signed mode this means an
attacker can bypass signing by simply omitting the envelope.

**This plan REQUIRES that `pubkey` mode reject unsealed messages** (see
Iteration 4). Building a new signed mode while leaving the gap open would make
`pubkey` "verify-if-present," not "always-require" — which is not real security.
This is non-negotiable for the mode to be relied upon.

---

## 3. Iterations (no shortcuts)

Each iteration is independently testable and leaves the system working. Do them
in order.

### Iteration 0 — Decisions + key material
**Goal:** lock the 3 decisions (A name, B algorithm, C key source) and produce
test keypairs.
- Lock DECISION A / B / C above in writing.
- [PROPOSAL] Generate one Ed25519 keypair per agent (buyer, seller, treasury).
  Private key → a file referenced by env; public key → distributable.
- Decide the env var names. [PROPOSAL]:
  - `PUBKEY_PRIVATE_KEY_PATH` — this agent's private key file.
  - `PUBKEY_COUNTERPARTY_KEYS` — comma-separated `agentId:publicKeyPath` (or a
    JSON map). How the verifier finds the sender's public key.
- **Exit test:** keys exist; a throwaway script signs a string and verifies it
  with the matching public key. Pure crypto sanity, no app code yet.

### Iteration 1 — Canonical signing bytes (shared, byte-for-byte)
**Goal:** define exactly what bytes get signed, so seal and verify agree.
- [PROPOSAL] Reuse the **same canonical string** concept KRAM uses
  (`senderId + timestamp + payloadHash`) so behaviour is consistent across
  modes and the audit story stays uniform. [VERIFY BEFORE BUILDING — read
  `src/messaging/kram/kram-canonical.ts`; either import it or write a parallel
  `pubkey-canonical.ts` with the identical format.]
- Write the canonicalizer + a unit test proving the same input → same bytes.
- **Exit test:** unit test green; same payload always yields identical bytes.

### Iteration 2 — `PubKeySigner.seal()` (sign outgoing)
**Goal:** produce a signed envelope.
- New file `src/messaging/PubKeySigner.ts` implementing `MessageSigner`.
- `mode()` returns the new `SigningMode` value (add `"pubkey"` to the
  `SigningMode` union in `signed-message.ts`). [VERIFY BEFORE BUILDING — the
  union currently lists `plain | kram | vlei`; add `pubkey`.]
- `seal()`: compute `payloadHash` + `envelopeHash` (reuse the existing hash
  helpers so `plain`-tier tamper/replay protection is preserved), build the
  canonical bytes (Iteration 1), sign with the private key → put the signature
  in the envelope's `signature` field, plus a key identifier.
- Keep the monotonic per-pair counter (same as the other signers) for replay.
- **Exit test:** seal a message; assert the envelope has a non-empty signature
  and the expected fields.

### Iteration 3 — `PubKeySigner.verify()` (check incoming)
**Goal:** verify a received signed envelope. Async per the interface.
- Load the sender's **public key** from config (Iteration 0 map). No network.
- Re-run the same checks the other signers do, in cheap-to-expensive order:
  mode match → addressed-to-us → timestamp staleness → replay counter →
  payloadHash → envelopeHash → **signature verify against the public key**.
- Return `{valid:false, reason, detail}` on any failure (NEVER throw).
- [PROPOSAL] reason codes mirror KRAM's style: e.g. `PUBKEY_SIGNATURE_INVALID`,
  `PUBKEY_UNKNOWN_SENDER`, plus the shared `*_TIMESTAMP_STALE` / `*_REPLAY_*`.
- **Exit test:** round-trip — seal then verify = valid; then prove each tamper
  case fails with the right reason (changed payload, bad signature, stale
  timestamp, replayed counter, unknown sender).

### Iteration 4 — Reject unsealed messages in `pubkey` mode (close the gap)
**Goal:** make `pubkey` "always-require," not "verify-if-present."
- In BOTH agents' `execute()` unsealed branch: if `SIGNING_MODE` is a signed
  mode (`pubkey` or `kram`), an unsealed (envelope-less) message must be
  **rejected**, not processed. Backward-compat passthrough stays only for
  `plain`. [VERIFY BEFORE BUILDING — read the current `else` branch in both
  `buyer-agent/index.ts` and `seller-agent/index.ts execute()`; they mirror
  each other but confirm both.]
- [PROPOSAL] consider a `SIGNING_REQUIRED` env flag (default true for signed
  modes) so the policy is explicit and testable, mirroring the A.6
  `KRAM_REQUIRED` idea.
- **Exit test:** with `SIGNING_MODE=pubkey`, an unsealed message is rejected;
  with `SIGNING_MODE=plain`, it still passes (compat preserved).

### Iteration 5 — Factory wiring + startup
**Goal:** `SIGNING_MODE=pubkey` selects `PubKeySigner`.
- In `src/messaging/index.ts getMessageSigner()`: add a `raw === "pubkey"`
  branch returning `new PubKeySigner()` with the same logging style as the
  others. [VERIFIED this is the single selection point.]
- If `PubKeySigner` needs async setup (loading keys), implement `init?()`; the
  agent startup already does `await signer.init?.()`. [VERIFIED startup awaits
  init.]
- Fail fast on missing key config at startup (mirror KRAM's throw-on-missing).
- **Exit test:** start an agent with `SIGNING_MODE=pubkey`; banner shows the
  mode; missing key file → clean startup error, not a mid-negotiation crash.

### Iteration 6 — Audit posture block
**Goal:** the audit JSON honestly describes `pubkey`.
- [VERIFY BEFORE BUILDING — read `messageSigningPosture` block builder; it maps
  signer → a `tier`.] Add a tier for `pubkey`. [PROPOSAL] a value like
  `SIGNED_PUBKEY`: signature proves key-holder, key NOT bound to a legal entity
  and NOT KERI-rotatable. Set `cryptographicIdentity: true`,
  `leiBoundIdentity: false`, `keriKeyEventLog: false`.
- Cross-check against `AUDIT-FRAMEWORK-V6-DECISIONS.md` tier vocabulary before
  inventing a value (that file locks the tier enum). [VERIFIED that file governs
  the tier list.]
- **Exit test:** a `pubkey` negotiation writes an audit whose posture block
  accurately states what pubkey does/doesn't prove.

### Iteration 7 — Full round-trip integration test + docs
**Goal:** prove end-to-end with both agents on `pubkey`.
- Run a real buyer↔seller negotiation with `SIGNING_MODE=pubkey` on both sides;
  confirm every message verifies and the deal closes.
- Mismatch test: buyer `pubkey`, seller `plain` → must fail to communicate
  (mode mismatch), same as kram/plain mismatch does today. [VERIFIED that
  mode-mismatch rejection is the existing design.]
- Update operator docs / `.env` examples.
- **Exit test:** green end-to-end run on `pubkey`; mismatch correctly breaks.

---

## 4. Security summary of the finished mode

- **Better than `plain`:** real cryptographic signature → proves the message
  came from the holder of the private key; tamper + replay still covered.
- **Simpler / weaker than `kram` (full vLEI path):** the public key is just a
  key — no KERI key-history, no rotation story, no path to proving the key
  belongs to a legal entity (no vLEI). If the key is replaced you must
  redistribute public keys manually.
- **Relyable for critical use ONLY after Iteration 4** (unsealed-message
  rejection). Without that, it is "verify-if-present," not a guarantee.

---

## 5. Open items to resolve during build (not decided here)
- Exact `SignedEnvelope` field for the key id (`senderAid` reuse vs a neutral
  `senderKeyId`). [VERIFY]
- Whether to share KRAM's canonical bytes or fork a `pubkey-canonical.ts`. [VERIFY]
- Whether key rotation (even manual) is in scope, or explicitly out (a plain
  keypair has no rotation protocol — document the limitation honestly).
- Multi-process/persistent counter (same known limitation noted for the other
  signers).

---

## 6. Pre-build checklist (do this first, in a fresh working session)
Re-read these live files before writing any code, because this plan was drafted
without re-verifying every one:
- `src/messaging/signed-message.ts` (envelope fields + `SigningMode` union)
- `src/messaging/PlainHashSigner.ts` (hash helpers to reuse)
- `src/messaging/KramSigner.ts` (pattern to mirror; canonical bytes)
- `src/messaging/index.ts` (factory branch)
- both `agents/{buyer,seller}-agent/index.ts` `execute()` (unsealed branch)
- the `messageSigningPosture` audit block builder
- `AUDIT-FRAMEWORK-V6-DECISIONS.md` (tier enum governance)
