# Negotiation Layer Analysis — Theory ↔ Code Mapping
### tommyBuyerAgent / jupiterSellerAgent (DynDiscProject5/6) × Nanda Town `Negotiation` layer

**Scope note (verified vs. inferred).** Read directly: nandatown `README.md`, `layers/negotiation.py`, `types.py`, `alternating_offers.py`; DynDiscProject6 `buyer-agent/index.ts`, `llm-client.ts`, `negotiation-types.ts`, `negotiation-mode.ts`, `advisor-math-aggregator.ts`, `outcome-quality.ts`, `l2-executive.ts`, `NEGOTIATION_EXPLANATION.md`, `NEGOTIATION_README.md`; DynDiscProject5 audit `NEG-1780424958177` (buyer perspective). **Not read:** `seller-agent/index.ts`, `consultation-router.ts`, `treasury-provider.ts` — seller runtime behavior is inferred from its mirror in the buyer code, the mode framework, and project docs.

---

## 1. The two negotiation systems

**Nanda Town `Negotiation` layer** — a minimal 4-method protocol: `open / offer / respond / close` over a `Terms` object (price + free-form `conditions` dict). Reference plugin `alternating_offers` claims "Rubinstein-style with patience discount."

**tommyBuyerAgent ↔ jupiterSellerAgent** — hybrid LLM + hard-constraint validation + rule-based fallback; finite deadline (maxRounds=3); randomized anchoring openings; role-asymmetric reservation prices (buyer maxBudget / seller marginPrice); treasury/inventory/logistics/credit advisor floor (L1/L2 modes); NBS/ZOPA/IR/surplus-split outcome auditing; multi-dimensional terms (product, qty, budget, TKI style, deadline); post-deal reservation-price disclosure for audit.

---

## 2. Theory → code mapping

> Compact entries (no wide table) for readability.

### 2.1 Alternating-offers bargaining with discounting
- **Source:** Rubinstein (1982), *Econometrica* 50: 97–109
- **In code:** round-based OFFER → COUNTER → ACCEPT loop in both stacks; `patience` parameter in `alternating_offers.py`
- **Status:** protocol *shape* only — neither side implements the actual equilibrium (see §3)

### 2.2 Nash Bargaining Solution (symmetric)
- **Source:** Nash (1950), "The Bargaining Problem," *Econometrica* 18(2): 155–162
- **In code:** `nbsMidpoint()` in `advisor-math-aggregator.ts`; `NBSBlock.fairPrice = (buyerMax + sellerMin) / 2` in `outcome-quality.ts`
- **Status:** implemented for *evaluation* and as L2 anchor; code comments note asymmetric NBS is deferred

### 2.3 Kalai-Smorodinsky solution
- **Source:** Kalai & Smorodinsky (1975), "Other Solutions to Nash's Bargaining Problem," *Econometrica* 43(3): 513–518
- **In code:** **not implemented anywhere read**
- **Status:** gap — a candidate differentiator for the hackathon contribution (motivated by the agreement-trap audit, §5)

### 2.4 Reservation prices, ZOPA, surplus split
- **Source:** Raiffa (1982), *The Art and Science of Negotiation*
- **In code:** `outcome-quality.ts` (`ZOPABlock`, `IRBlock`, `SurplusBlock`); buyer maxBudget / seller marginPrice as hard reservations
- **Status:** fully implemented — but as *post-hoc audit*, not in-protocol

### 2.5 Individual Rationality
- **Source:** cooperative bargaining axiom (Nash 1950)
- **In code:** `IR.bothIR`; seller prompt "NEVER accept at exactly margin"; buyer budget cap in `applyBuyerConstraints`
- **Status:** enforced at runtime (constraints) **and** audited

