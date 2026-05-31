# Future Plan — OAuth + SSL/TLS (transport & authorization layers)

> **Status:** FUTURE — NOT YET IMPLEMENTED. Stored for later. No code exists for
> any of this.
>
> **Honesty note:** This is a forward-looking design sketch, not verified
> against code (there is no code to verify). Items are labelled **[PROPOSAL]**
> (a design choice) or **[FACT]** (a general, well-established property of the
> technology, independent of this codebase). Nothing here describes something
> the system currently does.

---

## 0. Why these are SEPARATE from the signing modes

The signing modes (`plain` / `pubkey` / `kram`) all answer **"is this message
authentic and from whom?"** — they sign the *message content*, which is what an
*audit trail* needs (you can prove months later that a specific message came
from a specific party).

OAuth and SSL/TLS answer **different questions** and do NOT replace message
signing:

| Layer | Question it answers | What it protects | Does it replace message signing? |
|---|---|---|---|
| **SSL/TLS** | "Is the pipe between us private, and is the server who it claims?" [FACT] | The *connection/channel* | **No.** Secures transport in transit; does not leave a per-message signature you can audit later. |
| **OAuth** | "Is this caller *allowed* to do this action on whose behalf?" [FACT] | *Authorization / permission* | **No.** Grants access; says nothing about whether a given message was forged. |
| **Signing (pubkey/kram)** | "Did this exact message come from this party, unaltered?" | The *message itself* | This is the layer the audit relies on. |

**Plain-English takeaway:** SSL = a private armored pipe. OAuth = a permission
slip. Message signing = a signature on the letter inside. A complete system can
use all three; none substitutes for another.

---

## A. SSL/TLS plan (transport encryption)

### A.0 What it gives you [FACT]
- Encrypts traffic between agents / between UI and api-server, so a network
  eavesdropper can't read or modify messages in transit.
- Server authentication (the client confirms the server's certificate).
- Optional **mutual TLS (mTLS)**: both sides present certificates — closest TLS
  gets to "both parties authenticated at the connection level."

### A.1 What it does NOT give you [FACT]
- No per-message, after-the-fact proof (once the TLS connection ends, there's
  no signature left on each message to audit).
- No authorization (who's allowed to do what).
- So TLS complements, but never replaces, the signing modes.

### A.2 Current state [PROPOSAL/observation]
- Today the agents talk over plain HTTP on localhost (`http://localhost:PORT`),
  and the api-server is HTTP. [VERIFY when building — confirm no TLS is
  configured anywhere.]
- For a localhost dev rig, plain HTTP is acceptable; TLS matters once traffic
  crosses machines/networks.

### A.3 Iterations (when pursued)
1. **Decide scope.** Which hops need TLS? (agent↔agent, UI↔agent, agent↔api-server,
   agent↔KERIA). [PROPOSAL] start with any hop that will cross a real network.
2. **Certificates.** Dev: self-signed / local CA (e.g. mkcert). Prod: real CA.
   [PROPOSAL]
3. **Server-side TLS.** Terminate TLS at each Express server (or behind a
   reverse proxy like nginx/Caddy). [PROPOSAL]
4. **Client trust.** Point each agent's HTTP client at `https://` and trust the
   CA. [PROPOSAL]
5. **(Optional) mTLS.** Issue client certs; require + verify them server-side.
6. **Test.** Confirm encrypted transport; confirm signing modes still work
   unchanged on top (they should — signing is independent of transport).

### A.4 Honest note
TLS is largely an **ops/deployment** change, not an app-logic change. It should
not require touching the signer code at all — which is a good sign the layers
are correctly separated.

---

## B. OAuth plan (authorization)

### B.0 What it gives you [FACT]
- Delegated authorization: lets a user/app grant a service permission to act on
  their behalf, scoped (e.g. "read invoices" but not "approve payments").
- Token-based access control to endpoints (who may call what).

### B.1 What it does NOT give you [FACT]
- It does not prove a given negotiation *message* is authentic/unforged — that's
  signing's job.
- It does not encrypt transport — that's TLS's job (OAuth is normally used
  *over* TLS).

### B.2 Where it would fit here [PROPOSAL]
- Likely candidates: protecting the **api-server** endpoints (:4000) and the
  **UI→agent** control endpoints, so only authorized callers can trigger
  negotiations, IPEX, verification, etc.
- Less relevant to agent↔agent negotiation messages themselves (those are an
  authenticity problem → signing, not an authorization problem → OAuth).

### B.3 Iterations (when pursued)
1. **Pick the model.** [PROPOSAL] OAuth2 / OIDC with an identity provider, or a
   lighter scheme (signed JWTs) if full OAuth is overkill for the rig. Decide
   based on who the "users" are and whether external IdP integration is needed.
2. **Decide what to protect.** Enumerate endpoints that need authorization
   (api-server routes, agent control/admin routes, UI actions). [PROPOSAL]
3. **Token issuance.** Stand up / integrate an authorization server; define
   scopes. [PROPOSAL]
4. **Token verification middleware.** Add middleware on protected routes that
   checks the token + scope before handling. [PROPOSAL]
5. **Run over TLS.** OAuth tokens must travel over TLS (Section A) — bearer
   tokens on plain HTTP are interceptable. [FACT]
6. **Test.** Valid token + correct scope → allowed; missing/expired/wrong-scope
   → 401/403.

### B.4 Honest note
OAuth is an **authorization** layer. Adding it does not make messages more
authentic and does not encrypt anything by itself. Sequence matters: TLS first
(so tokens aren't sniffable), then OAuth on top.

---

## C. How all the layers stack (target end-state) [PROPOSAL]

A fully hardened deployment could combine, bottom to top:
1. **SSL/TLS** — encrypt every cross-network hop (and optionally mTLS for
   connection-level mutual auth).
2. **OAuth** — authorize who may call control/admin/api endpoints, over TLS.
3. **Signing (`pubkey` or `kram`)** — authenticate and audit each negotiation
   *message*; `kram` adds the path to vLEI legal-identity binding.

Each layer answers a different question (private pipe / permission / authentic
message). They are complementary, ordered, and independently testable.

---

## D. Sequencing recommendation [PROPOSAL]
1. First finish/secure the **message-signing** story (close the unsealed-message
   gap; ship `pubkey` if desired) — that's the audit-critical layer.
2. Add **TLS** when traffic leaves localhost.
3. Add **OAuth** when there are real users/callers whose permissions must be
   scoped.

Do not reorder so that you add OAuth/TLS and *believe* the messages are
therefore authenticated — they are not. Message authenticity comes only from the
signing layer.
