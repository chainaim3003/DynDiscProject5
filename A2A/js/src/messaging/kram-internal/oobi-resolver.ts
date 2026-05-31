// ================= KRAM VERFER RESOLVER (A.6, live key resolution) =================
// Rotation-aware resolution of a counterparty AID -> signify-ts Verfer, backed
// by a LIVE KERIA (oobis().resolve + keyStates().query + keyStates().get).
//
// WHY THIS REPLACES THE STATIC verferByAid SNAPSHOT (locked decision D1):
// A.5 built each counterparty Verfer once, from the pipeline-produced
// <name>-info.json state.k[0]. That is a frozen snapshot: if the counterparty
// rotates its keys, the snapshot verifies stale signatures and rejects valid
// ones. A.6 resolves the CURRENT key state from KERIA at verify time, so the
// buyer/seller (and the A.6 server) always check against live keys.
//
// USED BY BOTH transports (one behaviour, two language ports):
//   - DD KramSigner.verify()            (this .ts)
//   - api-server kram-verify-middleware (the .js port: lib/kram-internal/oobi-resolver.js)
//
// GROUNDING (every KERIA call below was read from real code, not memory):
//   - oobis().resolve(oobi, alias) -> long-running Operation
//       legentvLEI/sig-wallet/src/client/oobis.ts (resolveOobi)
//   - operations().wait(op,{signal}) polling + delete
//       legentvLEI/sig-wallet/src/client/operations.ts (waitOperation)
//   - keyStates().query(pre, sn?, anchor?) -> POST /queries -> Operation,
//     keyStates().get(pre) -> GET /states?pre= -> ARRAY of key-state records
//       signify-ts@0.3.0-rc2 dist/keri/app/coring.{d.ts,js} (KeyStates)
//   - Verfer({qb64}) over state.k[0]
//       DD KramSigner.init() (the snapshot path this supersedes)
//
// OOBI HOST REMAP: task-data <name>-info.json carries a docker-internal OOBI
// (http://keria:3902/oobi/<aid>/agent/<aid>) that does NOT resolve from WSL/host.
// We swap ONLY scheme+host with an env-provided host-reachable base
// (KERIA_OOBI_BASE, e.g. http://localhost:3902); the /oobi/... path is kept
// verbatim. No "keria" hostname is hardcoded -- whatever host is present is
// replaced by the configured base.
//
// CONSTRAINTS HONORED: no mocks; oobiBase + timeouts come from env/options and
// throw if missing; no silent fallback.

import { Verfer } from "signify-ts";
import type { SignifyClient } from "signify-ts";

export interface VerferResolverOptions {
  /**
   * Host-reachable KERIA OOBI base (scheme+host[:port]) used to remap the
   * docker-internal OOBI host, e.g. "http://localhost:3902". Required.
   */
  oobiBase: string;
  /**
   * How long a resolved Verfer stays cached before we re-resolve from KERIA.
   * Bounds key-rotation staleness without re-querying on every verify.
   * Default 60_000ms.
   */
  keyStateTtlMs?: number;
  /** Per-operation wait timeout (resolve/query). Default 30_000ms. */
  opTimeoutMs?: number;
}

interface CacheEntry {
  verfer: Verfer;
  /** qb64 of the key the Verfer was built from (for logging/debug). */
  key: string;
  fetchedAt: number;
}

/** Minimal key-state record shape we depend on (state.k[0] is the current key). */
interface KeyStateRecord {
  k?: string[];
}

export class VerferResolver {
  private readonly client: SignifyClient;
  private readonly oobiBase: string;
  private readonly ttlMs: number;
  private readonly opTimeoutMs: number;
  /** aid -> cached Verfer entry. */
  private readonly cache = new Map<string, CacheEntry>();

