// ================= AUDIT FRAMEWORK V6 — CENTRAL PATH HELPERS =================
// All audit-related filesystem paths flow through this module. NO file in
// the codebase should call `path.resolve(..., "escalations")` directly.
//
// Folder layout (Iteration 1 of Audit Framework v6):
//
//   A2A/js/src/audits/
//   ├── _legacy_escalations/         ← old files moved here verbatim during rename
//   │   └── NEG-{id}_*.txt
//   │   └── NEG-{id}_*.audit.json
//   │
//   ├── YYYY-MM-DD/                  ← UTC date partitions, one per day
//   │   └── NEG-{id}/                ← one folder per negotiation
//   │       ├── buyer.audit.json     ← buyer's perspective (logger.saveAuditJson)
//   │       ├── seller.audit.json    ← seller's perspective (logger.saveAuditJson)
//   │       ├── {NEG-id}_audit_BUYER.json   ← audit-writer's parallel format (legacy shape, kept)
//   │       ├── {NEG-id}_audit_SELLER.json  ← audit-writer's parallel format (legacy shape, kept)
//   │       ├── escalation_BUYER.txt        ← saveEscalationReport (BUYER side)
//   │       ├── escalation_SELLER.txt       ← saveEscalationReport (SELLER side)
//   │       ├── success_BUYER.txt           ← saveSuccessReport (BUYER side)
//   │       └── success_SELLER.txt          ← saveSuccessReport (SELLER side)
//   │
//   ├── reports/                     ← future iter 7 (AuditReportingAgent output)
//   │   ├── daily/
//   │   ├── weekly/
//   │   └── on-demand/
//   │
//   └── index.jsonl                  ← one line per audit (one buyer line + one seller line per deal)
//
// Why a per-negotiation subfolder: every deal's files live together —
// reports, audits, future PDFs — so an investigator can grab one folder
// and have everything for that deal.
//
// Why UTC date: deterministic across timezones; the team is in IST but
// the regulator review process and report generation run in UTC.
//
// Backward compatibility: callers can still reference the old `escalations`
// name through `getLegacyEscalationsDir()` for UI endpoints that need to
// read historical audits during the transition.

import fs   from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/**
 * Absolute path to the audits root folder.
 * Resolves to: A2A/js/src/audits/
 */
export function getAuditsRoot(): string {
  // __dirname is A2A/js/src/shared/ → parent is A2A/js/src/
  return path.resolve(__dirname, "..", "audits");
}

/**
 * Absolute path to the legacy escalations folder (housing the ~494 files
 * moved verbatim from the old `escalations/` directory during Iteration 1).
 * The UI's /api/quality and /api/baseline endpoints fall back to reading
 * from here when a deal is not found under YYYY-MM-DD/NEG-{id}/.
 *
 * Resolves to: A2A/js/src/audits/_legacy_escalations/
 */
export function getLegacyEscalationsDir(): string {
  return path.join(getAuditsRoot(), "_legacy_escalations");
}

/**
 * Absolute path to a deal's per-NEG folder, partitioned by UTC date.
 * The date is derived from the negotiation ID's epoch-ms suffix (the
 * portion after `NEG-`), so the folder is deterministic for a given deal
 * regardless of when this helper is called.
 *
 * Resolves to: A2A/js/src/audits/YYYY-MM-DD/NEG-{id}/
 *
 * Creates the folder if it doesn't yet exist (recursive mkdir).
 *
 * @param negotiationId — full negotiation ID e.g. "NEG-1779515273352"
 */
export function getDealFolder(negotiationId: string): string {
  const dateStr = deriveUtcDateFromNegotiationId(negotiationId);
  const folder  = path.join(getAuditsRoot(), dateStr, negotiationId);
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
  }
  return folder;
}

/**
 * Absolute path to the cross-deal index.jsonl file.
 * One line is appended per audit write (buyer-perspective + seller-perspective
 * are separate lines per deal, per Q5 in v6 decisions).
 *
 * Resolves to: A2A/js/src/audits/index.jsonl
 */
export function getIndexJsonlPath(): string {
  return path.join(getAuditsRoot(), "index.jsonl");
}

/**
 * Absolute path to the SQLite sidecar database (Audit Framework v6, Iter 6).
 * The sidecar is a *derived* index built by reading `index.jsonl` line by
 * line and inserting one row per audit into the `audits` table. The audit
 * JSON files and `index.jsonl` remain the source of truth; the sidecar is a
 * fast-query convenience that can be rebuilt at any time from `index.jsonl`
 * alone (Strategy A, replay-from-zero — see DECISIONS.md iter-6 addendum
 * Item 3).
 *
 * Resolves to: A2A/js/src/audits/audits.sqlite
 *
 * The file is gitignored (`A2A/js/.gitignore` → `src/audits/*.sqlite`)
 * because it is regeneratable from source-controlled data.
 */
export function getAuditsSqlitePath(): string {
  return path.join(getAuditsRoot(), "audits.sqlite");
}

/**
 * Absolute path to the reports root (used by Iteration 7's AuditReportingAgent).
 * Subfolders daily/, weekly/, on-demand/ are created here during Iteration 1
 * Phase 1 so downstream iterations can write into them without race conditions.
 *
 * Resolves to: A2A/js/src/audits/reports/
 */
export function getReportsRoot(): string {
  return path.join(getAuditsRoot(), "reports");
}

/**
 * Derive the UTC date string (YYYY-MM-DD) from a NEG-{epochms} negotiation ID.
 * If parsing fails (malformed ID), falls back to today's UTC date.
 *
 * Exported for test use; production callers should use getDealFolder().
 *
 * @param negotiationId — e.g. "NEG-1779515273352"
 * @returns e.g. "2026-05-23"
 */
export function deriveUtcDateFromNegotiationId(negotiationId: string): string {
  const m = /^NEG-(\d+)$/.exec(negotiationId);
  if (m) {
    const epochMs = Number(m[1]);
    if (Number.isFinite(epochMs) && epochMs > 0) {
      const d = new Date(epochMs);
      if (!Number.isNaN(d.getTime())) {
        return formatYYYYMMDDUtc(d);
      }
    }
  }
  // Malformed ID — fall back to today
  return formatYYYYMMDDUtc(new Date());
}

/** Format a Date as YYYY-MM-DD in UTC (no time component). */
function formatYYYYMMDDUtc(d: Date): string {
  const y = d.getUTCFullYear().toString().padStart(4, "0");
  const m = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = d.getUTCDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}
