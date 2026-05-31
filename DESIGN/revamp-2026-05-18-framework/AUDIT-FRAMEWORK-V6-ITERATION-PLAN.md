# Audit Framework v6 — Iteration Implementation Plan

**Project:** DynDisc4-ent1 — Agentic Procurement
**Codebase:** `C:\SATHYA\CHAINAIM3003\mcp-servers\FINAGENTS\FINAGENTS1\DynDisc4-ent1`
**Design source:** `AUDIT-FRAMEWORK-V6-DESIGN.md` (v6, sealed)
**Plan created:** 2026-05-22
**Status:** Approved for execution after pre-flight verification
**Supersedes:** the audit-related portion of `FRAMEWORK-V2.md` and `COMPLETE-ITERATION-PLAN.md` (see `AUDIT-FRAMEWORK-V6-SUPERSEDES.md` for the bridge)

---

## Document purpose

This is the reference document for executing the v6 audit framework rollout in **DynDisc4-ent1**. It contains:

1. The 17 sealed decisions that govern all implementation choices
2. The 7-iteration plan with effort, scope, and acceptance criteria
3. Pre-flight steps required before Iteration 1 begins
4. Parallelization guidance
5. Rollback strategy

**Use this document as the single source of truth for audit framework work.** If anything in the codebase conflicts with this plan, stop and reconcile before proceeding.

---

## Part 1 — The 17 sealed decisions

All 17 design decisions are locked. No further deliberation needed.

| # | Decision | Locked value |
|---|---|---|
| Q1 | Folder name | `audits/` |
| Q2 | Date partitioning | UTC |
| Q3 | Per-NEG subfolders | YES (`audits/YYYY-MM-DD/NEG-{id}/`) |
| Q4 | Legacy file strategy | Bulk move verbatim to `audits/_legacy_escalations/` |
| Q5 | `index.jsonl` granularity | One line per deal |
| Q6 | `selfCheck.overallVerdict` enum | `ON_TRACK` / `ON_TRACK_BUT_FLAGGED` / `OFF_TRACK` / `NEEDS_REVIEW` |
| Q7 | Phasing | 7-iteration plan (this document) |
| Q8 | Gemini prompt storage | Hash + text now; config flag flips to hash-only later |
| Q9 | Autonomy model | Option C (six pillars + HITC/HITL/HOTL/HOOTL) |
| Q10 | DCC per delegation entry | YES — all 7 properties |
| Q15 | New `messageSigningPosture.tier` value | YES — add `HASH_ENVELOPE` (5th tier) |
| Q16 | Legacy bulk move | YES — all ~494 files at once (actual count, verified 2026-05-22) |
| Q17 | Port `:7074` | Confirmed free |
| Q24 | AuditReportingAgent port | `:7074` |
| Q25 | Cron schedule | Daily 21:00 UTC; weekly Sunday 21:00 UTC (= 2:30 AM IST) |
| Q26 | Report cache window | 5 minutes |
| Q27 | Authority role | Chief Audit Officer (non-vLEI plain JSON today; vLEI deferred) |
| Q31 | Discriminator field placement | Option A — sibling fields next to `outcome` |
| Q32 | `commitGate.state` enum | All 8 values: `NOT_REQUIRED` / `PENDING` / `APPROVED` / `REJECTED` / `DEFERRED` / `TIMED_OUT` / `CANCELLED` / `ESCALATED` |

---

## Part 2 — Pre-flight (mandatory before Iteration 1)

These steps protect against data loss and merge conflicts. Do not skip.

