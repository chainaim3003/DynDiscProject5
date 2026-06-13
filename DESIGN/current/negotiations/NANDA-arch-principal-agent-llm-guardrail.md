# Principal–Agent–LLM–Guardrail Negotiation Architecture
### DynDisc5 (verified) → Nanda Town (proposed integration)

**Session:** NANDA-neg-kalai-sathya-2 · **Date:** June 13, 2026
**Status:** Conceptual design. No code written. Verified vs. proposed clearly separated.

> **Provenance legend**
> **[V]** = verified against source read this session.
> **[P]** = proposed design (conceptual).
> **[C]** = correction of an earlier-session claim.
> Paths bound to: `...\mcp-servers\DynDiscProject5` and `...\mcp-servers\NANDA\nandatown`
> (treated as possibly-different checkouts from the `FINAGENTS1\...` copies; not assumed identical).

---

## 0. Terminology — Principal vs. Principle

- **Principal** (this design): the party who *delegates*. From principal–agent theory
  (Ross 1973; Jensen & Meckling 1976; Eisenhardt 1989 review). The firm's commercial
  mandate is the principal; the negotiation engine acting for it is the agent.
- **Principle**: a rule or truth. Not the word used here.
- Mnemonic: an **agent** answers to a princip**al**; a princip**le** is a belief.

The two agency-theory frictions that motivate the whole guardrail design:
1. **Goal divergence** — the agent (esp. an LLM proposer) does not perfectly share the
   firm's objective.
2. **Information asymmetry** — the firm cannot observe every move the agent makes in real time.

Remedies = **monitoring** (audit) + **bonding/incentives** (hard constraints).
Key recursion: putting an LLM inside the agent makes the principal–agent problem
**recur one layer down** — the agent delegates proposing to a less-aligned sub-agent
(the LLM). That recursion is *why* the guardrail exists.

---

## 1. How DynDisc5's architecture actually works [V]

Source read this session: `NEGOTIATION_EXPLANATION.md`, `NEGOTIATION_README.md`,
`src/shared/outcome-quality.ts`, `src/shared/negotiation-mode.ts`,
`src/shared/l2-executive.ts`, `src/shared/advisor-math-aggregator.ts`.

### 1.1 Corrections to earlier-session claims [C]
1. **Proposer LLM is Groq / Llama 3.3 70B** in shipped code — NOT Gemini. The README
   notes Gemini is a *future* Phase-1 add (`LLM_PROVIDER=gemini`). `llm-client.ts`
   reads `GROQ_API_KEY`.
2. **The guardrail is not a single floor clamp.** It is a structured executive with an
   explicit *math-authoritative / LLM-authoritative* trust split and recorded overrides.
3. **`GEMINI_ERROR_RULES_FALLBACK` label** — asserted as fact in earlier turns; **NOT
   found** in the files read this session. Retracted as a stated fact pending a direct grep.
   What IS verified: a real pure-math fallback path (`l2-executive.decide` runs
   deterministic math when `llmCall` is absent) and a `DefensiveAction` vocabulary.

### 1.2 The mode ladder = a capability/autonomy ladder [V]
`negotiation-mode.ts` resolves five orthogonal config axes from env. The reasoning tier
is itself an autonomy ladder, audit-stamped on every deal:

| Mode | Adds | Shippable (WEDGE1) |
|---|---|---|
| `BASIC_SALES_QUOTING_1` | SKU floor only, treasury on | yes (default-unset) |
| `L1_DELEGATED_ADVISORS` | + inventory + logistics sub-agents | yes |
| `L2_EXECUTIVE_REASONER` | + credit + advisor-math-aggregator + LLM executive | yes |
| `L3_STYLE_AND_AUTONOMY` | + TKI style + opponent inference + autonomy gates | NO (throws) |
| `L4_LEARNED_PROFILES_AND_PD` | + per-counterparty profiles + commodity PD | NO (throws) |

- Default-unset → `BASIC_SALES_QUOTING_1`, byte-equivalent to prior product.
- `validateSellerResponseMode()` fail-fasts on L3/L4 and on the deprecated
  `NEGOTIATION_MODE` env name (with a translation table). No silent fallback.
- `getResolvedCapabilities(mode)` returns a boolean feature matrix per mode.

