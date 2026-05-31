# @dyndisc/audit-framework-procurement

**Status:** Scaffold (Iteration 1 of Audit Framework v6). Source modules land in Iteration 3 and Iteration 7.

## Purpose

Procurement-specific audit primitives on top of `@dyndisc/audit-framework-core`. About 30% of v6's audit machinery is domain-specific to procurement; this package will house it.

## Modules planned

| Iteration | Module | File |
|---|---|---|
| Iteration 3 | Procurement intent block (reads `shared/intent-types.ts` + `shared/scenario-loader.ts`) | `src/intent-block.ts` |
| Future | Procurement outcome-quality (ZOPA / NBS / IR — currently lives in `shared/outcome-quality.ts`) | `src/outcome-quality.ts` |
| Iteration 7 | Daily report Handlebars template | `templates/daily.md.hbs` |
| Iteration 7 | Weekly report Handlebars template | `templates/weekly.md.hbs` |
| Iteration 7 | Forensic report Handlebars template (per-deal deep-dive PDF) | `templates/forensic.md.hbs` |

## Why this is a separate package from -core

`@dyndisc/audit-framework-core` knows nothing about prices, ZOPA, or seller margins. Treasury rebalancing, medical-imaging review, legal contract analysis — each gets its own thin shim package like this one, sitting on top of -core. The 16-hour-per-domain estimate in the v6 design (section 6) reflects this split.

## References

- `DESIGN/revamp-2026-05-18-framework/AUDIT-FRAMEWORK-V6-DESIGN.md` section 6
- `A2A/js/packages/audit-framework-core/README.md`
