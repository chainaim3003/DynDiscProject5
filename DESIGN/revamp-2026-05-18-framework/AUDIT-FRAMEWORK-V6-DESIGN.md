# Audit Framework v6 — Design

**Project:** DynDisc4-ent1 — Agentic Procurement
**Created:** 2026-05-22
**Status:** Sealed (17 decisions locked, see `AUDIT-FRAMEWORK-V6-ITERATION-PLAN.md` Part 1)
**Execution plan:** `AUDIT-FRAMEWORK-V6-ITERATION-PLAN.md`
**Supersedes note:** `AUDIT-FRAMEWORK-V6-SUPERSEDES.md`

---

## 1. What v6 is

A complete audit framework for agentic procurement. Every closed deal produces one self-explaining JSON file that answers six questions: who acted, what they said, what they were told to do, what autonomy they had, why they decided what they did, and whether they followed the rules.

The framework is regulator-defensible (NIST AI RMF, ISO 42001, EU AI Act Article 14, DCC 2026, OpenTelemetry GenAI, VERIFAGENT 2025) and CFO-readable (5-check self-verdict, cost-per-deal, intent-vs-actual comparison).

---

## 2. Why we are building this

Three pressures make audit non-optional for agentic finance:

1. **Real money moves.** Every deal is a payment commitment. Wrong decisions = real losses. We need to defend each one.
2. **Disputes will happen.** Tamper-evident message logs replace word-against-word.
3. **Regulators are circling AI financial decisions.** EU AI Act Article 14 requires demonstrable human oversight. Without an audit trail, we fail compliance the moment anyone looks.

---

## 3. The 14 audit blocks

Each audit JSON has 14 blocks. Together they answer every reasonable reviewer question.

| Block | What it proves |
|---|---|
| `agent.self` + `agent.counterparty` | Who acted, on whose behalf |
| `identityProof` | Both agents represent real legal entities (LEI) |
| `messageSigningPosture` | Tamper-evidence tier of every message (5 tiers including new `HASH_ENVELOPE`) |
| `messageLog[]` | Every envelope sent and received, hash-signed |
| `intent` | What the agent was told to do (reads from existing scenario contract) |
| `autonomy` | Six pillars + HITC/HITL/HOTL/HOOTL position + commitGate state |
| `thinkCycleTrace[]` | Why each decision happened, step by step (5 steps per round, OTel `gen_ai.*` naming) |
| `delegationChain[]` | Sub-agent consultations with DCC 7 properties + EU AI Act Article 14 attestation |
| `frameworkMetrics` | Cost / outcome / risk-avoided per deal |
| `selfCheck` | 5 boolean checks → verdict (ON_TRACK / ON_TRACK_BUT_FLAGGED / OFF_TRACK / NEEDS_REVIEW) |
| `compliance` | Crosswalk to NIST AI RMF / ISO 42001 / EU AI Act / DCC / OTel / VERIFAGENT |
| `outcomeQuality` | ZOPA / NBS / IR metrics (already exists today) |
| `context` / `learningOutputs` / `replayContext` | Hooks for future training/replay |
| `decisions[]` | Per-round decision trail (already exists today, extended) |

Plus infrastructure around the JSON files:

- `audits/` folder organized by UTC date and negotiation ID
- `index.jsonl` — one line per deal for fast cross-deal queries
- SQLite sidecar + GraphQL endpoint (Iteration 6) for query at scale
- AuditReportingAgent on port `:7074` (Iteration 7) producing daily / weekly / forensic reports

---

## 4. What v6 keeps from prior work in this codebase

v6 builds on, does NOT replace, the M2-δ / M2-ε work already in code:

| From CONT8 / M2-ε | v6 uses it |
|---|---|
| `shared/intent-types.ts` (BuyerIntent, SellerIntent, Scenario) | v6's intent block reads from these |
| `shared/scenario-loader.ts` + 4 scenario JSONs | v6 loads intent via this |
| `/api/self/mode-status` on seller | v6's identity block calls this for live seller mode |
| M2-δ renames (SellerResponseMode, L2_EXECUTIVE_REASONER, etc.) | v6 retains all of them |
| Existing `outcomeQuality` block (ZOPA / NBS / IR) | v6 keeps unchanged |
| `parties` block with LEI + legalEntityName | v6 extends this into `agent.self` / `agent.counterparty` |
| Existing `identity.credentialMode` | v6 extends this into full `identityProof` block |
| Existing `decisions[]` per-round trail | v6 keeps + extends |