**This is the single most important reuse asset: DynDisc5 already has a typed,
env-resolved, audit-stamped autonomy ladder.**

### 1.3 The verified decision pipeline (`l2-executive.ts decide()`) [V]
1. **Hard defensive gates first.** Treasury absent or `success===false` → immediate
   `REJECT`, defensiveAction `abandoned-negotiation`, *no LLM call*. Cash/NPV verdict mandatory.
2. **Math computes the envelope** (`advisor-math-aggregator.ts`):
   - `effectiveFloor` = margin + profit buffer + inventory expediting (2%) + logistics
     per-unit (USD→INR ÷ qty) + credit expected-loss (pd1y × lgd × baseFloor).
   - `nbsMidpoint` (symmetric NBS; needs buyerMax, usually proxied by targetPrice).
   - `alphaWeightedUtility` (0.6 price / 0.2 speed / 0.2 credit-safety; weights overridable).
   - `deltaDiscount` (price vs. market reference; premium/fair/discounted/below-market).
   - **hardFloor = max(effectiveFloor.total, treasury.minViablePrice)**;
     **sanity ceiling = targetPrice × 1.5**.
3. **LLM proposes — soft choices only.** Passed the already-computed math; returns
   `{action, price, reasoning}`. Trust model limits LLM authority to: ACCEPT/COUNTER/REJECT
   when math doesn't force it, and counter price *within* `[hardFloor, 1.5×target]`.
4. **Executive validates & clamps.** Four override rules; every override recorded verbatim
   in `mathOverride {llmProposed, clampedTo, reason}`. "No silent overrides."
   - 5a ACCEPT-below-floor → COUNTER at floor (ceil)
   - 5b COUNTER-below-floor → clamp up
   - 5c COUNTER-above-ceiling → clamp down
   - 5d COUNTER-no-price → backfill at floor
5. **Outcome quality at close** (`outcome-quality.ts`), pure functions, computed
   **offline / post-hoc**: IR (`buyerIR`, `sellerIR`, `bothIR`), ZOPA (`width`,
   `wasFeasible`), symmetric NBS (`fairPrice=(buyerMax+sellerMin)/2`, `deviationFromNBS`,
   `deviationPercent`), surplus split, flags incl.
   **`agreementTrap = closed && ZOPA-feasible && closedPrice ≤ sellerMin×1.02`**.

### 1.4 Verified Principal→Agent→LLM→Guardrail mapping in DynDisc5 [V]
- **Principal** = `SELLER_CONFIG`/`BUYER_CONFIG` + env mode axes (margin, target, budget,
  mode, evaluation context).
- **Agent** = per-agent `index.ts` decision loop holding session state.
- **LLM** = Groq proposer for soft choices.
- **Guardrail** = two parts: *runtime* math clamp (`l2-executive`, non-loss) +
  *post-hoc* fairness (`outcome-quality`). **The fairness guardrail runs only AFTER close.**
  That post-hoc-only placement is the central gap the integration targets.

---

## 2. Nanda Town: what exists for negotiation [V]
Source read this session: `nest_core/layers/negotiation.py`, `validators.py`,
`scenarios_builtin/marketplace.py`, `nest-plugins-reference/.../alternating_offers.py`,
`tests/test_plugins.py`, `docs/layers/negotiation.md`.

- **Interface [V]:** clean 4-method `Protocol` `open/offer/respond/close`,
  `@runtime_checkable`, structurally typed.
- **Reference plugin [V]:** `AlternatingOffers` (patience discount). `respond()` has a
  real acceptance rule; **`close()` returns an Agreement whenever `current_terms is not
  None`** → manufactures agreements even when `respond()` said `accepted=False`. The
  conformance test encodes this rather than catching it. (Agreement-trap bug, confirmed
  in the NANDA checkout.)
- **Dead code [V]:** marketplace `BuyerAgent`/`SellerAgent` never touch the negotiation
  plugin (flat `buy:product:price` + one-shot `price>=min_price`). `_instantiate_plugins`
  wires registry/trust/payments/identity — NOT negotiation. So `AlternatingOffers` is
  reached only by its unit test.
- **Missing [V]:** NO `negotiation` key in `VALIDATORS` (marketplace/auction/voting/
  consensus/supply_chain/reputation all have validators). NO `negotiation.py` scenario.
  No utility model, no concession-strategy abstraction, no walk-away/BATNA.