| # | Action | Purpose | Status (2026-05-22) |
|---|---|---|---|
| P1 | Create git branch `audit-v6-iter1` from current main | Reversibility | Pending |
| P2 | Copy (not move) `A2A/js/src/escalations/` to an external backup location | Insurance against bulk move | Pending |
| P3 | Run one fresh deal end-to-end on current main; save the resulting audit JSON as `_baseline_audit.json` outside the repo | Baseline for regression check | Pending |
| P4 | Open and read `A2A/js/src/shared/logger.ts`, `agents/buyer-agent/index.ts`, `agents/seller-agent/index.ts` — confirm they exist | Verify file inventory | ✓ Verified — all three exist; `shared/audit-writer.ts` also exists alongside `logger.ts` |
| P5 | Determine package manager (`npm` vs `pnpm`) | Affects workspace config | Pending — check `package.json` |
| P6 | Identify location of root `package.json` | Affects workspace config | ✓ Found at `A2A/js/package.json` (not at repo root) |
| P7 | Check whether `/api/self/mode-status` already exists on seller-agent | Affects Iteration 1 Phase 3 scope | ✓ Yes — added in CONT8 per `M2-DELTA-PROGRESS.md`. Phase 3c scope reduced. |
| P8 | Grep codebase for the string `escalations` | Find all hardcoded path references before rename | Pending |

**Pre-flight is complete only when P1, P2, P3, P5, P8 are also done.**

---

## Part 3 — The 7 iterations

### Iteration 1 — Foundation & Stop the Bleeding

**Effort:** 9.5 hours
**Branch:** `audit-v6-iter1`
**Goal:** New folder structure, two known bugs fixed, no silent data loss

#### Scope

| Work item | Effort |
|---|---|
| Lock 17 decisions in `DESIGN/revamp-2026-05-18-framework/AUDIT-FRAMEWORK-V6-DECISIONS.md` | 0.5h |
| Rename `escalations/` → `audits/` | included in 3h below |
| Create UTC date partitions + per-NEG subfolders | included in 3h below |
| Move all ~494 legacy files to `audits/_legacy_escalations/` | included in 3h below |
| Create `packages/audit-framework-core/` + `packages/audit-framework-procurement/` workspace folders | 3h total for phase 1 |
| Create `shared/audit-paths.ts`, `shared/index-jsonl-writer.ts`, `shared/audit-index-schema.ts` | 3h |
| Fix Bug 1: move seller's `saveAuditJson()` out of IPEX try-block | included in 3h below |
| Fix Bug 2: push initial `decisions[0]` entry at `startNegotiation()` | included in 3h below |
| Rename buyer audit's `sellerResponseMode` → `selfProcessMode`; add new `sellerResponseMode` fetched live from seller's existing `/api/self/mode-status` (already in code per CONT8) | 3h total for phase 3 |
| Update `saveAuditJson()` to write to new path layout + trigger `appendAuditIndexLine()` | included in 3h above |

**Note:** seller's `/api/self/mode-status` endpoint already exists (CONT8). Phase 3c only needs to wire the buyer's audit writer to call it at deal close, not add the endpoint.

#### Acceptance criteria

| # | Test | Pass condition |
|---|---|---|
| T1 | `audits/_legacy_escalations/` contents | All ~494 files present, byte-for-byte identical to backup |
| T2 | Run a fresh success deal | New audit JSON at `audits/YYYY-MM-DD/NEG-{id}/buyer.audit.json` AND `.../seller.audit.json` |
| T3 | `audits/index.jsonl` | Contains exactly 2 new lines (buyer + seller perspective) for the new deal |
| T4 | Buyer audit content | Has key `selfProcessMode` (renamed); has new key `sellerResponseMode` with live seller data |
| T5 | Run a fresh escalation deal | `decisions[]` array has at least one entry |
| T6 | Kill seller IPEX endpoint mid-deal, close deal | Seller audit JSON is STILL written |
| T7 | Compare new audit (T2) vs `_baseline_audit.json` | Same existing top-level keys present (no v6 blocks yet) |

#### Sign-off question

*"Foundation is clean — proceed to Iteration 2 (identity)?"*

---

### Iteration 2 — Honest Identity & Communications

