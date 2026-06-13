# NANDA-neg-kalai-sathya-2 — Session Record
### Turn-by-turn record of session 2 (continuation of NANDA-12-negotiation-kalai-sathya-1)

**Date:** June 13, 2026
**Project:** NANDA hackathon contribution to the nest Negotiation layer (problem 07:
multi-attribute Pareto negotiation), grounded in tommy/jupiter (DynDiscProject5/6).
**Continued from:** `HANDOFF-NANDA-neg-kalai-sathya-2.md` (the handoff prompt) and
`NANDA-neg-kalai-sathya-1-jun12-2026.md` (session 1 record).

> This record is reconstructed from the live session context. Verified vs. inferred is
> preserved as stated in-session. Two corrections made mid-session are recorded honestly
> (see Turn 6 / Turn 7), not silently cleaned up.

---

## Companion artifacts written this session
1. **NANDA-arch-principal-agent-llm-guardrail.md** — consolidated architecture (verified
   DynDisc5 findings, autonomy ladder, as-is/to-be, integration design, responsibility
   matrix, migration plan). Saved to DynDiscProject5 negotiations + mirrored to DynDiscProject6.
2. **NANDA-negotiation-theory-and-autonomy-analysis.md** — theory mapping, autonomy
   benchmark, autonomy-level table, experiment design. Same two locations.
3. **NANDA-neg-kalai-sathya-2.md** — this file.

---

## Tooling note
The Filesystem MCP server became unresponsive mid-session (two 4-minute timeouts on a
directory_tree / list_directory of `DynDiscProject5\DESIGN`). It was restarted (tool names
changed Filesystem:→filesystem:, reduced toolset). After restart, reads of the NANDA and
DynDiscProject5 checkouts succeeded, and write capability (`filesystem:write_file`) was
confirmed and used to save these artifacts.

---

## Turn 1 — Continuation kickoff
User pasted the continuation prompt and asked to read the handoff + session-1 + theory-mapping
+ scenario-design docs, then the framework sources (writing-a-plugin, plugins.py,
simulator.py, marketplace agent, runner).

**Outcome [V]:** Steps 1–2 of the handoff completed.
- Plugin registration: entry-point group `nest.plugins.negotiation`; structural Protocol
  interfaces; built-ins in `_BUILTINS`. Testing = plain pytest + run scenario + validate trace.
- **New finding:** the marketplace scenario factory never instantiates/calls the negotiation
  plugin. Buyers send flat `buy:product:price`; sellers do one-shot `price>=min_price`. So
  `alternating_offers` is **dead code in every shipped scenario** — the `close()` bug can't
  manifest in traces because the plugin is never reached outside its unit test. Strengthens
  the PR narrative: the reference negotiation plugin is both broken AND unreachable.
- Implementation implications locked: must write own scenario factory + negotiating agents;
  validators as functions in VALIDATORS dict; determinism via `ctx.rng`.

---

## Turn 2 — Theory/strategy mapping to the audits
User asked (conceptual, no code): which negotiation theories/strategies apply to the existing
negotiations + audits, to design a thorough experiment. Path:
`...\DynDiscProject5\A2A\js\src\audits`.

**Outcome [V index.jsonl + earlier reads]:** Five empirical phenomena (near-floor convergence;
ZOPA-feasible breakdowns; one correct no-ZOPA walk-away; recorded two-sided private info;
unused quantity dimension). Assorted theories into: directly-measurable (Raiffa/ZOPA, NBS,
KS, agreement-trap, IR, deadline effects, Myerson-Satterthwaite) vs. single-fixed-point
manipulable factors (Faratin β, anchoring, Rubinstein discounting, MAUT trade-off, LLM
provenance, Zeuthen). Not applicable: TKI, multi-party, inter-session learning.
→ Captured in **NANDA-negotiation-theory-and-autonomy-analysis.md** §1–2.

---

## Turn 3 — Autonomy benchmark + assort + raise-autonomy design + P5/P6 compare
User asked to (1) benchmark on a scale of autonomy per contemporary research, (2) assort into
theories, (3) design higher autonomy within guardrails, (4) compare P5 vs P6 designs, using
NegotiationArena + scholarly papers; and answer common-vs-per-agent theory question.

**Filesystem timed out twice** on the DESIGN folder read → P5-vs-P6 compare BLOCKED;
NegotiationArena local-clone analysis deferred. Asked user to restart MCP server (manual step).

