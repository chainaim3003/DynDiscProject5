// ============================ SQLITE SIDECAR ============================
// Audit Framework v6 — Iter 6: derived flat-index over `audits/index.jsonl`
// into `audits.sqlite` for fast cross-deal GraphQL queries.
//
// Strategy A (locked in DECISIONS.md iter-6 addendum Item 3): on startup
// truncate `audits` and replay every line of index.jsonl. After replay,
// poll the file for new appends every 1000ms (Item 3 explicitly leaves
// the tail mechanism open; polling chosen over fs.watch for Windows
// reliability at the iter-6 audit write rate of "a few per minute"
// per Item 7. fs.watch has rename/buffer-overflow quirks on Windows
// that aren't worth the latency savings at this scale.)
//
// The audit JSON files and index.jsonl remain the source of truth
// (Item 0, "honest partial > misleading complete"). The sidecar is
// regeneratable from index.jsonl alone and is gitignored.
//
// Module shape: pure functions + a `startSidecar()` factory returning a
// handle the caller (typically `api/graphql/index.ts`) uses to manage
// lifecycle. No module-level singleton.
//
// Defensive behavior (per Item 0):
//   - Missing index.jsonl       → start with empty db, no error.
//   - Malformed JSON line       → log warning, skip line, continue.
//   - schemaVersion mismatch    → log warning, skip line, continue.
//   - Required field missing    → log warning, skip line, continue.
//   - Partial line at EOF       → wait for next poll (no parse attempt).
//   - File truncated under tail → reset offset + full replay.
//   - File deleted under tail   → reset offset, wait for return.
// ============================================================================

import Database from "better-sqlite3";
import fs from "fs";
import { getAuditsSqlitePath, getIndexJsonlPath } from "./audit-paths.js";
import type { AuditIndexLine } from "./audit-index-schema.js";

// ── Schema (verbatim from DECISIONS.md iter-6 addendum Item 2) ──────────────
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS audits (
  schema_version              INTEGER NOT NULL,
  negotiation_id              TEXT    NOT NULL,
  perspective                 TEXT    NOT NULL CHECK (perspective IN ('BUYER','SELLER')),
  audit_file                  TEXT    NOT NULL,
  started_at                  TEXT    NOT NULL,
  generated_at                TEXT    NOT NULL,
  outcome                     TEXT    NOT NULL CHECK (outcome IN ('success','escalation')),
  final_price                 REAL,
  quantity                    INTEGER NOT NULL,
  total_deal_value            REAL,
  currency                    TEXT    NOT NULL,
  rounds_used                 INTEGER NOT NULL,
  max_rounds                  INTEGER NOT NULL,
  self_lei                    TEXT,
  self_entity_name            TEXT,
  counterparty_lei            TEXT,
  counterparty_entity_name    TEXT,
  credential_mode             TEXT    NOT NULL CHECK (credential_mode IN ('plain','vlei')),
  self_process_mode           TEXT,
  seller_live_mode            TEXT,
  closed                      INTEGER NOT NULL CHECK (closed IN (0,1)),
  buyer_max                   REAL,
  seller_min                  REAL,
  zopa_feasible               INTEGER          CHECK (zopa_feasible   IS NULL OR zopa_feasible   IN (0,1)),
  outside_zopa                INTEGER          CHECK (outside_zopa    IS NULL OR outside_zopa    IN (0,1)),
  decision_count              INTEGER NOT NULL,
  treasury_override_applied   INTEGER          CHECK (treasury_override_applied IS NULL OR treasury_override_applied IN (0,1)),
  treasury_final_npv          REAL,
  PRIMARY KEY (negotiation_id, perspective)
);

