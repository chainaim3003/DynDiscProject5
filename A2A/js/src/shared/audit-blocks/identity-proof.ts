// ================= AUDIT FRAMEWORK V6 — IDENTITY PROOF BLOCK =================
// Iter 2. Mirrors what the GLEIF UI shows for each agent so a regulator
// reviewing the audit JSON sees the same identity fields they would see in
// the GLEIF lookup tool: LEI status, legal entity name, country, the honest
// verification path actually walked, and the honest list of checks performed.
//
// Sources of data:
//   - own side:          CredentialProvider.loadOwnIdentity() result
//                        (called once at agent startup; cached on the agent)
//   - counterparty side: CredentialProvider.verifyCounterparty() result
//                        (called once per negotiation, before the deal)
//
// The block captures a SNAPSHOT at deal close. Re-running GLEIF later may
// yield different status; the audit is "what was true at the time we acted
// on this counterparty."
//
// Acceptance test T1 (per AUDIT-FRAMEWORK-V6-ITERATION-PLAN.md Part 3):
//   "Open any audit → identityProof block mirrors what GLEIF UI shows for
//    that agent." The fields here are the ones GLEIF UI surfaces.

import type {
  AgentIdentity,
  VerificationResult,
  CredentialMode,
} from "../../identity/CredentialProvider.js";

/** One side's identity snapshot. Keys mirror GLEIF UI as closely as possible. */
export interface IdentityProofSide {
  /** Which credential provider mode produced these values. */
  credentialMode: CredentialMode;

  // ── GLEIF UI-visible fields ──────────────────────────────────────────────
  agentName:               string;
  legalEntityName:         string;
  lei:                     string;
  /** GLEIF registration status (ISSUED / LAPSED / RETIRED / etc.). */
  registrationStatus:      string | undefined;
  /** GLEIF entity status (ACTIVE / INACTIVE / etc.). */
  entityStatus:            string | undefined;
  country:                 string | undefined;
  countryName:             string | undefined;
  legalForm:               string | undefined;
  initialRegistrationDate: string | undefined;
  lastUpdateDate:          string | undefined;
  nextRenewalDate:         string | undefined;

  // ── KERI identifier fields ───────────────────────────────────────────────
  // Present in agent card metadata in both modes; cryptographically VERIFIED
  // only in vlei mode. Plain mode includes them for display but the
  // verificationPath text explicitly notes the lack of cryptographic check.
  oorOfficer:     string;
  agentAID:       string;
  oorHolderAID:   string;
  legalEntityAID: string;
  qviAID:         string;
  publicKey:      string | undefined;

  // ── Honest verification record ───────────────────────────────────────────
  /**
   * Ordered list of identity hops walked. In plain mode ends with explicit
   * "(NOT cryptographically delegated — plain mode)" suffix produced by
   * PlainJsonProvider. In vlei mode this is the full GLEIF_ROOT → QVI → LE
   * → OOR → agent chain.
   */
  verificationPath: string[];

  // ── GLEIF lookup provenance ──────────────────────────────────────────────
  /** Where the GLEIF data came from: live API call or cache. */
  gleifSource:          string | undefined;
  /** When GLEIF was last consulted for this LEI. ISO 8601. */
  gleifFetchedAt:       string | undefined;
  /**
   * sha256 of GLEIF's raw response. Allows future reproducibility check —
   * re-fetch GLEIF for the same LEI and compare hashes.
   */
  gleifRawResponseHash: string | undefined;
}

/** Counterparty side carries additional verification metadata. */
export interface CounterpartyIdentityProof extends IdentityProofSide {
  /** Overall verified=true|false result from CredentialProvider. */
  verified:        boolean;
  /** Honest list of checks the provider actually performed. */
  checksPerformed: string[];
  /** Soft warnings from GLEIF + provider. */
  warnings:        string[];
  /** Hard errors from GLEIF + provider. */
  errors:          string[];
  /** When the counterparty verification ran. ISO 8601. */
  verifiedAt:      string;
}

/** Full identityProof audit block — self side + counterparty side. */
export interface IdentityProofBlock {
  /** Schema version. Bumped on breaking changes. */
  schemaVersion: 1;
  self:          IdentityProofSide;
  counterparty:  CounterpartyIdentityProof;
}

/**
 * Build the `identityProof` block from CredentialProvider artifacts.
 *
 * @param ownIdentity   What `loadOwnIdentity()` returned at agent startup.
 * @param verification  What `verifyCounterparty()` returned for this deal.
 *                      (The counterparty's identity lives inside its
 *                      `.counterparty` field.)
 */
export function buildIdentityProofBlock(
  ownIdentity:  AgentIdentity,
  verification: VerificationResult,
): IdentityProofBlock {
  return {
    schemaVersion: 1,
    self:          identityToSide(ownIdentity, verification.mode),
    counterparty: {
      ...identityToSide(verification.counterparty, verification.mode),
      verified:        verification.verified,
      checksPerformed: verification.checksPerformed,
      warnings:        verification.warnings,
      errors:          verification.errors,
      verifiedAt:      verification.verifiedAt,
    },
  };
}

function identityToSide(id: AgentIdentity, mode: CredentialMode): IdentityProofSide {
  const g = id.gleifRecord;
  return {
    credentialMode:          mode,
    agentName:               id.agentName,
    legalEntityName:         id.legalEntityName,
    lei:                     id.lei,
    registrationStatus:      g?.registrationStatus,
    entityStatus:            g?.entityStatus,
    country:                 g?.country,
    countryName:             g?.countryName,
    legalForm:               g?.legalForm,
    initialRegistrationDate: g?.initialRegistrationDate,
    lastUpdateDate:          g?.lastUpdateDate,
    nextRenewalDate:         g?.nextRenewalDate,
    oorOfficer:              id.oorOfficer,
    agentAID:                id.agentAID,
    oorHolderAID:            id.oorHolderAID,
    legalEntityAID:          id.legalEntityAID,
    qviAID:                  id.qviAID,
    publicKey:               id.publicKey,
    verificationPath:        id.verificationPath,
    gleifSource:             g?.source,
    gleifFetchedAt:          g?.fetchedAt,
    gleifRawResponseHash:    g?.rawResponseHash,
  };
}
