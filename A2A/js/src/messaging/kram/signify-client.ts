// ================= KRAM SIGNIFY CLIENT BOOTSTRAP =================
// DD-local helper to obtain a connected signify-ts SignifyClient.
//
// Mirrors the PROVEN connect/boot/connect pattern from the vLEI sig-wallet
// (legentvLEI/sig-wallet/src/client/identifiers.ts) so DD talks to the SAME
// KERIA the agent AIDs were minted against. It is a DD-LOCAL copy on purpose:
// sig-wallet is a separate package (no workspace link), so importing it here
// would break module resolution. signify-ts is pinned to the SAME version as
// sig-wallet (0.3.0-rc2) in package.json to avoid client/identity skew.
//
// Constraints honored:
//   - No hardcoded URLs. adminUrl/bootUrl come from env.
//   - No silent fallback. Missing env -> throw at call time (startup).
//   - No mocks in shipped code.
//
// NOTE on URLs: the vLEI docker preset uses docker-internal hostnames
// (http://keria:3901 / :3903) which do NOT resolve from WSL/host. DD runs
// outside the compose network, so it must be given host-reachable values via
// KERIA_ADMIN_URL / KERIA_BOOT_URL (e.g. the host-mapped ports).

import { ready, SignifyClient, Tier } from "signify-ts";

export interface KeriaEndpoints {
  /** KERIA admin interface URL (signify-ts `url`). */
  adminUrl: string;
  /** KERIA boot interface URL (signify-ts `bootUrl`). */
  bootUrl: string;
}

/**
 * Resolve KERIA endpoints from the environment.
 * Throws (no fallback) if either is unset — the caller must configure these
 * for DD's runtime, since the vLEI docker hostnames are not reachable here.
 */
export function resolveKeriaEndpoints(): KeriaEndpoints {
  const adminUrl = process.env.KERIA_ADMIN_URL?.trim();
  const bootUrl = process.env.KERIA_BOOT_URL?.trim();

  if (!adminUrl) {
    throw new Error(
      "[kram] KERIA_ADMIN_URL is not set. Set it to DD's host-reachable KERIA " +
        "admin URL (e.g. http://localhost:3901). The vLEI docker hostname " +
        "'http://keria:3901' does NOT resolve from WSL/host."
    );
  }
  if (!bootUrl) {
    throw new Error(
      "[kram] KERIA_BOOT_URL is not set. Set it to DD's host-reachable KERIA " +
        "boot URL (e.g. http://localhost:3903). The vLEI docker hostname " +
        "'http://keria:3903' does NOT resolve from WSL/host."
    );
  }
  return { adminUrl, bootUrl };
}

/**
 * Connect (or boot then connect) a SignifyClient for the given BRAN.
 *
 * @param bran       21-char KERI passcode/seed material for this agent's
 *                   client AID. Required — throws if empty.
 * @param endpoints  Optional explicit endpoints; defaults to env resolution.
 */
export async function getOrCreateClient(
  bran: string,
  endpoints?: KeriaEndpoints
): Promise<SignifyClient> {
  if (!bran || bran.trim().length === 0) {
    throw new Error("[kram] getOrCreateClient called without a BRAN.");
  }

  const { adminUrl, bootUrl } = endpoints ?? resolveKeriaEndpoints();

  // libsodium WASM must be initialized before any signing/keying calls.
  await ready();

  // signify-ts expects a 21-char passcode. Pad defensively (matches sig-wallet).
  const passcode = bran.trim().padEnd(21, "_");

  const client = new SignifyClient(adminUrl, passcode, Tier.low, bootUrl);

  // Connect to an existing agent; if none exists yet, boot one then connect.
  try {
    await client.connect();
  } catch {
    const res = await client.boot();
    if (!res.ok) {
      throw new Error(
        `[kram] KERIA boot failed: ${res.status} ${res.statusText} ` +
          `(adminUrl=${adminUrl}, bootUrl=${bootUrl})`
      );
    }
    await client.connect();
  }

  return client;
}