The codebase's existing audit JSON is the starting point. v6 adds blocks, extends others, and never deletes data.

---

## 5. What v6 explicitly does NOT do

These limitations are real and named so they don't creep in:

1. **Real vLEI cryptographic signing** — `VleiProvider.ts` stays a stub; authority declared in plain JSON
2. **Real KERI message signing** — `PlainHashSigner.ts` keeps doing sha256-envelope (the new `HASH_ENVELOPE` tier names this honestly)
3. **Intent honoring wire-up** — random buyer opening stays random; v6 records intent vs actual but doesn't force the agent to honor it
4. **L3 / L4 tier work** — `L3_STYLE_AND_AUTONOMY` and `L4_LEARNED_PROFILES_AND_PD` are out of audit scope
5. **Simulation harness** — `FRAMEWORK-V2.md` §9 HARNESS/ tree stays deferred
6. **Second domain extension** — procurement only; treasury / medical / legal deferred

---

## 6. Extensibility — why v6's shape transfers to other agentic projects

v6 separates universal agentic-audit machinery from procurement-specific bits via a package split:

```
packages/
├── audit-framework-core/          ← domain-agnostic (~70% of v6)
│   src/
│     audit-blocks/
│       identity-proof.ts
│       message-signing-posture.ts
│       message-log-collector.ts
│       autonomy-block.ts
│       think-cycle-trace.ts
│       delegation-chain.ts
│       framework-metrics.ts
│       self-check.ts
│       compliance.ts
│
└── audit-framework-procurement/   ← procurement-specific (~30%)
    src/
      intent-block.ts              ← reads procurement BuyerIntent/SellerIntent
      outcome-quality.ts           ← procurement-specific ZOPA / NBS / IR
    templates/
      daily.md.hbs
      weekly.md.hbs
      forensic.md.hbs
```

To add another domain (e.g. treasury rebalancing) later: ~16 hours.

- Schema extension declaring the domain's intent shape
- `delegation-steps.json` listing that domain's sub-agent names
- `outcome-enum.json` listing what "success/failure" looks like in that domain
- Three Handlebars templates (daily / weekly / forensic)
- A `selfCheck` evidence function (~50 lines)
- A compliance crosswalk file

---

## 7. The 17 sealed decisions

All locked. See `AUDIT-FRAMEWORK-V6-ITERATION-PLAN.md` Part 1 for the full table with values.

Highlights:
- Folder: `audits/` with UTC date partition + per-NEG subfolders
- Legacy: bulk-move existing escalation files to `audits/_legacy_escalations/` verbatim (~494 files)
- Index: `audits/index.jsonl`, one line per deal
- Verdict enum: `ON_TRACK` / `ON_TRACK_BUT_FLAGGED` / `OFF_TRACK` / `NEEDS_REVIEW`
- Signing tier: 5 values including new `HASH_ENVELOPE` for honest naming
- AuditReportingAgent: port `:7074`, Chief Audit Officer authority, daily 21:00 UTC + weekly Sunday 21:00 UTC
- DCC 7 properties + EU AI Act Article 14 attributes on every delegation entry

---

## 8. Execution

See `AUDIT-FRAMEWORK-V6-ITERATION-PLAN.md`.

Seven iterations:

| # | Iteration | Hours |
|---|---|---|
| 1 | Foundation & Stop the Bleeding | 9.5 |
| 2 | Honest Identity & Communications | 6 |
| 3 | Intent & Autonomy | 4.5 |
| 4 | Reasoning & Delegation Chain | 9 |
| 5 | Economics & Self-Check Verdict (MVP) | 7 |
| 6 | Cross-Deal Queryability | 9 |
| 7 | Reporting & Forensic Output | 11 |
| | **Total** | **56** |

**Practical MVP at Iteration 5 (36 hours).** Iterations 6 and 7 add query and report tooling; they don't add audit content.

---

**End of design summary. Working document: `AUDIT-FRAMEWORK-V6-ITERATION-PLAN.md`.**