- **Verdict [V]:** Nanda Town's negotiation layer is **a plugin socket + minimal
  reference stub (research scaffold)**, not a negotiation framework. Docs explicitly invite
  multi-attribute / multi-party / agenda-based / learning-based contributions.

**Complementarity:** DynDisc5 has the negotiation intelligence + guardrails but a bespoke
A2A/HTTP harness; Nanda Town has the clean socket + simulator + trace + validator
architecture but no negotiation intelligence. They are two halves.

---

## 3. Reuse / adapt / replace / keep

### 3.1 Reuse directly [V — pure, portable logic]
- `advisor-math-aggregator.ts` — `effectiveFloor`, `nbsMidpoint`, `alphaWeightedUtility`,
  `deltaDiscount`. Pure functions → agent utility/floor math.
- `outcome-quality.ts` — `computeOutcomeQuality` + blocks. **This IS the negotiation
  validator logic, already written.** Maps onto Nanda Town's missing `negotiation`
  validator key almost verbatim.
- The mode-ladder concept from `negotiation-mode.ts` (transfers as a pattern; TS env
  mechanics reimplemented in Python).

### 3.2 Adapt to `open/offer/respond/close` [V mismatch]
DynDisc5 message *types* (`OFFER/COUNTER_OFFER/ACCEPT_OFFER/REJECT_OFFER` over A2A
HTTP/SSE) → Nanda Town *methods*. Mapping:
- `open()` ← initial OFFER (+ principal mandate as config)
- `offer()` ← COUNTER (guardrail-checked candidate before emit)
- `respond()` ← ACCEPT/REJECT decision — **this is where `l2-executive.decide` slots in**
- `close()` ← projection of an accepted `respond()`; must NOT manufacture terms
- Bilateral auto-accept re-expressed so it cannot trigger the Nanda `close()` bug.

### 3.3 Replace [P]
`AlternatingOffers.close()` must become a projection of an accepted `respond()`.
Per standing constraint: **ship a corrected new plugin alongside** the reference, do not
mutate it. Validators FAIL on old, PASS on new.

### 3.4 Keep unchanged [V reusable]
`Negotiation` Protocol; `Terms/Session/Response/Agreement` types (pending `types.py`
multi-attribute check); simulator (seeded RNG, JSONL trace); validator *architecture*
(`(events)->list[ValidationResult]`, `VALIDATORS` dict); scenario-factory pattern;
entry-point plugin registration.

---

## 4. The layered design [P]

- **Principal layer** — per-agent scenario config: reservation values
  (`buyerMax`/`sellerMin`), utility preferences (α-weights — verified overridable),
  multi-issue weights (price/quantity/settlement_days), fairness anchor (NBS now, KS
  optional), autonomy level (the mode ladder). Sets mandate; never moves.
- **Agent layer** — holds session state across the 4 methods; owns strategy (Faratin-β /
  Zeuthen / trade-off). State lives in the negotiating `StateMachineAgent`, NOT in the
  plugin (plugin stays a thin protocol shuttle).
