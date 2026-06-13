# Negotiation Theory, Autonomy Benchmark & Experiment Design
### Mapping the DynDisc5 audit corpus to scholarly theory; designing a research-grade experiment

**Session:** NANDA-neg-kalai-sathya-2 · **Date:** June 13, 2026
**Status:** Conceptual. No code. Verified vs. inferred separated.

> **[V]** verified from source/audits read this session · **[I]** inferred ·
> **[T]** training-knowledge attribution (scholarly, not re-verified against the paper this session).

---

## 1. What the audit corpus empirically shows [V from index.jsonl + earlier-session read]

All deals: one bilateral dyad (Tommy Hilfiger Europe ↔ Jupiter Knitting, INR),
`maxRounds=3`, essentially all `BASIC_SALES_QUOTING_1`. Five phenomena:

1. **Systemic near-floor convergence.** `sellerMin=350` in every record; finals cluster
   350–370 regardless of buyerMax (closed at 355 even when buyerMax=500). The agreement
   trap is the corpus-wide equilibrium of the current rule set.
2. **Deadline-driven breakdowns despite feasible ZOPA.** `zopaFeasible:true` yet
   `roundsUsed=3=maxRounds` → surplus left on the table purely from horizon exhaustion.
3. **One correct no-ZOPA walk-away.** buyerMax 345 < sellerMin 350 → escalation, correctly
   `zopaFeasible:false`.
4. **Two-sided private info recorded.** Buyer's and seller's records of the same deal
   disagree about buyerMax — each logs its own belief. A genuine incomplete-information set.
5. **Unused second dimension [I].** Quantity 2,000–200,000 and treasury NPV logged per deal,
   yet price outcomes barely move — quantity/financing never traded against price.

---

## 2. Theory assortment — which strategies apply

**Directly measurable in existing audits (no new runs):**
- **Raiffa 1982** reservation/ZOPA/surplus split — buyerMax/sellerMin/finalPrice in every
  row; surplus split computable corpus-wide (~85–100% buyer capture is the norm). [V]
- **Nash 1950 NBS** & **Kalai-Smorodinsky 1975** — both fairness anchors computable post-hoc
  from each reservation pair; corpus = baseline deviation distribution. KS especially apt
  (asymmetric ideal points: buyerMax varies, sellerMin fixed). [V concept / T citation]
- **Agreement bias / agreement trap** — corpus is empirically a catalog of agreement traps;
  operationalized in `outcome-quality.ts` (`agreementTrap` flag). [V]
- **Individual Rationality** (Nash axiom) — verifiable per row; held everywhere observed. [V]
- **Deadline effects** (Fatima/Wooldridge/Jennings line) — maxRounds=3 ZOPA-feasible
  escalations are the signature; corpus is a single point (deadline=3). [T]
- **Myerson-Satterthwaite 1983** two-sided private info — perspective-divergent buyerMax
  records give real incomplete-info conditions. [T]

**Present but only as a single fixed point — the manipulable factors:**
- **Faratin, Sierra & Jennings 1998** time-dependent tactics — buyer's 0.4→0.6 concession is
  one hardcoded Conceder; sweep β (Boulware/Linear/Conceder) per side. [V code / DOI
  10.1016/S0921-8890(98)00029-3]
- Behavior-dependent (tit-for-tat) tactics — partial gap-fraction countering; never varied.
- **Anchoring** (Tversky & Kahneman 1974 [T]) — randomized openings exist; corpus can't
  isolate the effect (everything co-varies) — an experiment can.
- **Rubinstein 1982** alternating offers w/ discounting — protocol shape only; 3-round
  horizon makes discounting inert. Needs longer deadlines to be testable.
- **MAUT / trade-off bidding** (Keeney & Raiffa 1976; Faratin et al. 2002 [T]) — quantity +
  settlement timing logged but never negotiated.
- **Principal-agent guardrails over LLM** (NegotiationArena, Bianchi et al. ICML 2024,
  arXiv 2402.05863) — decision-provenance is the recorded treatment label for an
  L1-vs-L2-vs-BASIC arm (Tier-2 track only).