**Effort:** 6 hours
**Branch:** `audit-v6-iter2`
**Goal:** Every audit proves who acted and records every message

#### Scope

| Work item | Effort |
|---|---|
| Emit `agent.self` + `agent.counterparty` blocks (replaces/extends existing `parties` block) | included in 2h below |
| Emit `identityProof` block from `CredentialProvider` data (extends existing `identity` block) | included in 2h below |
| Emit `messageSigningPosture` block with 5 tiers (incl. new `HASH_ENVELOPE`) | 2h total for phase 3.5 |
| Create `shared/audit-blocks/identity-proof.ts` | included above |
| Create `shared/audit-blocks/message-signing-posture.ts` | included above |
| Create `shared/message-log-collector.ts` (in-memory per negotiation) | 4h total for phase 3.7 |
| Instrument every send/receive point in buyer-agent | included above |
| Instrument every send/receive point in seller-agent | included above |
| Emit `messageLog[]` into audit JSON via `logger.ts` | included above |

#### Acceptance criteria

| # | Test | Pass condition |
|---|---|---|
| T1 | Open any audit | `identityProof` block mirrors what GLEIF UI shows for that agent |
| T2 | Check `messageSigningPosture.tier` | Honestly reflects current mode (likely `HASH_ENVELOPE`) |
| T3 | Count envelopes in terminal log vs `messageLog[]` | Counts match exactly |
| T4 | Every `messageLog[]` entry | Has `transportSignature.payloadHash` populated |

#### Sign-off question

*"Identity and message trail are honest — proceed to Iteration 3 (intent + autonomy)?"*

---

### Iteration 3 — Intent & Autonomy

**Effort:** 4.5 hours
**Branch:** `audit-v6-iter3`
**Goal:** Every audit records the mandate and the autonomy granted

#### Scope

| Work item | Effort |
|---|---|
| Create `shared/audit-blocks/intent-block.ts` | 2.5h total for phase 4 |
| Read existing intent from `shared/scenario-loader.ts` + `shared/intent-types.ts` (already in code per CONT8) | included above |
| Emit `intent` block with discriminator pattern | included above |
| Emit `intent.expectedOutcome` with `shape` discriminator | included above |
| Emit `intent.deviationFromIntent.dimensions[]` | included above |
| Create `shared/audit-blocks/autonomy-block.ts` | 2h total for phase 5 |
| Emit `autonomy.capabilitiesActive` (six pillars) | included above |
| Emit `autonomy.humanOversightPosition` (HITC/HITL/HOTL/HOOTL) | included above |
| Emit `autonomy.commitGate` with 8-value state enum | included above |
| Populate `commitGate.wouldFireAt[]` from treasury rejections + max-round termination | included above |

**Note:** intent-types and scenario-loader already exist (CONT8). Iteration 3 reads from them, doesn't create them.

#### Acceptance criteria

| # | Test | Pass condition |
|---|---|---|
| T1 | Open a deal with known scenario (e.g. `happy-path-cotton`) | `intent.expectedOutcome.likely` matches scenario |
| T2 | Check `deviationFromIntent.dimensions[]` | Flags any case where actual outcome diverges from declared intent |
| T3 | `autonomy.commitGate.wouldFireAt[]` | Has entry for any treasury rejection in the deal |
| T4 | `autonomy.humanOversightPosition` | Set to `HOOTL_with_guardrails` (current state) |

#### Sign-off question

*"Intent and autonomy clearly recorded — proceed to Iteration 4 (reasoning + delegation)?"*

---

### Iteration 4 — Reasoning & Delegation Chain

**Effort:** 9 hours
**Branch:** `audit-v6-iter4`
**Goal:** Every audit explains why each decision happened and who authorized it

#### Scope