**Outcome [V scoring; search-verified frameworks]:** PSW-2000 four-function scoring (acquisition
& analysis high; decision bounded-high; action-implementation is the ceiling — walk-away
escalates). Feng et al. five levels: L3/L4 at deal boundary, L5 within a round. Five autonomy
increments. Common protocol/guardrail + private utilities answer (ANAC/GENIUS, Rubinstein,
Faratin, NegotiationArena).
→ Captured in **NANDA-negotiation-theory-and-autonomy-analysis.md** §3–7.

---

## Turn 4 — Explain principal-agent / LLM-guardrail
User uploaded an excerpt of a prior Claude message and asked for more detail.

**Outcome [search-verified]:** Verified the NegotiationArena paper rather than trusting memory:
headline finding = simulated desperation improves payoff ~20% vs standard GPT-4; agents show
human-like irrational behaviors; ICML 2024 confirmed. Explained two senses of principal-agent
(economic delegation theory vs. the architecture), the recursion when an LLM is the proposer,
and the corpus incident — flagged the `GEMINI_ERROR_RULES_FALLBACK` detail as from prior-session
reads, not re-verified.

---

## Turn 5 — Elaborate + as-is/to-be (textual)
User asked to elaborate the "promote audit into runtime veto" idea and show as-is/to-be + code
design perspective.

**Outcome [P]:** Non-loss guardrail vs. quality guardrail distinction. Shared pure evaluator
with two call sites (synchronous gate in round loop; async post-hoc audit). AS-IS / TO-BE
textual diagrams. Proposed QualityGate / WalkAway flag interfaces (design only). Flagged as-is
control flow as from prior-session reads, not re-verifiable while filesystem was down.

---

## Turn 6 — Conceptual design analysis (8 questions)
User asked the 8-part principal-agent + guardrail design questions (components; responsibility
split; lifecycle fit; autonomous vs constrained; theory mapping; common-vs-per-agent; autonomy
levels L1–L5; benefits/risks/audit). Verified observations vs. conceptual recommendations
separated; no code.

**Outcome [V + P]:** Full 8-part answer. Lifecycle fit: open=config, offer=clamp-before-emit,
respond=accept-gate (where agreement trap must be blocked), close=projection of accept.
Autonomy L1–L5 with benefits/risks/audit. → Captured in both companion docs.

---

## Turn 7 — Nanda Town negotiation architecture review
User pointed to a DIFFERENT nandatown checkout: `...\mcp-servers\NANDA\nandatown` (vs the
earlier `FINAGENTS1\nandatown`). Filesystem server had been restarted (lowercase tool names,
reduced toolset: list_directory, read_multiple_files, get_file_info, list variants — NO
directory_tree/search_files/read_text_file).