- **Zeuthen / Monotonic Concession** [T] — not in corpus; valid alternative-protocol arm.

**Not applicable:** TKI conflict styles (declared in types, not honored — nothing to
measure); multi-party and inter-session learning (out of scope per problem-07).

---

## 3. Autonomy benchmark [V scoring / search-verified frameworks]

Two scholarly scales:
- **Parasuraman, Sheridan & Wickens 2000** (IEEE SMC-A 30(3):286–297): automation across
  four function classes — information acquisition, information analysis, decision/action
  selection, action implementation — each with its own level.
- **Feng, McDonald & Zhang 2025** (arXiv 2506.12469): five autonomy levels by the user's
  role — operator, collaborator, consultant, approver, observer; autonomy is designable
  independently of capability.

**Scoring tommy/jupiter per PSW-2000 [V]:**
- Information acquisition — **high** (treasury/SOFR/inventory/credit gathered autonomously).
- Information analysis — **high** (NBS midpoints, ZOPA, concession math autonomous).
- Decision & action selection — **bounded-high** (offers/accepts within hard constraints;
  L2 split LLM-proposes / math-disposes with recorded overrides).
- Action implementation — **the ceiling**: walk-away is NOT autonomous
  (`walkAwayBehavior:"escalate"` → every non-agreement → human; corpus confirms every
  round-exhaustion escalates even with feasible ZOPA).