| Work item | Effort |
|---|---|
| Create `shared/audit-blocks/think-cycle-trace.ts` | 4h total for phase 6 |
| Emit `thinkCycleTrace[]` with 5 steps per round | included above |
| Use OpenTelemetry `gen_ai.*` field naming | included above |
| Instrument `shared/llm-client.ts` to capture `gen_ai.usage.input_tokens`, `output_tokens`, `prompt.hash` | included above |
| Add config flag `auditConfig.includePromptText` (default `true`; future `false` for hash-only) | included above |
| Create `shared/audit-blocks/delegation-chain.ts` | 5h total for phase 7 |
| Emit `delegationChain[]` with ~6 entries per round | included above |
| Attach DCC 7 properties to each entry | included above |
| Attach EU AI Act Article 14 attributes to each entry | included above |
| Sign each entry with `decisionAttestation` via existing MessageSigner | included above |

#### Acceptance criteria

| # | Test | Pass condition |
|---|---|---|
| T1 | Open a 3-round deal | `thinkCycleTrace[]` has 3 entries, each with 5 steps |
| T2 | Each step's field names | Match OpenTelemetry spec (`gen_ai.usage.input_tokens` etc.) |
| T3 | `delegationChain[]` count | ~18 entries (6 × 3 rounds) for a 3-round deal |
| T4 | Each delegation entry | Has valid `decisionAttestation` signature (verifies with MessageSigner) |
| T5 | EU AI Act booleans | Honest current state: `monitorability=true`, `traceability=true`, `interventionPossible=false`, `overridePossible=false` |
| T6 | Gemini prompt | Audit contains both `prompt.hash` AND `prompt.text` (config flag verifiable) |

#### Sign-off question

*"Reasoning and delegation auditable — proceed to Iteration 5 (economics + verdict)?"*

---

### Iteration 5 — Economics & Self-Check Verdict

**Effort:** 7 hours
**Branch:** `audit-v6-iter5`
**Goal:** Every audit self-summarizes for human reviewers — this is the practical MVP point

#### Scope

| Work item | Effort |
|---|---|
| Extend `shared/llm-client.ts` to track per-call USD cost using Gemini published pricing | 4h total for phase 8 |
| Create `shared/audit-blocks/framework-metrics.ts` | included above |
| Emit `frameworkMetrics` block (cost / outcome / risk-avoided) | included above |
| Create `shared/audit-blocks/self-check.ts` | 3h total for phase 9 |
| Emit `selfCheck` block with 5 boolean checks | included above |
| Derive verdict (one of 4 values) | included above |
| Each check links to evidence via RFC-6901 JSON Pointer (`ref` field) | included above |
| Create `shared/audit-blocks/compliance.ts` | included above |
| Emit `compliance` block with NIST / ISO / EU AI Act / DCC / OTel / VERIFAGENT crosswalks | included above |

#### Acceptance criteria

| # | Test | Pass condition |
|---|---|---|
| T1 | Open any audit | Total cost in USD is non-zero and reasonable for round count |
| T2 | `selfCheck.overallVerdict` | One of the 4 locked values |
| T3 | Each of the 5 boolean checks | Has working `ref` JSON Pointer to a real block |
| T4 | `compliance` block | Has entries for NIST AI RMF, ISO 42001, EU AI Act Article 14, DCC |
| T5 | Cost calculation | Matches Gemini's published per-token pricing |

#### Sign-off question

*"Each deal self-summarizes — this is the MVP. Ship now, or proceed to Iteration 6 (cross-deal queries)?"*

> **Strategic checkpoint:** This is the realistic stop-early point. After Iteration 5, the audit framework is regulator-defensible and CFO-readable. Iterations 6 and 7 add queryability and reporting machinery, not new audit content.

---

### Iteration 6 — Cross-Deal Queryability

**Effort:** 9 hours
**Branch:** `audit-v6-iter6`
**Goal:** Query across thousands of deals in milliseconds

#### Scope