CREATE INDEX IF NOT EXISTS idx_audits_outcome_started ON audits (outcome, started_at);
CREATE INDEX IF NOT EXISTS idx_audits_generated_at    ON audits (generated_at);
CREATE INDEX IF NOT EXISTS idx_audits_credential_mode ON audits (credential_mode);
`;

const INSERT_SQL = `
INSERT OR REPLACE INTO audits (
  schema_version, negotiation_id, perspective, audit_file,
  started_at, generated_at, outcome, final_price, quantity,
  total_deal_value, currency, rounds_used, max_rounds,
  self_lei, self_entity_name, counterparty_lei, counterparty_entity_name,
  credential_mode, self_process_mode, seller_live_mode,
  closed, buyer_max, seller_min, zopa_feasible, outside_zopa,
  decision_count, treasury_override_applied, treasury_final_npv
) VALUES (
  @schema_version, @negotiation_id, @perspective, @audit_file,
  @started_at, @generated_at, @outcome, @final_price, @quantity,
  @total_deal_value, @currency, @rounds_used, @max_rounds,
  @self_lei, @self_entity_name, @counterparty_lei, @counterparty_entity_name,
  @credential_mode, @self_process_mode, @seller_live_mode,
  @closed, @buyer_max, @seller_min, @zopa_feasible, @outside_zopa,
  @decision_count, @treasury_override_applied, @treasury_final_npv
)
`;

// ── Type-safe row mapping ───────────────────────────────────────────────────

/** Internal row shape — column names match the SQL exactly (snake_case). */
export interface SqlRow {
  schema_version: number;
  negotiation_id: string;
  perspective: string;
  audit_file: string;
  started_at: string;
  generated_at: string;
  outcome: string;
  final_price: number | null;
  quantity: number;
  total_deal_value: number | null;
  currency: string;
  rounds_used: number;
  max_rounds: number;
  self_lei: string | null;
  self_entity_name: string | null;
  counterparty_lei: string | null;
  counterparty_entity_name: string | null;
  credential_mode: string;
  self_process_mode: string | null;
  seller_live_mode: string | null;
  closed: number;                          // 0 | 1
  buyer_max: number | null;
  seller_min: number | null;
  zopa_feasible: number | null;            // 0 | 1 | null
  outside_zopa: number | null;             // 0 | 1 | null
  decision_count: number;
  treasury_override_applied: number | null; // 0 | 1 | null
  treasury_final_npv: number | null;
}

/** Map an optional boolean to SQLite INTEGER: true→1, false→0, undefined/null→null. */
function boolToInt(b: boolean | undefined | null): number | null {
  if (b === true) return 1;
  if (b === false) return 0;
  return null;
}

/**
 * Map an `AuditIndexLine` to a `SqlRow`. Pure function — no I/O.
 *
 * Required fields are validated at runtime (JSON.parse returns `any`, so
 * the TS type alone isn't enough). If any required field is missing,
 * throws a clear error and the caller (replay/tail) skips the row.
 *
 * This is the "reject malformed required fields" design decision from
 * the iter-6 chat (2026-05-26).
 */
export function auditIndexLineToRow(line: AuditIndexLine): SqlRow {
  const required: Array<keyof AuditIndexLine> = [
    "schemaVersion", "negotiationId", "perspective", "auditFile",
    "startedAt", "generatedAt", "outcome", "quantity", "currency",
    "roundsUsed", "maxRounds", "credentialMode", "closed", "decisionCount",
  ];
  for (const k of required) {
    if (line[k] === undefined || line[k] === null) {
      throw new Error(`auditIndexLineToRow: missing required field '${String(k)}'`);
    }
  }

  return {
    schema_version:            line.schemaVersion,
    negotiation_id:            line.negotiationId,
    perspective:               line.perspective,
    audit_file:                line.auditFile,
    started_at:                line.startedAt,
    generated_at:              line.generatedAt,
    outcome:                   line.outcome,
    final_price:               line.finalPrice ?? null,
    quantity:                  line.quantity,
    total_deal_value:          line.totalDealValue ?? null,
    currency:                  line.currency,
    rounds_used:               line.roundsUsed,
    max_rounds:                line.maxRounds,
    self_lei:                  line.selfLei ?? null,
    self_entity_name:          line.selfEntityName ?? null,
    counterparty_lei:          line.counterpartyLei ?? null,
    counterparty_entity_name:  line.counterpartyEntityName ?? null,
    credential_mode:           line.credentialMode,
    self_process_mode:         line.selfProcessMode ?? null,
    seller_live_mode:          line.sellerLiveMode ?? null,
    closed:                    line.closed ? 1 : 0,
    buyer_max:                 line.buyerMax ?? null,
    seller_min:                line.sellerMin ?? null,
    zopa_feasible:             boolToInt(line.zopaFeasible),
    outside_zopa:              boolToInt(line.outsideZopa),
    decision_count:            line.decisionCount,
    treasury_override_applied: boolToInt(line.treasuryOverrideApplied),
    treasury_final_npv:        line.treasuryFinalNPV ?? null,
  };
}

// ── DB lifecycle ────────────────────────────────────────────────────────────

/**
 * Open the SQLite sidecar database, ensure schema, and enable WAL mode.
 * Creates the file if it doesn't exist. Safe to call multiple times
 * (the CREATE TABLE / CREATE INDEX statements all use IF NOT EXISTS).
 *
 * WAL mode is enabled per the WiseLibs/better-sqlite3 README's standard
 * recommendation; gives better concurrent-read performance while the
 * tail loop is INSERTing. No downside at iter-6 scale.
 */
export function openSidecar(): Database.Database {
  const dbPath = getAuditsSqlitePath();
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA_SQL);
  return db;
}

// ── Replay (Strategy A: replay-from-zero on startup) ────────────────────────

/** Counters returned from replay for operator visibility. */
export interface ReplayStats {
  /** Rows successfully INSERT-OR-REPLACEd. */
  inserted: number;
  /** Lines skipped due to schemaVersion mismatch. */
  skipped: number;
  /** Lines skipped due to JSON parse error or missing required field. */
  errors: number;
  /**
   * Byte offset reached in index.jsonl. Equals the position right after
   * the last fully-terminated (\n-ended) line. The tail loop uses this
   * as its starting offset so a partial write at EOF is left for the
   * next poll.
   */
  endOffset: number;
}

/**
 * Strategy A: truncate `audits`, then read every complete line in
 * index.jsonl from byte 0 and INSERT OR REPLACE each one.
 *
 * Lines that fail to parse, fail required-field validation, or have an
 * unrecognized `schemaVersion` are logged and skipped — they never abort
 * the whole replay (per Item 0).
 *
 * If index.jsonl doesn't exist, the table is still truncated (returning
 * to a known empty state) and stats come back all-zero.
 */
export function replayFromZero(db: Database.Database): ReplayStats {
  const stats: ReplayStats = { inserted: 0, skipped: 0, errors: 0, endOffset: 0 };

  const indexPath = getIndexJsonlPath();
  if (!fs.existsSync(indexPath)) {
    console.log(`[sqlite-sidecar] index.jsonl not found at ${indexPath} — starting with empty db`);
    db.exec("DELETE FROM audits");
    return stats;
  }

  // Read the file. At iter-6 scale (hundreds of lines × ~1KB each) this
  // is well under a MB; a single read is simpler than streaming.
  const buf = fs.readFileSync(indexPath);
  const text = buf.toString("utf8");

  // Only parse content up to the last newline. Anything after is a
  // partial write in progress — leave it for the tail loop.
  const lastNl = text.lastIndexOf("\n");
  const completeText = lastNl >= 0 ? text.slice(0, lastNl + 1) : "";
  stats.endOffset = Buffer.byteLength(completeText, "utf8");

  const insert = db.prepare(INSERT_SQL);
  const txn = db.transaction((lines: string[]) => {
    db.exec("DELETE FROM audits");
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue; // blank lines silently ignored
      try {
        const parsed = JSON.parse(line);
        if (parsed.schemaVersion !== 1) {
          console.warn(`[sqlite-sidecar] skipping line with schemaVersion=${parsed.schemaVersion} (expected 1)`);
          stats.skipped++;
          continue;
        }
        const row = auditIndexLineToRow(parsed as AuditIndexLine);
        insert.run(row);
        stats.inserted++;
      } catch (e: any) {
        console.warn(`[sqlite-sidecar] skipping malformed line: ${e?.message ?? e}`);
        stats.errors++;
      }
    }
  });

  txn(completeText.split("\n"));
  console.log(`[sqlite-sidecar] replay complete: inserted=${stats.inserted} skipped=${stats.skipped} errors=${stats.errors} endOffset=${stats.endOffset}`);
  return stats;
}

// ── Tail mode (polling) ─────────────────────────────────────────────────────

export interface TailHandle {
  stop(): void;
}

/**
 * Poll `index.jsonl` every `intervalMs` for new bytes appended after the
 * given offset. New complete (\n-terminated) lines are parsed and
 * INSERT-OR-REPLACEd. Partial trailing chunks are left in place for the
 * next poll.
 *
 * Edge cases:
 *   - File deleted between polls       → reset offset to 0 (next poll
 *                                         picks up if it returns).
 *   - File size < tracked offset       → truncation detected; full
 *                                         replay from zero.
 *   - File size == tracked offset      → no new data; nothing to do.
 *   - Poll-level exception (e.g. EBUSY) → logged and ignored; next poll
 *                                         retries from the same offset.
 *
 * Returns a `TailHandle` whose `stop()` clears the timer; safe to call
 * once after process shutdown.
 */
export function tail(
  db: Database.Database,
  startOffset: number,
  intervalMs = 1000,
): TailHandle {
  const indexPath = getIndexJsonlPath();
  const insert = db.prepare(INSERT_SQL);
  let offset = startOffset;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(poll, intervalMs);
  };

  const poll = () => {
    if (stopped) return;
    try {
      if (!fs.existsSync(indexPath)) {
        if (offset !== 0) {
          console.warn(`[sqlite-sidecar] index.jsonl disappeared — resetting offset, will full-replay when it returns`);
          offset = 0;
        }
        return schedule();
      }

      const stat = fs.statSync(indexPath);

      if (stat.size < offset) {
        console.warn(`[sqlite-sidecar] index.jsonl shrunk (was ${offset} bytes, now ${stat.size}) — replaying from zero`);
        const s = replayFromZero(db);
        offset = s.endOffset;
        return schedule();
      }

      if (stat.size === offset) {
        return schedule();
      }

      // Read new bytes only.
      const fd = fs.openSync(indexPath, "r");
      try {
        const newByteCount = stat.size - offset;
        const buf = Buffer.alloc(newByteCount);
        fs.readSync(fd, buf, 0, newByteCount, offset);
        const text = buf.toString("utf8");

        const lastNl = text.lastIndexOf("\n");
        if (lastNl < 0) {
          // No complete line in the new bytes yet — partial write in
          // progress. Don't advance offset; wait for next poll.
          return schedule();
        }

        const completeText = text.slice(0, lastNl + 1);
        const completeBytes = Buffer.byteLength(completeText, "utf8");
        const lines = completeText.split("\n");

        const txn = db.transaction(() => {
          for (const raw of lines) {
            const line = raw.trim();
            if (!line) continue;
            try {
              const parsed = JSON.parse(line);
              if (parsed.schemaVersion !== 1) {
                console.warn(`[sqlite-sidecar] tail: skipping line with schemaVersion=${parsed.schemaVersion}`);
                continue;
              }
              const row = auditIndexLineToRow(parsed as AuditIndexLine);
              insert.run(row);
            } catch (e: any) {
              console.warn(`[sqlite-sidecar] tail: skipping malformed line: ${e?.message ?? e}`);
            }
          }
        });
        txn();

        offset += completeBytes;
      } finally {
        fs.closeSync(fd);
      }
    } catch (e: any) {
      console.warn(`[sqlite-sidecar] tail poll error (non-fatal, will retry): ${e?.message ?? e}`);
    }
    schedule();
  };

  // Kick off the first poll.
  schedule();

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

// ── Top-level entry ─────────────────────────────────────────────────────────

export interface SidecarHandle {
  db: Database.Database;
  stop(): void;
}

export interface StartSidecarOptions {
  /** Polling interval for tail mode, in milliseconds. Default 1000. */
  tailIntervalMs?: number;
}

/**
 * One-call entry: open db, replay from zero, start tailing.
 *
 * Returns a handle the caller (typically `api/graphql/index.ts`) uses to
 * run queries (`handle.db`) and shut down (`handle.stop()` — clears the
 * tail timer and closes the db connection).
 */
export function startSidecar(opts: StartSidecarOptions = {}): SidecarHandle {
  const db = openSidecar();
  const stats = replayFromZero(db);
  const tailHandle = tail(db, stats.endOffset, opts.tailIntervalMs ?? 1000);
  return {
    db,
    stop() {
      tailHandle.stop();
      db.close();
    },
  };
}