On Feng et al.: **L3/L4 (consultant/approver) at the deal boundary** (humans absorb what the
3-round protocol can't close) while **L5 (observer) within a round** (no human sees offers).
Asymmetry: *tactical* autonomy near-maximal; *strategic* autonomy (strategy/horizon/
walk-away/multi-issue) low. Security-taxonomy caution (arXiv 2506.23844 [T]): fixed-protocol
L1–L2 suit static safeguards; higher levels need adaptive/introspective mechanisms.

---

## 4. Raising autonomy within guardrails [P]

Principle (Feng et al.): raise the user's role toward observer one function at a time,
transferring each safeguard from post-hoc audit into the in-protocol runtime. Five increments:
1. **Autonomous walk-away (BATNA as value).** Replace escalate-on-exhaustion with autonomous
   reject when no IR-satisfying offer is reachable; reserve human escalation for guardrail
   *breaches*. Largest autonomy gain at near-zero risk (no-ZOPA case already works).
2. **In-protocol fairness corridor.** Promote the audit-time outcome-quality block to a
   runtime acceptance gate around the fairness anchor; outside corridor → approval required.
3. **Strategic self-configuration.** Agent chooses β, deadline, opening anchor from market
   context (inputs already gathered autonomously) instead of constants.
4. **Multi-issue autonomy.** Open quantity + settlement_days as negotiable; treasury/DD math
   = time-value utility; agent trades across issues but cannot exit the 2-D ZOPA.
5. **Graduated autonomy by stakes.** Corpus spans ₹0.7M–73M; autonomy level = f(exposure)
   (small deals → observer; large → approver). CSA Jan-2026 [T]: autonomy alone ≠ risk;
   capability/stakes do. Audit = certification evidence (autonomy certificates).

---

## 5. Common theory vs. per-agent priorities? [V literature]

**Protocol + guardrail + audit schema = common. Utilities, priorities, strategies =
private and asymmetric.** Standard structure of automated-negotiation research:
- Rubinstein assumes a *shared protocol* with *per-agent* discount factors.
- Faratin et al. tactics are explicitly per-agent parameterizations.
- ANAC/GENIUS = shared domains with *private preference profiles* per agent.
- NegotiationArena: payoff asymmetries emerge from *heterogeneous* strategies — symmetric
  self-play can't reveal them.
- Corpus already embodies asymmetry (divergent buyerMax beliefs). Tommy optimizing working
  capital and Jupiter optimizing treasury NPV is the two-sided private-info setting
  (Myerson-Satterthwaite) the theory is about — not a bug to harmonize.

What must be common: protocol surface, message semantics, validator/guardrail suite, audit
schema (so outcomes are comparable). What differs: utility weights, reservations, β/tactic
family, fairness anchor, financing rates, autonomy level.

---

## 6. Autonomy levels — benefits / risks / audit [P]

| Level | What | Benefit | Risk | Audit requirement |
|---|---|---|---|---|
| **L1 Rule-based** | deterministic strategy, floor only | predictable, reproducible, no LLM risk | the verified pathology — near-floor closes, ZOPA-feasible breakdowns | minimal; seed replay |
| **L2 LLM proposes, rules verify** | LLM + non-loss clamp + quality gate | richer tactics, bounded; agreement-trap *prevented* not just reported | LLM exploitability (NegotiationArena), prompt/spec drift | per-decision provenance; every veto/re-propose logged; LLM-vs-clamp divergence |
| **L3 Strategy-selection** | agent picks tactic family/β/deadline/anchor | adapts to counterpart/market; surfaces Boulware side | meta-decision opacity; harder outcome attribution | log selection + justification inputs (introspective) |
| **L4 Multi-issue** | trades price×qty×settlement within multi-D ZOPA | integrative win-win gains corpus leaves on table | guardrail bounds a region; bad deals hide in bundles | per-issue utility decomposition; Pareto-frontier distance |
| **L5 Fully autonomous within hard guardrails** | closes w/o human approval; humans see breaches | max throughput; humans for exceptions | highest; L5 controls over financially material actions not mature; gate by stakes | audit becomes the control surface; continuous; autonomy certificates |

Throughline: each level raises autonomy one notch *and* promotes one safeguard from
post-hoc audit into the runtime loop. You earn autonomy by moving the audit's intelligence inward.

---

## 7. Experiment design [P]

Adopt the **ANAC tournament structure — cross-play, not just self-play.**
Strategy-pairing matrix: buyer strategy × seller strategy ∈ {fixed-Conceder baseline,
Faratin β-sweep, trade-off bidding, Zeuthen-MCP}, over seeded scenario instances.

**Factors:**
- strategy family (per side)
- per-side β (Boulware / Linear / Conceder)
- deadline {3, 6, 10}
- ZOPA width (incl. no-ZOPA control)
- information condition (true vs. believed reservations, from recorded belief asymmetries)
- issue dimensionality (price / price+quantity / price+settlement_days)
- **autonomy level as a treatment** (escalate-on-exhaustion vs. autonomous walk-away;
  audit-time vs. runtime fairness corridor) — measures what each increment costs/gains
- (Tier-2) LLM-vs-rule provenance — replicate NegotiationArena exploitability inside guardrails

**Response variables = existing audit metrics:** surplus split, NBS/KS deviation,
agreementTrap rate, escalation-with-ZOPA rate, rounds used. The live corpus = empirical
baseline arm against every simulated cell.

**Baseline arm (from corpus):** BASIC mode, deadline 3, fixed Conceder → known distribution
(near-floor closes, ZOPA-feasible breakdowns). Realistic ranges: reservations (350 vs
345–500), quantities, financing rates from treasury fields, genuine belief asymmetries.

---

## 8. Scholarly references
Nash 1950; Kalai & Smorodinsky 1975 (Econometrica 43(3), JSTOR 1914280); Raiffa 1982;
Rubinstein 1982 (Econometrica, DOI 10.2307/1912531); Faratin, Sierra & Jennings 1998
(DOI 10.1016/S0921-8890(98)00029-3); Myerson & Satterthwaite 1983; Keeney & Raiffa 1976;
Tversky & Kahneman 1974; Bianchi et al. 2024 (NegotiationArena, ICML, arXiv 2402.05863);
Parasuraman, Sheridan & Wickens 2000 (IEEE SMC-A 30(3):286–297); Feng, McDonald & Zhang 2025
(arXiv 2506.12469); agent-autonomy security taxonomy (arXiv 2506.23844); ANAC/GENIUS
(ii.tudelft.nl/nego).
