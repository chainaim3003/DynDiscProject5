// ============================ GRAPHQL RESOLVERS ============================
// Audit Framework v6 — Iter 6: resolver split per DECISIONS.md Item 6.
//
//   - 28 scalar fields            → SQLite (filtered, paginated, ordered).
//   - 14 nested JSON fields       → on-demand file read per resolver call.
//
// The resolvers are built via `buildResolvers(db)` closing over the SQLite
// db handle returned by `startSidecar()`. No module-level singleton.
//
// Pagination clamp (Item 7): limit > 500 → clamp to 500, push
// "limit_clamped" into AuditConnection.warnings. Negative limit/offset
// throws a GraphQL error.
// ============================================================================

import { GraphQLScalarType, Kind } from "graphql";
import fs from "fs";
import path from "path";
import type Database from "better-sqlite3";
import { getAuditsRoot } from "../../shared/audit-paths.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT     = 500;

// ── Custom JSON scalar ──────────────────────────────────────────────────────
// Read-only schema, so the input paths just return the value verbatim.
// parseLiteral handles only basic literal forms — none of our query args
// use JSON inputs, so this surface should never fire in practice.
const JSONScalar = new GraphQLScalarType({
  name: "JSON",
  description: "Arbitrary JSON value, output-only in iter-6.",
  serialize:   (v: unknown) => v,
  parseValue:  (v: unknown) => v,
  parseLiteral(ast): unknown {
    switch (ast.kind) {
      case Kind.NULL:    return null;
      case Kind.BOOLEAN: return ast.value;
      case Kind.INT:     return parseInt(ast.value, 10);
      case Kind.FLOAT:   return parseFloat(ast.value);
      case Kind.STRING:  return ast.value;
      default:
        throw new Error("JSON literal must be a primitive in iter-6 read-only schema");
    }
  },
});

// ── snake_case row → camelCase Audit core ───────────────────────────────────
// `closed` / `zopa_feasible` / `outside_zopa` / `treasury_override_applied`
// are 0|1|null in SQLite (INTEGER CHECK), normalize back to boolean|null here.
function intToBoolNullable(v: number | null): boolean | null {
  if (v === null || v === undefined) return null;
  return v === 1;
}

function rowToAuditCore(row: any): any {
  return {
    schemaVersion:           row.schema_version,
    negotiationId:           row.negotiation_id,
    perspective:             row.perspective,
    auditFile:               row.audit_file,
    startedAt:               row.started_at,
    generatedAt:             row.generated_at,
    outcome:                 row.outcome,
    finalPrice:              row.final_price,
    quantity:                row.quantity,
    totalDealValue:          row.total_deal_value,
    currency:                row.currency,
    roundsUsed:              row.rounds_used,
    maxRounds:               row.max_rounds,
    selfLei:                 row.self_lei,
    selfEntityName:          row.self_entity_name,
    counterpartyLei:         row.counterparty_lei,
    counterpartyEntityName:  row.counterparty_entity_name,
    credentialMode:          row.credential_mode,
    selfProcessMode:         row.self_process_mode,
    sellerLiveMode:          row.seller_live_mode,
    closed:                  row.closed === 1,
    buyerMax:                row.buyer_max,
    sellerMin:               row.seller_min,
    zopaFeasible:            intToBoolNullable(row.zopa_feasible),
    outsideZopa:             intToBoolNullable(row.outside_zopa),
    decisionCount:           row.decision_count,
    treasuryOverrideApplied: intToBoolNullable(row.treasury_override_applied),
    treasuryFinalNPV:        row.treasury_final_npv,
  };
}

// ── 14 nested-field JSON-on-demand reader ──────────────────────────────────
// Each Audit field resolver below calls this with its own field name. The
// reader caches NOTHING — re-reads the file on every resolver call, since
// the audit JSON may be re-written by audit-attach.ts after notifications
// are appended. Cost is acceptable: each file is <1MB and reads happen only
// when the field is requested by the client.
const NESTED_FIELDS = [
  "decisions", "thinkCycleTrace", "delegationChain", "messageLog",
  "intent", "autonomy", "identityProof", "messageSigningPosture",
  "agentSelf", "agentCounterparty", "frameworkMetrics", "selfCheck",
  "compliance", "outcomeQuality",
] as const;
type NestedField = typeof NESTED_FIELDS[number];

