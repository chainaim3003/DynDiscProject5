// ============================ GRAPHQL SCHEMA ============================
// Audit Framework v6 — Iter 6: read-only SDL for the audit query server.
//
// Contract per DECISIONS.md iter-6 addendum:
//   - Item 5: read-only, no Mutation type, localhost-bound.
//   - Item 6: split resolvers — 28 scalar fields from SQLite, 14 nested
//             fields read on-demand from the per-deal audit JSON files.
//   - Item 7: offset pagination, default 50, max 500 (server-clamped),
//             warnings[] field on AuditConnection signals clamp.
//
// All 28 scalar fields mirror `AuditIndexLine` (audit-index-schema.ts) and
// the SQLite `audits` table; the 14 nested fields are returned as `JSON`
// (custom scalar — arbitrary value passthrough).
// ============================================================================

export const typeDefs = /* GraphQL */ `
  scalar JSON

  enum Outcome {
    success
    escalation
  }

  enum CredentialMode {
    plain
    vlei
  }

  enum Perspective {
    BUYER
    SELLER
  }

  type Audit {
    # ── 28 SQLite-backed scalars (mirror AuditIndexLine) ──────────────────
    schemaVersion: Int!
    negotiationId: String!
    perspective: Perspective!
    auditFile: String!

    startedAt: String!
    generatedAt: String!

    outcome: Outcome!
    finalPrice: Float
    quantity: Int!
    totalDealValue: Float
    currency: String!

    roundsUsed: Int!
    maxRounds: Int!

    selfLei: String
    selfEntityName: String
    counterpartyLei: String
    counterpartyEntityName: String

    credentialMode: CredentialMode!
    selfProcessMode: String
    sellerLiveMode: String

    closed: Boolean!
    buyerMax: Float
    sellerMin: Float
    zopaFeasible: Boolean
    outsideZopa: Boolean

    decisionCount: Int!

    treasuryOverrideApplied: Boolean
    treasuryFinalNPV: Float

    # ── 14 JSON-on-demand nested fields ───────────────────────────────────
    # Read lazily from the per-deal audit JSON at auditFile when requested.
    # Returns null if the file is missing or the field is absent.
    decisions: JSON
    thinkCycleTrace: JSON
    delegationChain: JSON
    messageLog: JSON
    intent: JSON
    autonomy: JSON
    identityProof: JSON
    messageSigningPosture: JSON
    agentSelf: JSON
    agentCounterparty: JSON
    frameworkMetrics: JSON
    selfCheck: JSON
    compliance: JSON
    outcomeQuality: JSON
  }

  type AuditConnection {
    nodes: [Audit!]!
    totalCount: Int!
    warnings: [String!]!
  }

  type Query {
    """
    List audits with optional filters + offset pagination.
    Per DECISIONS.md Item 7: default limit 50, max 500 (clamped server-side
    with warnings: ["limit_clamped"]). Negative limit or offset → error.
    Ordered by started_at DESC (newest first).
    """
    audits(
      outcome: Outcome
      credentialMode: CredentialMode
      perspective: Perspective
      closed: Boolean
      negotiationId: String
      startedAfter: String
      startedBefore: String
      limit: Int = 50
      offset: Int = 0
    ): AuditConnection!

    """Single audit by (negotiationId, perspective). Returns null if not found."""
    audit(negotiationId: String!, perspective: Perspective!): Audit
  }
`;
