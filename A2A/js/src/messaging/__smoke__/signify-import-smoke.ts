// ================= SIGNIFY-TS IMPORT / CONNECT SMOKE (A.4.4) =================
// Verifies the signify-ts wiring end-to-end against a live KERIA BEFORE any
// KRAM signing logic exists. Run by the human (Docker/KERIA/Node stack).
//
// What it checks, in order:
//   1. ready() — libsodium WASM initializes.
//   2. API surface — the exports KRAM will rely on are present.
//   3. BRAN — read from AGENT_BRAN_PATH (throws if missing/empty).
//   4. Client — getOrCreateClient connects (or boots+connects) to KERIA.
//   5. Expected AID — read DYNAMICALLY from AGENT_INFO_PATH (the *-info.json).
//      NEVER hardcoded: BRANs/AIDs regenerate every pipeline run.
//   6. AID lookup — identifiers().get(prefix) resolves and matches.
//   7. Signing API — locate the Signer/sign entrypoint (manager.sign + the
//      low-level Signer.sign/Verfer.verify). Does NOT sign — that is A.5.
//
// Required env:
//   AGENT_BRAN_PATH   path to this agent's BRAN (.secret/agent-bran.txt)
//   AGENT_INFO_PATH   path to this agent's <name>-info.json (has .aid + .state.k)
//   KERIA_ADMIN_URL   host-reachable KERIA admin URL (e.g. http://localhost:3901)
//   KERIA_BOOT_URL    host-reachable KERIA boot  URL (e.g. http://localhost:3903)
//
// Run (example):
//   AGENT_BRAN_PATH=src/agents/buyer-agent/.secret/agent-bran.txt \
//   AGENT_INFO_PATH=/mnt/c/.../legentvLEI/task-data/tommyBuyerAgent-info.json \
//   KERIA_ADMIN_URL=http://localhost:3901 KERIA_BOOT_URL=http://localhost:3903 \
//   npx tsx src/messaging/__smoke__/signify-import-smoke.ts

import fs from "node:fs";

import * as signify from "signify-ts";
import { Signer, Cigar, Verfer, ready, randomPasscode, Tier } from "signify-ts";

import { getOrCreateClient } from "../kram/signify-client.js";

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`[smoke] ${name} is not set`);
  return v;
}

function readBran(path: string): string {
  if (!fs.existsSync(path)) throw new Error(`[smoke] BRAN file not found: ${path}`);
  const bran = fs.readFileSync(path, "utf8").trim();
  if (!bran) throw new Error(`[smoke] BRAN file is empty: ${path}`);
  return bran;
}

interface AgentInfo {
  aid: string;
  state?: { k?: string[] };
}

function readExpectedAid(path: string): AgentInfo {
  if (!fs.existsSync(path)) throw new Error(`[smoke] AID info file not found: ${path}`);
  const info = JSON.parse(fs.readFileSync(path, "utf8")) as AgentInfo;
  if (!info.aid) throw new Error(`[smoke] ${path} has no "aid" field`);
  return info;
}

async function main(): Promise<void> {
  const branPath = requireEnv("AGENT_BRAN_PATH");
  const infoPath = requireEnv("AGENT_INFO_PATH");

  // 1. WASM init
  await ready();
  console.log("[smoke] ✓ ready() — libsodium WASM initialized");

  // 2. API surface
  console.log("[smoke] API surface:", {
    SignifyClient: typeof signify.SignifyClient,
    Signer: typeof Signer,
    Cigar: typeof Cigar,
    Verfer: typeof Verfer,
    randomPasscode: typeof randomPasscode,
    Tier: typeof Tier,
    signMethodOnSignerProto: typeof Signer.prototype.sign,
    verifyMethodOnVerferProto: typeof Verfer.prototype.verify,
  });

  // 3. BRAN
  const bran = readBran(branPath);
  console.log(`[smoke] ✓ BRAN read from ${branPath} (${bran.length} chars)`);

  // 4. Client connect
  const client = await getOrCreateClient(bran);
  console.log("[smoke] ✓ connected:", {
    agent: client.agent?.pre,
    controller: client.controller.pre,
  });

  // 5. Expected AID — dynamic, never hardcoded
  const info = readExpectedAid(infoPath);
  console.log(`[smoke] expected AID (from ${infoPath}): ${info.aid}`);
  if (info.state?.k?.length) {
    console.log(`[smoke] expected signing key(s) state.k: ${info.state.k.join(", ")}`);
  }

  // 6. AID lookup by prefix
  const hab = await client.identifiers().get(info.aid);
  const resolvedPre = (hab as { prefix?: string }).prefix ?? (hab as { i?: string }).i;
  console.log("[smoke] identifiers().get() resolved prefix:", resolvedPre);
  if (resolvedPre !== info.aid) {
    throw new Error(
      `[smoke] AID mismatch: client resolved ${resolvedPre} but info file expects ${info.aid}`
    );
  }
  console.log("[smoke] ✓ resolved AID matches expected");

  // 7. Locate the signing API (do NOT sign — that is A.5)
  if (!client.manager) {
    throw new Error("[smoke] client.manager is null — cannot locate signing API");
  }
  const km = client.manager.get(hab);
  console.log("[smoke] signing API located:", {
    managerSign: typeof km.sign, // async manager.sign(ser, indexed?, ...)
    signers: Array.isArray(km.signers) ? km.signers.length : "n/a",
    lowLevel: "Signer.sign(ser)->Cigar | Verfer.verify(sig,ser)->boolean",
  });

  console.log("[smoke] ✓ ALL CHECKS PASSED — signify-ts wiring is sound (no signing performed)");
}

main().catch((err) => {
  console.error("[smoke] ✗ FAILED:", err);
  process.exit(1);
});
