// ================= AUDIT FRAMEWORK V6 — INDEX.JSONL APPENDER =================
// Appends one line per audit to `audits/index.jsonl` for fast cross-deal scans.
// Called by `logger.saveAuditJson()` after each successful audit write.
//
// Format: newline-delimited JSON (one AuditIndexLine per physical line),
// per RFC 7464 / JSONL convention. Reader tools (Iteration 6 SQLite sidecar,
// `jq`, etc.) can stream-parse the file line by line.
//
// Concurrency: appendFileSync uses O_APPEND, which is atomic for writes up
// to PIPE_BUF (~4 KB on Linux). An AuditIndexLine fits comfortably within
// that limit, so two agents writing concurrently won't interleave bytes.
// On Windows, append-mode opens are also atomic for small writes — Node's
// fs.appendFileSync wraps a single write() call.

import fs from "fs";
import { getIndexJsonlPath } from "./audit-paths.js";
import type { AuditIndexLine } from "./audit-index-schema.js";

/**
 * Append one line to `audits/index.jsonl` for the given audit.
 *
 * Best-effort: if appending fails (disk full, permission, etc.), logs the
 * error and continues — the per-deal audit JSON is the source of truth, and
 * the index is a fast-lookup convenience. A missing index entry is recoverable
 * (Iteration 6 sidecar rebuilds the index from JSON files).
 *
 * @param line — fully populated AuditIndexLine (schema-validated by caller's type system)
 */
export function appendAuditIndexLine(line: AuditIndexLine): void {
  try {
    const json = JSON.stringify(line);
    fs.appendFileSync(getIndexJsonlPath(), json + "\n", { encoding: "utf8" });
  } catch (err: any) {
    // Do not throw — audit write must not depend on index health.
    // Stderr surfaces the failure to operators without crashing the agent.
    // eslint-disable-next-line no-console
    console.error(
      `[audit-index] append failed for ${line.negotiationId} (${line.perspective}): ` +
      `${err?.message ?? err}`
    );
  }
}
