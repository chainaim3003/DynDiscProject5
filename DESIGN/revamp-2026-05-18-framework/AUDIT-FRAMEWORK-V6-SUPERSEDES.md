# Audit Framework v6 — Supersedes Note

**Created:** 2026-05-22
**Status:** v6 is now the active plan for audit framework work in DynDisc4-ent1

---

## What this note does

This note records that the **v6 audit framework plan** (in `AUDIT-FRAMEWORK-V6-DESIGN.md` + `AUDIT-FRAMEWORK-V6-ITERATION-PLAN.md`) supersedes the audit-related plan in `FRAMEWORK-V2.md` and `COMPLETE-ITERATION-PLAN.md` for this codebase.

It does NOT delete or invalidate the old documents — they remain on disk for reference.

---

## What changes

| Topic | FRAMEWORK-V2 (previous) | AUDIT-FRAMEWORK-V6 (active) |
|---|---|---|
| Audit JSON scope | 3 new blocks (delegationChain, thinkCycleTrace, frameworkMetrics) | 14 new blocks (identity, intent, autonomy, reasoning, delegation, cost, verdict, compliance, etc.) |
| Folder layout | Stay in `escalations/` | Rename to `audits/` with UTC date partitioning + per-NEG subfolders |
| Legacy preservation | N/A | Move existing files verbatim to `audits/_legacy_escalations/` |
| Reporting | None planned | AuditReportingAgent on `:7074` with cron + UI + A2A triggers |
| Query layer | None | SQLite sidecar + GraphQL endpoint on port 5000 |
| Per-deal index | None | `audits/index.jsonl` (one line per deal) |
| Effort | ~6–8 hours (M2-ε only) | ~56 hours (7 iterations, MVP at 36h after Iteration 5) |
| Plan structure | M2-δ / M2-ε / M2-ζ / M2-η / M2-θ waves | Iterations 1–7 |

---

## What stays from FRAMEWORK-V2

These FRAMEWORK-V2 ideas are kept, not overridden:

| Kept | Why |
|---|---|
| M2-δ renames already done in code (`SellerResponseMode`, `L2_EXECUTIVE_REASONER`, etc.) | v6 does not undo working code |
| Intent contract from CONT8 (`shared/intent-types.ts`, scenario files, scenario-loader) | v6's intent block builds on this |
| `/api/self/mode-status` convention | v6 retains and extends this for identity reporting |
| `shared/audit-writer.ts` and `shared/logger.ts` as current writers | v6 refactors these, doesn't replace them wholesale |
| HARNESS/ idea (Wave B / M2-ζ) | Deferred per v6 §8 "out of scope" |
| L3 / L4 design work (M2-η / M2-θ) | Deferred per v6 §8 — these are tier work, not audit work |

---

## What v6 absorbs from CONT8 deferred items

The "deferred follow-ups" listed in `M2-DELTA-PROGRESS.md` CONT8 section are absorbed into v6 iterations as follows:

| CONT8 deferred item | Lands in v6 iteration |
|---|---|
| Em-dash cleanup in buyer-agent | Out of scope for v6 (cosmetic) |
| Finding #1 — buyer audit's `sellerResponseMode` block | **v6 Iteration 1, Phase 3c** — rename to `selfProcessMode` + add live-fetched `sellerResponseMode` |
| Intent honoring — full wire | Out of scope for v6 (stays as CONT9 track 3) |
| Seller-intent envelope wire | Out of scope for v6 |
| Group D test-script rewrites | Tested in passing; not a v6 iteration item |
| Group F documentation | Updated at end of each v6 iteration |

---

## Active design documents (read these in this order)

1. **`AUDIT-FRAMEWORK-V6-DESIGN.md`** — what to build (the design)
2. **`AUDIT-FRAMEWORK-V6-ITERATION-PLAN.md`** — how to execute it (7 iterations, hours, acceptance criteria)
3. **`AUDIT-FRAMEWORK-V6-SUPERSEDES.md`** — this note (the bridge)

---

## Reference-only documents (do NOT use as active plan)

1. `FRAMEWORK-V2.md` — older design; reference for vocabulary lock and rename map
2. `COMPLETE-ITERATION-PLAN.md` — older execution plan; reference for what's done in code
3. `M2-DELTA-PROGRESS.md` — historical progress log through CONT8
4. `ITERATION-PLAN-M2-DELTA.md` — superseded by `COMPLETE-ITERATION-PLAN.md`

---

## When v6 is complete

When all 7 v6 iterations are merged and main is tagged `audit-v6-complete`, this folder will be archived. The plan-of-record for audit work will then be in `DESIGN/current/`.

---

**End of supersedes note.**
