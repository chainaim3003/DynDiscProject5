# @dyndisc/audit-framework-core

**Status:** Scaffold (Iteration 1 of Audit Framework v6). Source modules land in Iterations 2 through 5.

## Purpose

Domain-agnostic audit framework primitives shared by every domain (procurement today; treasury / medical / legal in the future). About 70% of v6's audit machinery is universal-agentic; this package will house it.

## Modules planned (by iteration)

| Iteration | Module | File |
|---|---|---|
| Iteration 2 | Identity proof block | `src/audit-blocks/identity-proof.ts` |
| Iteration 2 | Message signing posture | `src/audit-blocks/message-signing-posture.ts` |
| Iteration 2 | Message log collector | `src/audit-blocks/message-log-collector.ts` |
| Iteration 3 | Autonomy block (six pillars + HITC/HITL/HOTL/HOOTL) | `src/audit-blocks/autonomy-block.ts` |
| Iteration 4 | Think-cycle trace (OpenTelemetry `gen_ai.*` field naming) | `src/audit-blocks/think-cycle-trace.ts` |
| Iteration 4 | Delegation chain (DCC 7 properties + EU AI Act Article 14) | `src/audit-blocks/delegation-chain.ts` |
| Iteration 5 | Framework metrics (cost / outcome / risk-avoided) | `src/audit-blocks/framework-metrics.ts` |
| Iteration 5 | Self-check (5 booleans → 4-value verdict) | `src/audit-blocks/self-check.ts` |
| Iteration 5 | Compliance crosswalk (NIST / ISO / EU AI Act / DCC / OTel / VERIFAGENT) | `src/audit-blocks/compliance.ts` |

## How to add a new domain on top of this core

See the v6 design document section 6 ("Extensibility — why v6's shape transfers to other agentic projects"). A new domain needs about 16 hours of work: schema extension, delegation-steps file, outcome enum, three Handlebars templates, a self-check evidence function, and a compliance crosswalk file.

## References

- `DESIGN/revamp-2026-05-18-framework/AUDIT-FRAMEWORK-V6-DESIGN.md`
- `DESIGN/revamp-2026-05-18-framework/AUDIT-FRAMEWORK-V6-ITERATION-PLAN.md`
- `DESIGN/revamp-2026-05-18-framework/AUDIT-FRAMEWORK-V6-DECISIONS.md`