- **LLM layer** — soft choices only (counter price within the math-bounded band;
  ACCEPT/COUNTER/REJECT when math doesn't force it; reasoning narrative). Never hard-floor
  authority. Use the verified injectable seam (`L2LLMCall`) so it's testable without a key.
- **Guardrail layer** — generalized `l2-executive` clamp: hard gates (IR / treasury-analog)
  → math envelope → LLM proposal → clamp/override with recorded `mathOverride`. **One
  change from DynDisc5:** add the **fairness corridor** (NBS/KS deviation bound from
  `outcome-quality`) as a *runtime* veto inside `respond()`, not only a post-close metric.

---

## 5. Runtime flow [P]

```
PRINCIPAL  config: reservations, α-weights, issue-weights, anchor, autonomy level
   │  (mandate; set once at open())
   ▼
AGENT  holds session state; selects strategy; builds candidate
   ▼
LLM  (soft only) proposes action + price-in-band + reasoning   [skippable → pure-math]
   ▼
GUARDRAIL  ① hard gates (IR / treasury-analog)  ② math envelope [hardFloor, 1.5×target]
   │       ③ fairness corridor (NBS/KS deviation)  ④ clamp + record mathOverride
   │  allow → terms | veto → re-propose (bounded) | escalate → human (breach only)
   ▼
NEGOTIATION PLUGIN  open()/offer()/respond()/close()   (close = projection of accept)
   ▼
SIMULATOR  seeded discrete-event; emits JSONL trace
   ▼
AUDIT VALIDATORS  VALIDATORS["negotiation"] = computeOutcomeQuality offline
        pareto · both_ir · zopa · nbs/ks_deviation · agreement_trap · mutual_accept
        FAIL on alternating_offers · PASS on new plugin
```

---

## 6. Same guardrail logic, two roles — the core claim, grounded [V→P]

Feasible because `outcome-quality.ts` is already **pure functions over
`(closedPrice, buyerMax, sellerMin)`**. Purity → one module, two call sites:
1. **Runtime safety** — call on the *candidate* terms inside `respond()` before accepting;
   veto/re-propose/escalate on `agreementTrap` or corridor breach. (DynDisc5 calls it only
   at close; promoting the call site is the change.)
2. **Offline audit** — call the *identical* function over the JSONL trace as a
   `VALIDATORS["negotiation"]` entry.

Because it is the same code, the live veto and the audit verdict **agree by construction** —
a runtime accept can never pass a check the audit would later fail. The verified
`agreementTrap` threshold (`≤ sellerMin×1.02`) directly targets the corpus pathology
(systemic near-floor closes).

---

## 7. AS-IS vs TO-BE

### 7.1 AS-IS (Nanda Town) [V]
```
SCENARIO (marketplace)                NEGOTIATION LAYER (orphaned)
  BuyerAgent ──"buy:product:price"──►   Negotiation Protocol open/offer/respond/close
  SellerAgent  price>=min_price             └─ AlternatingOffers
     │  "sold:"/"reject:"                       • real respond() rule
     ▼                                          • close() BUG: agrees if current_terms != None
  SIMULATOR ─► JSONL trace                  (reached ONLY by test_plugins.py)
     ▼
  VALIDATORS{marketplace,auction,...}  ← NO negotiation key
  NO negotiation scenario · NO validators · NO negotiating agents
```

### 7.2 TO-BE [P]
```
PRINCIPAL config ─► GUARDRAIL evaluator (IR·ZOPA·corridor·trap) ◄─ same module ─┐
                         ▼ allow/veto/escalate                                   │
                    NEGOTIATION AGENT (Faratin-β / Zeuthen / trade-off / LLM)    │
                         ▼ candidate                                             │
                    NEGOTIATION PLUGIN open/offer/respond/close (close fixed)    │
                         ▼ structured Terms                                      │
                    SIMULATOR (seeded) ─► JSONL trace                            │
                         ▼                                                       │
                    AUDIT: VALIDATORS["negotiation"] = guardrail offline ────────┘
                    FAIL on alternating_offers · PASS on new plugin
```

---

## 8. Component responsibility matrix [P] (V = reuses verified DynDisc5 logic)

| Layer | Sets | Decides | Constrains | Records | Basis |
|---|---|---|---|---|---|
| Principal | reservations, α-weights, issue-weights, anchor, autonomy level | — | — | mode block | `negotiation-mode` ladder (V) |
| Agent | — | strategy, candidate, walk-away | within mandate | session state | per-agent index.ts (V, adapt) |
| LLM | — | soft action + price-in-band + reasoning | — | reasoning, llmAudit | `l2-executive` LLM seam (V) |
| Guardrail | — | allow/veto/clamp/escalate | hard floor, fairness corridor | `mathOverride` | `l2-executive` + `outcome-quality` (V) |
| Plugin | — | protocol transition | accept-before-close | session/terms | Nanda `Negotiation` (V) |
| Simulator | seeds | event order | — | JSONL trace | Nanda sim (V) |
| Audit | — | pass/fail | post-hoc invariants | ValidationResults | Nanda validators + `outcome-quality` (V) |

---

## 9. Interaction sequence — one `respond()` [P]
```
Buyer offer arrives → Agent.respond()
  Agent → Guardrail.evaluate(candidate = incoming offer)
    Guardrail: hard gates pass? → compute math envelope → (LLM proposes accept/counter)
              → check fairness corridor on the would-be close
              → ALLOW accept | VETO→re-propose counter | ESCALATE (breach)
  Agent → Plugin.respond() → NegotiationResponse(accepted | counter_terms)
  Simulator records send/receive event (structured Terms in msg)
  [on accept] Plugin.close() projects agreed terms (cannot manufacture)
  [post-run] VALIDATORS["negotiation"] recomputes the same checks over the trace
```

---

## 10. New vs unchanged components

**New [P]:** `negotiation` scenario + two negotiating agents; multi-attribute plugin
(corrected `close()`); `VALIDATORS["negotiation"]` (port of `outcome-quality`); Python
guardrail/executive module (port of `l2-executive` clamp + injectable LLM seam); utility/
floor module (port of `advisor-math-aggregator`); principal config schema; agent-side
session-state management.

**Unchanged [V]:** `Negotiation` Protocol; `Terms/...` types (pending `types.py` check);
simulator; validator architecture; scenario-factory pattern; entry-point registration.
Reference `alternating_offers` stays as the FAIL baseline.

---

## 11. Contribution tiers [P]

- **MVP:** `negotiation` scenario + 2 agents driving the protocol (single-issue price) +
  `negotiation` validators (IR, mutual-accept, agreement-trap) + one corrected plugin.
  Claim: validators FAIL on `alternating_offers`, PASS on new plugin.
- **Recommended:** multi-attribute `Terms` (price+quantity+settlement_days) + Faratin-β
  strategy (flags) + Pareto/ZOPA/NBS/KS validators + 3 scenario YAMLs (feasible-ZOPA,
  no-ZOPA control, multi-issue). Realizes problem-07.
- **Long-term:** principal–agent/guardrail layering with autonomy level as a config switch
  (L1–L5) + LLM-proposer-behind-guardrail (NegotiationArena-style) + ANAC-style cross-play
  tournament (private profiles, strategy-pairing matrix). Audit = autonomy-certificate base.

---

## 12. Migration plan [P]
1. Read `nest_core/types.py` — confirm `Terms` multi-attribute support (open gap).
2. Add `negotiation` validators (IR, mutual-accept, agreement-trap) under new key — additive.
3. Add `negotiation` scenario + 2 agents driving the protocol with structured `Terms`.
4. Ship corrected multi-attribute plugin alongside `alternating_offers`; demo FAIL/PASS.
5. Layer the guardrail as shared evaluator (one module, two call sites).
6. Add strategy flags (Faratin-β family, anchor, autonomy level) + 3 scenario YAMLs.
7. (Research) LLM-proposer-behind-guardrail + cross-play tournament harness.

Each step is additive and independently testable; nothing requires editing Nanda Town's
existing layers — what makes it a clean upstream contribution rather than a fork.

---

## 13. Open verification gaps (explicit)
- **`nest_core/types.py` NOT read** — `Terms` multi-attribute support unconfirmed. Read first.
- **`consultation-router.ts` and `llm-client.ts` NOT read** — `ConsultationBundle`
  construction + Groq call site inferred from consumers, not directly verified.
- **`GEMINI_ERROR_RULES_FALLBACK` label** — retracted as fact; needs a direct grep to settle.
- **Checkout identity** — `NANDA\nandatown` vs `FINAGENTS1\nandatown`; this `DynDiscProject5`
  vs `FINAGENTS1\DynDiscProject5` treated as possibly different versions.

---

## 14. Scholarly grounding
Ross 1973 (Economic Theory of Agency); Jensen & Meckling 1976; Eisenhardt 1989 (agency
theory review); Nash 1950 (Bargaining Problem); Kalai & Smorodinsky 1975; Raiffa 1982 (Art
& Science of Negotiation); Rubinstein 1982 (alternating offers); Faratin, Sierra & Jennings
1998 (negotiation tactics); Myerson & Satterthwaite 1983 (two-sided private info);
Keeney & Raiffa 1976 (MAUT); Bianchi et al. 2024 (NegotiationArena, ICML — 20% gain from
simulated-desperation tactic vs GPT-4); Parasuraman, Sheridan & Wickens 2000 (levels of
automation); Feng, McDonald & Zhang 2025 (arXiv 2506.12469, five autonomy levels);
ANAC/GENIUS tradition (shared domains, private profiles).