| Work item | Effort |
|---|---|
| Create `shared/sqlite-sidecar.ts` using `better-sqlite3` | 3h total for phase 10 |
| Sidecar tails `index.jsonl` and inserts rows into `audits.sqlite` | included above |
| Define SQLite schema mirroring `index.jsonl` line schema | included above |
| Create `api/graphql/` folder structure | 6h total for phase 11 |
| GraphQL schema definitions | included above |
| Resolvers backed by SQLite for filters | included above |
| Resolvers backed by on-demand JSON reads for nested arrays | included above |
| `graphql-yoga` server on port 5000 | included above |

#### Acceptance criteria

| # | Test | Pass condition |
|---|---|---|
| T1 | `audits.sqlite` row count | One row per audit, populated from `index.jsonl` |
| T2 | Run "all escalations this week" SQL query | Returns expected rows in <100ms |
| T3 | Same query via GraphQL | Returns identical results to T2 |
| T4 | Drill into `delegationChain[]` via GraphQL | Returns full nested array from JSON file |

#### Sign-off question

*"Cross-deal queries work — proceed to Iteration 7 (reports + PDF)?"*

---

### Iteration 7 — Reporting & Forensic Output

**Effort:** 11 hours
**Branch:** `audit-v6-iter7`
**Goal:** End-to-end deliverable — reports for CFO, PDFs for legal

#### Scope

| Work item | Effort |
|---|---|
| Create `agents/audit-reporting-agent/` folder | 8h total for phase 12 |
| HTTP server on port `:7074` | included above |
| Authority envelope declaring Chief Audit Officer role (non-vLEI JSON config) | included above |
| `node-cron` schedule: daily 21:00 UTC, weekly Sunday 21:00 UTC | included above |
| HTTP endpoints for on-demand UI trigger and A2A trigger | included above |
| Handlebars templates in `packages/audit-framework-procurement/templates/`: `daily.md.hbs`, `weekly.md.hbs`, `forensic.md.hbs` | included above |
| Agent writes its own `report-generation.audit.json` | included above |
| Update `A2A/js/run-all-agents.ps1` to include new agent | included above |
| Create `ui/src/pages/AuditReports.tsx` | included above |
| Extend `shared/audit-pdf.ts` to render all 14 v6 blocks | 3h total for phase 13 |

#### Acceptance criteria

| # | Test | Pass condition |
|---|---|---|
| T1 | Wait one full day | Daily report auto-generated at 21:00 UTC in `audits/reports/daily/` |
| T2 | Wait until Monday | Weekly report auto-generated in `audits/reports/weekly/` |
| T3 | Click "Generate forensic" in UI for one deal | PDF contains all 14 v6 blocks rendered |
| T4 | Trigger report via A2A from test client | Response returns within 5s; cached for 5min per Q26 |
| T5 | Inspect AuditReportingAgent's own audit | Its own `report-generation.audit.json` exists per self-referential observability |

#### Sign-off

v6 shipped. Tag main as `audit-v6-complete`.

---

## Part 4 — Effort and timeline at a glance

| # | Iteration | Hours | Cumulative |
|---|---|---|---|
| 1 | Foundation & Stop the Bleeding | 9.5 | 9.5 |
| 2 | Honest Identity & Communications | 6 | 15.5 |
| 3 | Intent & Autonomy | 4.5 | 20 |
| 4 | Reasoning & Delegation Chain | 9 | 29 |
| 5 | Economics & Self-Check Verdict (MVP) | 7 | 36 |
| 6 | Cross-Deal Queryability | 9 | 45 |
| 7 | Reporting & Forensic Output | 11 | 56 |
| **Total** | | **56** | |

**Pacing options:**

| Pace | Per week | Total calendar |
|---|---|---|
| Aggressive | 1 iteration | 7 weeks |
| Sustainable | 1 iteration per 2 weeks | 14 weeks |
| Stop-early at Iter 5 (MVP) | 1 iteration per 2 weeks | 10 weeks |

**Add 25% to each iteration for testing + 1 day buffer between iterations for review.**

---