function readNestedField(auditFileRel: string, field: NestedField): unknown {
  try {
    const abs = path.join(getAuditsRoot(), auditFileRel);
    const content = fs.readFileSync(abs, "utf8");
    const parsed = JSON.parse(content);
    return parsed[field] ?? null;
  } catch (e: any) {
    // Per DECISIONS.md Item 6: degrade, don't crash. Log + return null.
    console.warn(`[graphql] could not read ${field} from ${auditFileRel}: ${e?.message ?? e}`);
    return null;
  }
}

// ── Resolver builder ────────────────────────────────────────────────────────

export function buildResolvers(db: Database.Database) {
  // Filter args → SQL WHERE clause (parameterized, no string concat of values).
  function whereClause(args: any): { sql: string; params: Record<string, unknown> } {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (args.outcome != null) {
      where.push("outcome = @outcome");
      params.outcome = args.outcome;
    }
    if (args.credentialMode != null) {
      where.push("credential_mode = @credentialMode");
      params.credentialMode = args.credentialMode;
    }
    if (args.perspective != null) {
      where.push("perspective = @perspective");
      params.perspective = args.perspective;
    }
    if (args.closed != null) {
      where.push("closed = @closed");
      params.closed = args.closed ? 1 : 0;
    }
    if (args.negotiationId != null) {
      where.push("negotiation_id = @negotiationId");
      params.negotiationId = args.negotiationId;
    }
    if (args.startedAfter != null) {
      where.push("started_at >= @startedAfter");
      params.startedAfter = args.startedAfter;
    }
    if (args.startedBefore != null) {
      where.push("started_at <= @startedBefore");
      params.startedBefore = args.startedBefore;
    }
    return {
      sql: where.length > 0 ? `WHERE ${where.join(" AND ")}` : "",
      params,
    };
  }

  // Build Audit-type field resolvers for the 14 nested fields by
  // closing over the field name in the loop.
  const auditFieldResolvers: Record<string, (parent: any) => unknown> = {};
  for (const field of NESTED_FIELDS) {
    auditFieldResolvers[field] = (parent: any) => {
      if (!parent || !parent.auditFile) return null;
      return readNestedField(parent.auditFile, field);
    };
  }

  return {
    JSON: JSONScalar,

    Query: {
      audits: (_parent: unknown, args: any) => {
        const warnings: string[] = [];

        // Validate pagination args.
        let limit  = args.limit  ?? DEFAULT_LIMIT;
        let offset = args.offset ?? 0;
        if (limit < 0 || offset < 0) {
          throw new Error("limit and offset must be non-negative");
        }
        if (limit > MAX_LIMIT) {
          limit = MAX_LIMIT;
          warnings.push("limit_clamped");
        }

        const { sql: whereSql, params } = whereClause(args);

        const countRow = db
          .prepare(`SELECT COUNT(*) AS c FROM audits ${whereSql}`)
          .get(params) as { c: number };
        const totalCount = countRow.c;

        const rows = db
          .prepare(
            `SELECT * FROM audits ${whereSql} ` +
            `ORDER BY started_at DESC LIMIT @_limit OFFSET @_offset`,
          )
          .all({ ...params, _limit: limit, _offset: offset }) as any[];

        return {
          nodes: rows.map(rowToAuditCore),
          totalCount,
          warnings,
        };
      },

      audit: (_parent: unknown, args: any) => {
        const row = db
          .prepare(
            "SELECT * FROM audits WHERE negotiation_id = @negotiationId AND perspective = @perspective",
          )
          .get({
            negotiationId: args.negotiationId,
            perspective:   args.perspective,
          });
        return row ? rowToAuditCore(row) : null;
      },
    },

    Audit: auditFieldResolvers,
  };
}
