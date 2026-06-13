# Conceptual Design — Negotiation Scenarios for the NANDA Hackathon
### Single-dimensional · Multi-dimensional · Settlement-time as a negotiated attribute

**Grounding.** Built from: the official local hackathon problem statement `nandatown/docs/hackathon/problems/07-negotiation-multi-attribute.md` (read directly), the nest negotiation layer code (`negotiation.py`, `types.py`, `alternating_offers.py`), the tommy/jupiter codebase (DynDiscProject5/6 incl. the DD + ACTUS settlement machinery), and web-verified sources cited inline. Training-knowledge attributions are flagged.

---

## 1. Is Rubinstein + patience the only implementation asked for? **No — officially no.**

Direct from the official problem statement (`07-negotiation-multi-attribute.md`, local clone):

- The default plugin is described as *"99 lines of single-attribute Rubinstein bargaining"* whose `respond` compares **one number** against a patience-discounted threshold — that's the baseline being criticized, not the target.
- The layer docs *"explicitly want multi-attribute negotiation, multi-party negotiation, agenda-based bargaining, learning-based bidding."*
- Problem 07's success criteria require: a plugin negotiating over **≥ 2 attributes** of `Terms` with **private per-agent utility functions**, converging to a **Pareto-optimal** agreement; an **adversarial validator** that computes the Pareto frontier from observed bids and **fails `alternating_offers`** (because it ignores everything but price) while passing yours; and `scenarios/multi_attribute_market.yaml` (10 buyer-seller pairs, price + deadline, deterministic seeded utility weights).
- Approach pointers explicitly suggest the **monotonic concession protocol** framing and reciprocal trade-offs ("if they conceded on price but not deadline last round, you concede on deadline this round").
- Hard constraints: **bilateral only**, **Tier-1 deterministic only** (no LLM bargaining), no inter-session learning, don't break `alternating_offers` — ship alongside it. Anti-pattern: a plugin that "collapses to a weighted-sum scalar internally and never explores the frontier."

So Rubinstein/patience is the *reference baseline to beat*, and the door is explicitly open to any theory that meets the Pareto-optimality criterion deterministically.

---

## 2. Theory menu beyond Rubinstein (eligible under the rules)