### 2.6 Time-dependent concession tactics (Boulware / Linear / Conceder)
- **Source:** Faratin, Sierra & Jennings (1998), *Robotics and Autonomous Systems* 24(3–4): 159–182 — concession strategies classified into time-dependent, behavior-dependent, resource-dependent families
- **In code:** buyer `ruleBasedDecision`: concessionRate 0.4 → 0.6 in final round; round-indexed acceptance thresholds {340, 360, 380}
- **Status:** a hardcoded two-point Conceder; not parameterized (no β curve)

### 2.7 Behavior-dependent (tit-for-tat) tactics
- **Source:** Faratin et al. (1998), same taxonomy
- **In code:** buyer's gap-fraction counter (`lastBuyerOffer + gap × rate`)
- **Status:** partial — position-reactive, not imitative of opponent *concessions*

### 2.8 Deadline effects under incomplete information
- **Source:** Fatima, Wooldridge & Jennings (deadline/information-effects line of work) *(training-knowledge attribution — not re-verified this session)*
- **In code:** maxRounds=3; final-round prompts ("deal will fail if not accepted"); escalation on exhaustion
- **Status:** implemented; deadline dominates strategy because the horizon is tiny

### 2.9 Anchoring
- **Source:** Tversky & Kahneman (1974); Galinsky & Mussweiler (2001) first-offer advantage *(training-knowledge attribution)*
- **In code:** buyer randomized low opening (₹250–320); seller high-anchor counter; LLM round-1 prompt: "Start higher to anchor expectations"
- **Status:** explicitly prompted into the LLM

### 2.10 BATNA / walk-away
- **Source:** Fisher & Ury (1981), *Getting to Yes*
- **In code:** `escalateToHuman`, `walkAwayBehavior: "escalate"` in BuyerIntent, REJECT path, CommitGateEvents
- **Status:** implemented as escalation-to-human rather than an alternative deal value

### 2.11 Multi-attribute utility (MAUT)
- **Source:** Keeney & Raiffa (1976); Faratin et al. (2002) similarity-based trade-offs *(training-knowledge attribution)*
- **In code:** `alphaWeightedUtility` (price 0.6 / speed 0.2 / credit-safety 0.2 convex combination); multi-dim CLI (product, qty, deadline)
- **Status:** scalarization exists, but offers still move on **price only** — no trade-off bidding across issues

### 2.12 Agreement bias / "agreement trap"
- **Source:** behavioral negotiation literature on deal-closure bias
- **In code:** `flags.agreementTrap` (closed within 2% of seller floor); buyer's iter-4.1 concession sanity check (block ACCEPT when gap > 30%)
- **Status:** a genuinely good runtime + audit guard, rare in reference implementations

### 2.13 Conflict-style frameworks (TKI five styles)
- **Source:** Thomas-Kilmann Conflict Mode Instrument
- **In code:** `buyerStyle` field; `styleFramework` / `opponentStyleInference` capabilities (L3, post-WEDGE1)
- **Status:** declared but explicitly not honored yet (per code comments)

### 2.14 Principal-agent guardrails over an LLM proposer
- **Source:** recent LLM-negotiation literature (LLMs are anchoring-susceptible and over-concede) — see NegotiationArena, arXiv 2402.05863
- **In code:** `l2-executive.ts` trust model — "math authoritative for hard limits, LLM authoritative for soft choices," with `mathOverride` audit
- **Status:** the most novel, contribution-worthy pattern in the codebase

### 2.15 Information revelation under two-sided private information
- **Source:** Myerson & Satterthwaite (1983) — no fully efficient mechanism exists *(training-knowledge attribution)*
- **In code:** post-deal `disclosed.reservationPrice` in ACCEPT_OFFER / PURCHASE_ORDER — disclosure only *after* close, audit-only
- **Status:** theoretically sound placement; revealing during bargaining would break incentives

---

## 3. Critical findings

