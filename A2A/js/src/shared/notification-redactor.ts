// ============================ NOTIFICATION REDACTOR ============================
// Audit Framework v6 — Iter 6: pre-write redaction of Twilio Account SIDs in
// `notifications[]` audit entries.
//
// Why this exists:
//   v1.0.6's push to origin/main was rejected once because audit JSON files
//   contained Twilio Account SIDs (pattern AC + 32 lowercase hex) inside
//   notifications[].error strings from failed WhatsApp deliveries. The
//   GitHub Push Protection secret scanner correctly flagged the SIDs as
//   provider-identifying secrets. This module scrubs them at WRITE TIME,
//   BEFORE the audit JSON ever hits disk, so the scanner has nothing to
//   flag.
//
// Complementary to:
//   `Scrub-TwilioSIDs-LegacyAudits.ps1` (repo root) — a post-hoc PowerShell
//   scrubber that redacts already-written LEGACY audits with the marker
//   `AC_REDACTED_LEGACY`. This module uses a DIFFERENT marker
//   (`AC[REDACTED]`) on purpose so a reader can distinguish "scrubbed at
//   write time, never on disk" from "scrubbed retroactively after disk
//   write." See DECISIONS.md iter-6 addendum Item 8.
//
// Scope (locked iter-6, per DECISIONS.md iter-6 addendum Item 8):
//   - Pattern : AC[a-f0-9]{32}   — Twilio Account SID format only.
//   - NOT in scope: SK / SM / CH / IS Twilio identifier formats. If a
//     similar push block recurs from one of those, an iter-7+ addendum
//     extends scope; do not add patterns here without that paper trail.
//   - Replacement string: literal "AC[REDACTED]".
//
// Honest gap (per DECISIONS.md iter-6 addendum Item 8):
//   - Redaction is a SHALLOW scan over string-valued fields of each entry
//     in `notifications[]`. It does NOT recurse into nested objects. The
//     current notification schema has flat error strings; if a future
//     schema nests further, this redactor must be extended via an addendum.
//
// Behavior contract:
//   - Input null / undefined / non-array      → returned unchanged (identity).
//   - Input array with zero matching SIDs     → returned unchanged (identity);
//                                               the SAME array reference is
//                                               returned (no allocation).
//   - Input array with at least one match     → returns a NEW array (input
//                                               is not mutated). Entries with
//                                               no replacements share the
//                                               input's reference; entries
//                                               with replacements are new
//                                               objects.
//
// The signature `(notifications: any[]): any[]` is locked in the addendum
// and reproduced here. Internally we type-narrow as we go.

/**
 * Regex for the Twilio Account SID format: literal `AC` followed by exactly
 * 32 lowercase hex chars. Exported for testability and for the iter-6
 * acceptance test (`Test-AuditV6-Iter6.ps1`) to assert post-write absence.
 *
 * Case-sensitive on purpose. All observed Twilio SIDs are lowercase, and
 * keeping the pattern case-sensitive avoids accidentally matching unrelated
 * uppercase identifiers (LEIs, AIDs, etc.). This matches the case-sensitivity
 * of `Scrub-TwilioSIDs-LegacyAudits.ps1` (`(?-i)AC[0-9a-f]{32}`).
 *
 * The `g` flag is required for `.replace()` to scrub multiple SIDs in a
 * single string. `String.prototype.replace` resets the regex's `lastIndex`
 * internally on each call, so sharing this constant across calls is safe.
 */
export const TWILIO_ACCOUNT_SID_PATTERN = /AC[a-f0-9]{32}/g;

/** Replacement marker for redacted SIDs (write-time path). */
export const TWILIO_REDACTION_MARKER = "AC[REDACTED]";

/**
 * Redact Twilio Account SIDs from a notifications[] array.
 *
 * Pure function: input is never mutated. Returns the input reference when
 * no scrubbing is needed (identity), or a new array when at least one SID
 * was replaced.
 *
 * @param notifications  the audit's `notifications[]` array (or any value;
 *                       null / undefined / non-array return as-is)
 * @returns              a scrubbed copy on match, or the original input
 *                       reference on no-op
 */
export function redactNotifications(notifications: any[]): any[] {
  // Identity for non-array input. The signature says any[] but callers may
  // pass undefined when the audit has no notifications block at all.
  if (!Array.isArray(notifications)) return notifications;

  let anyEntryChanged = false;
  const scrubbed = notifications.map(entry => {
    if (!entry || typeof entry !== "object") return entry;

    let thisEntryChanged = false;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(entry as Record<string, unknown>)) {
      if (typeof value === "string") {
        const replaced = value.replace(
          TWILIO_ACCOUNT_SID_PATTERN,
          TWILIO_REDACTION_MARKER
        );
        if (replaced !== value) {
          thisEntryChanged = true;
        }
        out[key] = replaced;
      } else {
        // Non-string values pass through verbatim; honest gap per Item 8:
        // no recursion into nested objects.
        out[key] = value;
      }
    }

    if (thisEntryChanged) {
      anyEntryChanged = true;
      return out;
    }
    // Entry had no string fields with SIDs — return its original reference
    // so structural-share consumers see no spurious change.
    return entry;
  });

  return anyEntryChanged ? scrubbed : notifications;
}