**Outcome [V — read this checkout's source]:**
- Negotiation layer = clean 4-method Protocol; one reference plugin `AlternatingOffers`
  (patience discount); real `respond()` rule.
- **`close()` BUG confirmed in this source:** returns Agreement whenever `current_terms is not
  None` (set on every open) → agrees even when respond said accepted=False. The conformance
  test `test_open_offer_respond_close` encodes this (asserts agreement is not None regardless).
- **NO `negotiation` key in VALIDATORS** (marketplace/auction/voting/consensus/supply_chain/
  reputation all have validators). **NO negotiation scenario.** Marketplace agents never touch
  the plugin (`_instantiate_plugins` wires registry/trust/payments/identity, not negotiation).
- Verdict: plugin socket + minimal reference stub = research scaffold, not a framework.
- Reuse/replace/keep matrix; MVP/recommended/long-term tiers; as-is/to-be; responsibility
  matrix; migration plan. Open gap: `types.py` (Terms multi-attribute) not read.
→ Captured in **NANDA-arch-principal-agent-llm-guardrail.md** §2–12.

---

## Turn 8 — DynDisc5 codebase analysis + integration architecture
User pointed to `...\mcp-servers\DynDiscProject5` (different location from FINAGENTS1 copy) and
asked for the full Principal→Agent→LLM→Guardrail analysis + Nanda Town integration design.

**Read this session [V]:** NEGOTIATION_EXPLANATION.md, NEGOTIATION_README.md,
outcome-quality.ts, negotiation-mode.ts, l2-executive.ts, advisor-math-aggregator.ts.

**Three corrections to earlier-session claims [C]:**
1. Proposer LLM = **Groq / Llama 3.3 70B**, not Gemini (Gemini is a future Phase-1 add).
2. Guardrail = structured executive with explicit math-authoritative / LLM-authoritative trust
   split + recorded `mathOverride`, not a single floor clamp.
3. **`GEMINI_ERROR_RULES_FALLBACK` label NOT found** in files read → retracted as a stated fact.
   Verified instead: real pure-math fallback path + DefensiveAction vocabulary.

**Verified architecture:** mode ladder (BASIC/L1/L2 shippable; L3/L4 throw) = audit-stamped
autonomy ladder. Decision pipeline: hard treasury gate → advisor math (effectiveFloor,
nbsMidpoint, alphaWeightedUtility 0.6/0.2/0.2, deltaDiscount; hardFloor=max(effFloor,
treasuryMin), ceiling=target×1.5) → LLM soft proposal → 4 clamp/override rules (recorded) →
outcome-quality at close (IR/ZOPA/NBS/surplus/agreementTrap=closedPrice≤sellerMin×1.02).
Fairness guardrail runs ONLY post-close — the gap the integration targets.

**Integration design [P]:** reuse advisor-math-aggregator + outcome-quality (pure → portable;
outcome-quality IS the negotiation validator); adapt message-types→methods; replace close()
via new plugin alongside; keep Protocol/types/simulator/validator-arch. Same guardrail logic =
runtime veto + offline audit (agree by construction). Full runtime flow, responsibility matrix,
interaction sequence, migration plan.
→ Captured in **NANDA-arch-principal-agent-llm-guardrail.md** (whole doc).

---

## Turn 9 — Principal vs principle (spelling)
User asked which word. Answer: **principal** (delegation party, principal-agent theory) — the
right word throughout. "Principle" = a rule/belief, not used here.

## Turn 10 — Detailed principal/principle + principal-agent explanation
Explained the two words with examples; principal-agent theory (Ross 1973, Jensen & Meckling
1976, Eisenhardt 1989), two frictions (goal divergence, information asymmetry), remedies
(monitoring, bonding), everyday examples (contractor, CEO/shareholders, lawyer), and the mapping
to the negotiation system + the LLM recursion.

## Turn 11 — Save artifacts (this turn)
User asked to save all session artifacts to DynDiscProject5 + DynDiscProject6 and save the full
session as NANDA-neg-kalai-sathya-2.md. Confirmed write capability, consolidated the session's
inline design work into the three companion docs above, wrote to the DynDiscProject5
negotiations folder, mirrored the two design docs to DynDiscProject6\DESIGN_6\negotiations.

---

## Verified-source inventory (this session)
**Nanda Town (`...\NANDA\nandatown`):** layers/negotiation.py; validators.py;
scenarios_builtin/marketplace.py; nest_plugins_reference/negotiation/alternating_offers.py;
tests/test_plugins.py; docs/layers/negotiation.md; package + scenarios_builtin listings.
**DynDisc5 (`...\mcp-servers\DynDiscProject5`):** A2A/js/NEGOTIATION_EXPLANATION.md;
NEGOTIATION_README.md; src/shared/outcome-quality.ts; negotiation-mode.ts; l2-executive.ts;
advisor-math-aggregator.ts; src/shared + seller-agent listings; audits/index.jsonl (earlier).

## Open verification gaps carried forward
- `nest_core/types.py` (NANDA) — Terms multi-attribute support: NOT read. Read first next session.
- `consultation-router.ts`, `llm-client.ts` (DynDisc5) — NOT read; ConsultationBundle build +
  Groq call site inferred from consumers.
- `GEMINI_ERROR_RULES_FALLBACK` — retracted as fact; needs a direct grep to settle.
- P5-vs-P6 DESIGN-folder compare — still BLOCKED/not done (was the original Turn-3 request;
  filesystem timed out, then session pivoted). Outstanding.
- NegotiationArena local clone (`...\FINAGENTS1\NegotiationArena`) — UNANALYZED.
- Checkout identity across NANDA/FINAGENTS1 and the two DynDiscProject5 locations — not assumed equal.

## Recommended next step
Read NANDA `nest_core/types.py` to close the Terms multi-attribute gap, then proceed to the
MVP contribution slice (negotiation scenario + 2 agents + IR/mutual-accept/agreement-trap
validators + corrected plugin; demonstrate FAIL-on-old / PASS-on-new).