**(a) The nandatown reference plugin is not actually Rubinstein — it's broken-by-simplification.**
`respond()` computes `threshold = price × patience^rounds` and accepts when `price ≤ threshold`. Since `patience < 1` and `rounds ≥ 1` (open() seeds history), the condition `amount ≤ amount × patience^n` reduces to `1 ≤ patience^n` — never true for any positive amount. Acceptance only triggers via `rounds >= 10`; the "patience discount" is dead code, and `patience=1.0` degenerates to always-accept-immediately. Worse, `close()` returns an `Agreement` whenever `session.current_terms is not None` — which is every real session — manufacturing agreement with no acceptance; `respond()`'s acceptance is never written to session state, so the two methods are disconnected. **Verification status:** `alternating_offers.py` and `nest-plugins-reference/tests/test_plugins.py` read in full. The conformance test itself codifies the bug: with open(100)/offer(80), respond() provably returns `accepted=False` (80 ≤ 80×0.9² = 64.8 is false), yet the very next assertion requires `close()` to return a non-None Agreement. Not yet verified: whether the simulator/marketplace agents expose this in traces (sim/ and scenario agent code unread). Defensible phrasing for a PR: "the acceptance condition is unsatisfiable for positive prices before round 10, and close() violates its documented contract ('returning an agreement if reached'), as demonstrated by the bundled test."

Real Rubinstein bargaining needs per-agent discount factors over *utility* with the SPE outcome δ₂(1−δ₁)/(1−δ₁δ₂) — none of that is representable in the current types.

**(b) The interface can't express what tommy/jupiter already do.**
Mapping onto `Negotiation` today loses: reservation prices, deadlines (maxRounds), role, concession-strategy parameters, rejection-with-reason, escalation as a distinct terminal state (only AGREED/REJECTED/EXPIRED exist), decision provenance (LLM vs. rule vs. clamp), multi-issue trade-offs. `Terms.conditions: dict` can *carry* multi-attribute payloads, but the protocol gives them no semantics.

**(c) NBS anchor has a proxy distortion.**
In `computeTactics`, when `buyerMax` is unknown the code substitutes `targetPrice` (the comment admits it). That makes the "NBS midpoint" systematically seller-pessimistic. A contributed interface should carry explicit `buyerMax` unknown-ness rather than silently proxying.

**(d) Concession logic is a fixed Conceder.**
The 0.4/0.6 gap-closing and round thresholds are one point in the Faratin tactic space. With maxRounds=3 the deadline term dominates everything — no room for Boulware behavior or opponent adaptation. A parameterization gap, not a design flaw.

---

## 4. Proposed contribution to the nest `Negotiation` layer