| # | Theory / strategy | Fit to problem 07 | Notes |
|---|---|---|---|
| 1 | **Monotonic Concession Protocol / Zeuthen strategy** | Explicitly suggested in the problem doc | Each round, the agent with less to lose from conflict concedes; converges to the Nash point. *(Zeuthen/Rosenschein-Zlotkin attribution = training knowledge, not re-verified)* |
| 2 | **Faratin time-dependent tactics (Boulware/Linear/Conceder, β-parameterized)** | Per-attribute patience is explicitly allowed ("patience discounts still apply, but per-attribute") | Faratin, Sierra & Jennings (1998), DOI 10.1016/S0921-8890(98)00029-3 — verified |
| 3 | **Faratin behavior-dependent (tit-for-tat) tactics** | Matches the "concede on the attribute they didn't" pointer | Same paper, behavior-dependent family — verified |
| 4 | **Similarity-based trade-off bidding** (iso-utility curves: offer the point on my current utility level closest to opponent's last bid) | The canonical way to "explore the frontier" without knowing the opponent's utility | Faratin et al. (2002) trade-off mechanism *(attribution = training knowledge)* |
| 5 | **NBS / Kalai-Smorodinsky fairness anchors** | Usable as the *target* of concession paths and in the validator (deviation-from-fair-point metric) | Nash (1950); Kalai & Smorodinsky (1975), JSTOR 1914280 — verified |
| 6 | **MiCRO-style minimal concession** | A modern deterministic ANAC-line strategy | "MiCRO for Multilateral Negotiations" (arXiv 2510.17401) — verified mention |
| 7 | **Agenda-based / issue-by-issue bargaining** | Listed as wanted in `docs/layers/negotiation.md` | Fatima, Wooldridge & Jennings line *(training knowledge)* |
| 8 | **LLM-guardrailed bargaining (L2-executive pattern)** | **Out of scope for problem 07** (Tier 1 only) — valid as a *separate* Tier-2 contribution | Motivated by NegotiationArena's exploitability findings (arXiv 2402.05863 — verified) |

**Recommended combination:** #4 (trade-off bidding) as the bidding strategy + #2 (per-attribute β) as the concession schedule + #5 as validator metrics + the Pareto-frontier validator the problem demands. The anti-pattern ("don't collapse to a weighted sum") is avoided precisely because trade-off bidding moves *along* iso-utility curves rather than scalarizing.

---

## 3. Single-dimensional scenario design (baseline + bridge from tommy/jupiter)

Purpose: a controlled baseline that (a) reproduces tommy/jupiter BASIC-mode dynamics inside nest, and (b) gives the validator a known-broken target (`alternating_offers`).

```yaml
# scenarios/single_dim_procurement.yaml  (sketch)
name: single_dim_procurement
agents:
  buyers:  { count: 10, brain: state_machine }
  sellers: { count: 10, brain: state_machine }
layers:
  negotiation: time_dependent        # new plugin; flip to alternating_offers for baseline
params:
  negotiation:
    deadline_rounds: 6               # > 3: avoids deadline dominating everything (tommy/jupiter lesson)
    buyer:  { reservation: 420, target: 330, beta: 1.8 }   # Conceder-ish
    seller: { reservation: 350, target: 430, beta: 0.6 }   # Boulware-ish
seed: 42
```

Design decisions:
- **Reservation prices in-protocol** (not just audit-time) — the missing primitive identified in the `types.py` critique.
- **deadline_rounds configurable** (flag, not constant): audit NEG-1780424958177 shows maxRounds=3 makes deadline pressure dominate; sweeps over {3, 6, 10} become possible.
- **β as the single strategy knob**: the buyer's current 0.4/0.6 gap-closing ≈ Conceder (β≈2) with deadline 3 — one point in this space, now parameterized.
- **Validator (single-dim):** both-IR, inside-ZOPA, mutual-accept-required (fails the current `close()` bug), monotone concessions, agreement-trap flag (port of `outcome-quality.ts`).

## 4. Multi-dimensional scenario design (the problem-07 deliverable)

Issues: **price + deadline**, utility weights drawn deterministically from each agent's seeded RNG, per the success criteria.

**Utility model (private, per agent):**
```
u_buyer(price, deadline)  = w_p · (max_price − price)/(max_price − min_price)
                          + w_d · (max_days − deadline)/(max_days − min_days)
u_seller(price, deadline) = w_p · (price − min_price)/(max_price − min_price)
                          + w_d · (deadline − min_days)/(max_days − min_days)
w_p + w_d = 1, drawn from per-agent seeded RNG  →  traces replay byte-identically
```
(The *utility* is a weighted sum — allowed; what's prohibited is the *bidding strategy* collapsing to a scalar and never trading off across attributes.)

**Bidding (trade-off / iso-utility):** each round, compute the aspiration utility level `u*(t)` from the per-attribute β schedule; among all `Terms` with `u = u*(t)`, offer the one **most similar to the opponent's last offer**. That's frontier exploration.

**Acceptance:** accept iff `u(their_offer) ≥ u(my_planned_next_offer)` — the corrected Rubinstein-style acceptance condition, over multi-attribute utility.

**Pareto validator (the adversarial deliverable):**
1. Collect every `Terms` exchanged in the session (both sides).
2. After close, compute both parties' utilities for every exchanged point (validator is offline; may use both utility functions — agents may not).
3. FAIL if the agreement is Pareto-dominated by any exchanged point; distinguish `BREAKDOWN` (close → None) from `CLOSED_DOMINATED`.
4. Must FAIL against `alternating_offers` on multi-attribute terms; PASS against the new plugin.

```yaml
# scenarios/multi_attribute_market.yaml  (sketch per problem-07 spec)
name: multi_attribute_market
pairs: 10
issues:
  price:    { min: 250, max: 450 }
  deadline: { min: 7,  max: 60 }     # days
negotiation: { plugin: pareto_tradeoff, deadline_rounds: 10 }
utility_weights: per_agent_seeded     # deterministic from agent RNG
seed: 7
```

---

## 5. Settlement time as a negotiated dimension (Net 0/30/60 → continuous)

### 5.1 Research context (verified)

- **Real-time settlement rails change the meaning of Net terms.** RTP (The Clearing House, 2017) and FedNow (Federal Reserve, 2023) settle within seconds, 24/7/365, transfers final on acceptance. Industry analysis: real-time payments "make real-time, dynamic discounting a reality, enabling businesses to incentivize early payments... while optimizing working capital." Federal Reserve 2022 survey: 28% of businesses cite slow payments as a major challenge; 45% say faster payments would lower costs. Sources: jpmorgan.com/insights/payments/real-time-payments · volantetech.com/what-are-real-time-payments · crossriver.com/insights/comparing-rtp-and-fednow.
- **Agentic-payments protocols make settlement timing programmable by agents:** Google AP2 (ap2-protocol.org), Coinbase x402 (x402.org) — both cited in the agentic-commerce literature (arXiv 2507.19550, 2602.00213). The hackathon's own **problem 03** (`03-payments-streaming-x402.md`, local) asks for x402-style streaming payments — settlement timing is already first-class in the same hackathon.
- **Key economic shift:** Net 30/60 historically bundles *trade credit* (financing the buyer) with *settlement friction* (batch rails take 1–2 business days). Instant rails drive the friction component → 0, leaving payment terms as a **pure financing negotiation**: when should value transfer, and at what discount.

### 5.2 The codebase already contains the utility function

The DD engine (`dd-calculator.ts`, buyer `handleDDOffer`) computes:
```
annualizedDiscount = maxDiscountRate × (365 / totalDays)
accept early settlement iff annualizedDiscount > costOfCapital (± escalation band)
```
and the seller's treasury (ACTUS NPV, workingCapitalCost) prices the other side. That *is* the time-value utility model — currently a **post-negotiation phase**. The conceptual move: **fold it into the negotiation as a third issue.**

### 5.3 Design: `settlement_days` as a negotiable attribute

```
Terms = { price, quantity, settlement_days ∈ [0, 60] }   # 0 = real-time settlement (RTP/FedNow/x402)

u_seller(price, t) ∝ price · (1 − r_s·t/365)    # r_s = seller's working-capital / financing rate
u_buyer(price, t)  ∝ −price · (1 − r_b·t/365)   # r_b = buyer's cost of capital (BUYER_DD_CONFIG / live SOFR)
```

**The economically interesting property:** a ZOPA exists in the *time* dimension whenever `r_s > r_b` — the seller values early cash more than it costs the buyer to pay early. Then price-for-time trades are Pareto-improving: buyer pays slightly more (or forgoes discount) for Net 60, or seller grants a discount for Net 0. The Pareto frontier is genuinely 2-D (price × settlement) — exactly what problem 07's validator verifies. Existing audit fields (`marketContext.sofrRate`, `effectiveBorrowingRate`) supply realistic per-round `r_b`; treasury `workingCapitalCost` supplies `r_s`.

```yaml
# scenarios/settlement_terms.yaml
name: settlement_terms_market
pairs: 10
issues:
  price:           { min: 300, max: 450 }
  settlement_days: { min: 0, max: 60 }    # Net 0 (instant rail) .. Net 60
agent_params:
  sellers: { financing_rate: seeded(0.06..0.14) }   # r_s heterogeneity → varied frontiers
  buyers:  { cost_of_capital: seeded(0.04..0.09) }  # r_b
negotiation: { plugin: pareto_tradeoff, deadline_rounds: 10 }
validators: [pareto_frontier, both_ir, zopa_2d, agreement_trap]
```

**Narrative for judges:** "Net 30 was a constant; on instant rails it's a variable. This plugin lets agents *negotiate* the settlement date as a priced attribute, with the discount-for-time curve grounded in each side's financing rate — the agentic version of dynamic discounting, run inside the bargaining instead of after it." Bridges problem 07 (negotiation) and problem 03 (streaming/x402 payments): a negotiated `settlement_days = 0` is precisely what an x402/streaming plugin executes.

### 5.4 Mapping back to tommy/jupiter (application adherence)

| tommy/jupiter today | Under this design |
|---|---|
| Price-only rounds, then DD offered post-invoice | `settlement_days` negotiated in-round alongside price |
| `BUYER_DD_CONFIG.costOfCapital` static / SOFR live | `r_b` per-negotiation parameter (flag) |
| Treasury minViablePrice (cash floor at Net 30) | `minViablePrice(t)` — floor as a function of settlement date |
| DD escalation band (±1%) | Acceptance-region width in the time dimension |
| Audit `outcomeQuality` (price ZOPA only) | 2-D ZOPA + Pareto-frontier audit block |

---

## 6. Agentic-commerce & procurement papers (verified this session)

| Paper / source | What it covers | Link |
|---|---|---|
| **ACES — "What Is Your AI Agent Buying?"** (Allouah, Besbes et al., 2025) | Sandbox auditing AI shopping-agent decisions; choice homogeneity, position biases, model-update instability | arxiv.org/abs/2508.02630 |
| **Magentic Marketplace** (2025) | Open-source environment for studying agentic markets | arxiv.org/pdf/2510.25779 |
| **The Agentic Economy** (Rothschild et al., 2025) | Economics of agent-mediated commerce | arxiv.org/abs/2505.15799 |
| **NegotiationArena** (Bianchi et al., ICML 2024) | LLM-vs-LLM negotiation benchmark; behavioral-tactic exploits (+20% payoff) | arxiv.org/abs/2402.05863 · github.com/vinid/NegotiationArena |
| **Device-Native Autonomous Agents for Privacy-Preserving Negotiations** (2026) | Insurance & B2B procurement; cryptographic audit trails; 27% higher trust with decision trails | arxiv.org/html/2601.00911 |
| **TessPay: Verify-then-Pay Infrastructure for Trusted Agentic Commerce** (2026) | Payment-side trust; catalogs AP2, x402, A2A, W3C VC | arxiv.org/pdf/2602.00213 |
| **A2A + x402 micropayments** (2025) | Extending A2A with ledger identities and x402 micropayments | arxiv.org/pdf/2507.19550 |
| **ACNBP — Agent Capability Negotiation and Binding Protocol** (2025) | Capability negotiation; roots in Contract Net (Smith 1980), FIPA | arxiv.org/pdf/2506.13590 |
| **AP2 — Agent Payments Protocol** (Google, 2025) | Verifiable-credential mandates for agent payments | ap2-protocol.org |
| **x402** (Coinbase, 2025) | Open standard for internet-native per-request payments | x402.org |
| RTP / FedNow primers (JPMorgan, Cross River, Volante) | Instant rails; working-capital and dynamic-discounting implications | jpmorgan.com/insights/payments/real-time-payments |

*The "decision trail → trust" finding (2601.00911) directly validates the Audit Framework v6 design choice.*

### Negotiation benchmarks (verified)
- **ANAC** (annual, since 2010, AAMAS/IJCAI) on **GENIUS / GeniusWeb** — multi-issue, incomplete information, SAOP protocol, scored on utility + social welfare. ii.tudelft.nl/nego · ii.tudelft.nl/genius
- **SCML on NegMAS** — business-like supply-chain league; protocol is a Rubinstein alternating-offers variant. scml.cs.brown.edu · github.com/yasserfarouk/negmas (Mohammad, Nakadai & Greenwald, PRIMA 2020)
- **NegotiationArena** — LLM agents. arxiv.org/abs/2402.05863
- **Human vs. agent:** ANAC Human-Agent League on **IAGO** (Mell & Gratch, USC) — agents tested against human subjects, scored on utility + likeability. myiago.com
- **Human-human datasets:** Deal or No Deal (Lewis et al. 2017, arxiv.org/abs/1706.05125), CaSiNo (Chawla et al. 2021), CraigslistBargain (He et al. 2018)

---

## 7. Deliverable checklist (mapped to problem-07 rubric)

1. Plugin `pareto_tradeoff` registered under `nest.plugins.negotiation` — utility weights/β/deadline via **constructor flags**, protocol surface unchanged.
2. `scenarios/multi_attribute_market.yaml` (price + deadline, 10 pairs, seeded weights) — required.
3. `scenarios/settlement_terms.yaml` (price + settlement_days) — the differentiating extension.
4. Pareto-frontier adversarial validator + IR/ZOPA/agreement-trap validators — must FAIL on `alternating_offers`, PASS on the new plugin.
5. `scenarios/single_dim_procurement.yaml` + `time_dependent` plugin — baseline & tommy/jupiter bridge.
6. Keep `alternating_offers` intact (ship alongside); bilateral only; Tier-1 deterministic only; no inter-session learning.
7. (Separate, optional, outside problem-07): Tier-2 `llm_guardrailed` plugin — the L2-executive pattern, motivated by NegotiationArena findings.

**Out of scope per the official doc:** multi-party negotiation, learning across sessions, sealed-bid mechanisms (coordination layer), LLM-driven bargaining.