  constructor(client: SignifyClient, options: VerferResolverOptions) {
    if (!client) {
      throw new Error("[kram-resolver] a connected SignifyClient is required.");
    }
    const base = options?.oobiBase?.trim();
    if (!base) {
      throw new Error(
        "[kram-resolver] oobiBase is required (host-reachable KERIA OOBI base, " +
          "e.g. http://localhost:3902). The docker OOBI host 'keria:3902' does " +
          "not resolve from WSL/host."
      );
    }
    // Validate eagerly so a bad base fails at construction, not mid-verify.
    try {
      // eslint-disable-next-line no-new
      new URL(base);
    } catch {
      throw new Error(`[kram-resolver] oobiBase is not a valid URL: ${base}`);
    }
    this.client = client;
    this.oobiBase = base;
    this.ttlMs = options.keyStateTtlMs ?? 60_000;
    this.opTimeoutMs = options.opTimeoutMs ?? 30_000;
  }

  /**
   * Swap ONLY scheme+host of a docker-internal OOBI with the configured
   * host-reachable base. Preserves the /oobi/<aid>/agent/<aid> path + query.
   */
  remapOobi(oobi: string): string {
    let u: URL;
    try {
      u = new URL(oobi);
    } catch {
      throw new Error(`[kram-resolver] counterparty OOBI is not a valid URL: ${oobi}`);
    }
    const b = new URL(this.oobiBase);
    u.protocol = b.protocol;
    u.host = b.host; // host includes hostname:port
    return u.toString();
  }

  /**
   * Resolve an AID to its CURRENT signing Verfer via live KERIA. Cached per AID
   * for keyStateTtlMs; pass forceRefresh to bypass the cache (e.g. after a
   * signature fails, to rule out a just-happened rotation).
   */
  async resolveVerfer(
    aid: string,
    oobi: string,
    opts: { forceRefresh?: boolean } = {}
  ): Promise<Verfer> {
    if (!aid) throw new Error("[kram-resolver] resolveVerfer called without an AID.");
    if (!oobi) throw new Error(`[kram-resolver] no OOBI provided for AID ${aid}.`);

    const cached = this.cache.get(aid);
    if (cached && !opts.forceRefresh && Date.now() - cached.fetchedAt < this.ttlMs) {
      return cached.verfer;
    }

    // 1) Make KERIA aware of the AID's endpoints (idempotent; updates contact).
    const remapped = this.remapOobi(oobi);
    const resolveOp = await this.client.oobis().resolve(remapped, aid);
    await this.waitOperation(resolveOp);

    // 2) Refresh key state from the AID's witnesses -> rotation-aware.
    const queryOp = await this.client.keyStates().query(aid);
    await this.waitOperation(queryOp);

    // 3) Read the now-current key state. GET /states?pre= returns an ARRAY.
    const states = await this.client.keyStates().get(aid);
    const record: KeyStateRecord | undefined = Array.isArray(states)
      ? states[0]
      : states;
    const key = record?.k?.[0];
    if (!key) {
      throw new Error(
        `[kram-resolver] no current signing key (state.k[0]) for AID ${aid} ` +
          `after query. Is the AID known to this KERIA?`
      );
    }

    const verfer = new Verfer({ qb64: key });
    this.cache.set(aid, { verfer, key, fetchedAt: Date.now() });
    return verfer;
  }

  /** Drop a cached entry (e.g. on a verify failure, before a forced refresh). */
  invalidate(aid: string): void {
    this.cache.delete(aid);
  }

  // ── Internals ─────────────────────────────────────────────────────────────
  // Mirror of sig-wallet operations.ts#waitOperation: poll to done with a
  // bounded AbortSignal, then best-effort delete the completed operation.
  private async waitOperation<T = unknown>(op: T): Promise<T> {
    const completed = await this.client
      .operations()
      .wait(op as never, { signal: AbortSignal.timeout(this.opTimeoutMs) });
    const name = (completed as { name?: string })?.name;
    if (name) {
      try {
        await this.client.operations().delete(name);
      } catch {
        // Non-fatal: the wait already gave us a completed op.
      }
    }
    return completed as T;
  }
}