## Part 5 — Parallelization guidance

**Iterations 1 through 5:** Single PC, single developer, sequential. Six of seven iterations modify `shared/logger.ts` and both agent index files. Parallel work on these creates semantic merge conflicts that are expensive to resolve.

**Iterations 6 and 7:** Parallel-safe across two PCs.

| PC | Work |
|---|---|
| PC-A | Iteration 6 — SQLite sidecar + GraphQL server (touches no Iter 1–5 files) |
| PC-B | Iteration 7 — templates + UI page + AuditReportingAgent shell (touches no Iter 1–5 files) |

**Always parallel-safe (any iteration):**
- `DESIGN/...` documentation files
- `packages/*/README.md` files
- Test plan documents

---

## Part 6 — Branch and commit strategy

| Action | When |
|---|---|
| Create branch `audit-v6-iter{N}` from previous iter merge | Start of each iteration |
| Commit per work item (small, atomic) | Throughout iteration |
| Run acceptance tests | End of iteration |
| Merge to main when all tests pass | After sign-off |
| Tag main `audit-v6-iter{N}-complete` | Immediately after merge |
| Delete iteration branch | After merge + tag |

Tags allow rollback to any iteration's completion state.

---

## Part 7 — Out of scope (explicit, to prevent creep)

These are real limitations of v6, named so they don't accidentally pull into iterations:

| Not in v6 | Where it's deferred to |
|---|---|
| Real vLEI cryptographic signing | Future iteration |
| KERI message signing | iter-9 / iter-14 (project's own track) |
| Intent honoring wire-up (random buyer opening stays random) | CONT9 track 3 in `M2-DELTA-PROGRESS.md` |
| Wave B / M2-ζ harness | Separate ~12–16h work per `FRAMEWORK-V2.md` §9 |
| Audit Agent (VERIFAGENT-2025 challenge-response) | Post-WEDGE1 |
| L3 / L4 tier work (M2-η / M2-θ) | Out of scope — tier work, not audit work |
| Second domain extension (treasury, medical, legal) | ~16h per domain once v6 ships |

If during an iteration you find yourself wanting to address any of these, **stop and add a note to the deferred-work log instead**. Do not let scope creep contaminate the iteration.

---

## Part 8 — Rollback strategy

| Scenario | Action |
|---|---|
| Iteration fails acceptance tests | Stay on iteration branch, fix, re-test |
| Iteration introduces unrelated regression | `git checkout audit-v6-iter{N-1}-complete`, branch fresh, retry |
| Multiple iterations later, schema needs revision | Open new design revision (v7); do not patch v6 audit JSONs in place |
| Production deal lost during transition | Recover from `_legacy_escalations/` backup or git history |

---

## Part 9 — Definition of "done" for v6

v6 is complete when ALL of the following hold:

1. All 7 iterations merged to main with passing acceptance tests
2. Main tagged `audit-v6-complete`
3. 5 fresh deals produce audits containing all 14 v6 blocks
4. Daily and weekly reports successfully auto-generated at least once
5. One forensic PDF generated end-to-end for a historical deal
6. SQLite + GraphQL queries return identical results for the same logical query
7. AuditReportingAgent's own audit file exists (self-referential observability)
8. Documentation updated:
   - This plan marked complete
   - `packages/*/README.md` describing the shipped state
   - One-page operator runbook for the AuditReportingAgent

---

## Part 10 — What to do right now

| Step | Action |
|---|---|
| 1 | Complete Part 2 pre-flight (the 5 pending items: P1, P2, P3, P5, P8) |
| 2 | Create branch `audit-v6-iter1` |
| 3 | Begin Iteration 1 work |
| 4 | Run Iteration 1 acceptance tests |
| 5 | Sign off and merge to main |
| 6 | Repeat for Iterations 2 through 7 (or stop at 5 for MVP) |

---

**End of plan. Refer to this document at the start of each iteration.**