Strategy: **fix the reference semantics, then generalize the interface using the BOA decomposition** (Bidding / Opponent-model / Acceptance — Baarslag et al.'s automated-negotiation architecture), **with a fairness-anchored strategy (KS or NBS) and a validator suite as proof**.

### Piece 1 — Interface extension (backward-compatible)

```python
class UtilityModel(Protocol):
    def utility(self, terms: Terms) -> float: ...   # [0, 1]
    def reservation(self) -> float: ...             # walk-away utility

class NegotiationStrategy(Protocol):
    """BOA decomposition: pluggable bidding, acceptance, opponent model."""
    def propose(self, session: NegotiationSession, t: float) -> Terms: ...
    def accept(self, session: NegotiationSession, offer: Terms, t: float) -> bool: ...
    def observe(self, session: NegotiationSession, offer: Terms) -> None: ...
```

`NegotiationSession` gains `deadline: int | None`, `turn: AgentId`, and `NegotiationStatus.ESCALATED` — all directly lifted from what tommy/jupiter needed in practice. Everything configurable as constructor flags (patience δ, deadline, Faratin β, utility weights, KS vs. NBS anchor).

### Piece 2 — Plugins mapping the theories

| Plugin | What it implements |
|---|---|
| `alternating_offers` (fixed) | Real per-agent discount over utility; acceptance when `u(offer_now) ≥ δ·u(own_next_offer)`; agreement only on explicit mutual accept |
| `time_dependent(beta=…)` | Faratin Boulware (β<1) / Linear (β=1) / Conceder (β>1); the current buyer ≈ `beta≈2, deadline=3` |
| `kalai_smorodinsky` | Concede along the disagreement-point → ideal-point line, keeping concessions proportional to maximal gains; KS replaces Nash's IIA axiom with monotonicity |
| `llm_guardrailed` | Direct port of the L2-executive trust model: LLM proposes, math floor clamps, every override recorded |

### Piece 3 — Validators (what Nanda Town rewards)

Port `outcome-quality.ts` into a `negotiation` trace validator:
- both-IR holds
- agreed price inside ZOPA
- no agreement without mutual accept *(catches the current `close()` bug)*
- monotone concessions
- agreement-trap flag
- deviation-from-NBS **and** deviation-from-KS

A property suite that **fails on the current reference plugin and passes on the fixed one** is the strongest possible demo.

**Application-side payoff:** tommy/jupiter then adhere to this interface — buyer = `time_dependent` bidding + budget-clamped acceptance; seller = `llm_guardrailed` with `effectiveFloor` as the utility model's reservation; the audit's `outcomeQuality` becomes the same code as the nest validator.

---

## 5. Evidence from the audit store (DynDiscProject5)

`audits/2026-06-02/NEG-1780424958177/buyer.audit.json` — one deal, three lessons:

1. **Agreement trap, live.** Closed at ₹355 vs. sellerMin ₹350 / buyerMax ₹420: `agreementTrap: true`, buyer captured **93%** of surplus, NBS fair price ₹385, deviation −30 (−85.7% of half-width).
2. **Cause visible in the decision trail.** Seller's round-2 counter at ₹355 came from `GEMINI_ERROR_RULES_FALLBACK` — LLM failed; the rule-based fallback conceded straight down near the floor. Honest decision-path labeling caught it.
3. **Mode misconfiguration caught.** Scenario declared `L2_EXECUTIVE_REASONER`; env resolved to `BASIC_SALES_QUOTING_1` — the exact `failureMode` the scenario predicted; `deviationFromIntent` flags the close as outside the expected ₹375–395 band.

One audit simultaneously demonstrates the value of fallback labeling, the outcome-quality block, and the intent-deviation check.

---

## 6. Official paper links

| Paper | Citation | Link |
|---|---|---|
| Kalai & Smorodinsky (1975) | "Other Solutions to Nash's Bargaining Problem," *Econometrica* 43(3): 513–518 | [JSTOR](https://www.jstor.org/stable/1914280) · [Econometric Society](https://www.econometricsociety.org/publications/econometrica/1975/05/01/other-solutions-nashs-bargaining-problem) · [PDF mirror](https://jmvidal.cse.sc.edu/library/kalai75a.pdf) |
| Faratin, Sierra & Jennings (1998) | "Negotiation Decision Functions for Autonomous Agents," *Robotics and Autonomous Systems* 24(3–4): 159–182 | [DOI](https://doi.org/10.1016/S0921-8890(98)00029-3) |
| Rubinstein (1982) | "Perfect Equilibrium in a Bargaining Model," *Econometrica* 50: 97–109 | [Semantic Scholar](https://www.semanticscholar.org/paper/0a577ebd728080640ba1f6da20e99cf6e9526c8e) · DOI 10.2307/1912531 |
| Nash (1950) | "The Bargaining Problem," *Econometrica* 18(2): 155–162 | [JSTOR](https://www.jstor.org/stable/1907266) *(stable URL not click-verified)* |

JSTOR / Econometric Society links are paywalled originals; Semantic Scholar and the PDF mirror are the accessible routes.

---

*Naming note: "kalai" in the branch/chat title refers to a teammate, not Ehud Kalai — the KS recommendation stands on the technical evidence (agreement-trap audit) alone.*
