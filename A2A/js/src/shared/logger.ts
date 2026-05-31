// ================= ROLE-AWARE NEGOTIATION LOGGER =================

import fs   from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { NegotiationLog, AgentRole, NegotiationAction } from "./negotiation-types.js";
import { computeOutcomeQuality, OutcomeQuality, QualityInputs } from "./outcome-quality.js";

// WEDGE1 / M1 — seller-response-mode framework. The saveAuditJson method
// below calls buildSellerResponseModeBlock() at deal-close time so every
// audit carries an unambiguous record of the mode under which the deal
// ran. The function is lazy (reads env on each call) so it picks up
// dotenv-loaded vars.
import { buildSellerResponseModeBlock } from "./negotiation-mode.js";

// ============================================================================
// Audit Framework v6 — Iteration 1 imports.
// All audit-related file paths now flow through shared/audit-paths.ts.
// Index.jsonl appending happens after each saveAuditJson write.
// ============================================================================
import { getDealFolder, getAuditsRoot } from "./audit-paths.js";
import { appendAuditIndexLine } from "./index-jsonl-writer.js";
import type { AuditIndexLine } from "./audit-index-schema.js";

// ============================================================================
// Audit Framework v6 — Iteration 2 imports.
// Identity proof + message-signing posture + per-deal message log.
// Each block has its own builder under shared/audit-blocks/ or a dedicated
// collector module under shared/; this file is the single integration point.
// ============================================================================
import type { AgentIdentity, VerificationResult } from "../identity/CredentialProvider.js";
import type { SigningMode } from "../messaging/signed-message.js";
import {
    buildIdentityProofBlock,
    type IdentityProofBlock,
} from "./audit-blocks/identity-proof.js";
import {
    buildMessageSigningPostureBlock,
    type MessageSigningPostureBlock,
    type MessageSigningTier,
} from "./audit-blocks/message-signing-posture.js";
import {
    getMessageLogCollector,
    type MessageLogEntry,
} from "./message-log-collector.js";

// ============================================================================
// Audit Framework v6 — Iteration 3 imports.
// Intent block + autonomy block. Pattern follows iter-2: callers pass
// rich raw inputs, this file invokes the audit-block builders and spreads
// the results into `auditDoc`.
// ============================================================================
import type {
    BuyerIntent,
    SellerIntent,
    Situation,
    ScenarioIntentExcerpt,
} from "./intent-types.js";
import type { CommitGateEvent } from "./negotiation-types.js";
import {
    buildIntentBlock,
    type IntentBlock,
    type ActualOutcomeFacts,
} from "./audit-blocks/intent-block.js";
import {
    buildAutonomyBlock,
    type AutonomyBlock,
    type HumanOversightPosition,
} from "./audit-blocks/autonomy-block.js";

// ============================================================================
// Audit Framework v6 — Iteration 4 imports.
// thinkCycleTrace[] + delegationChain[] builders. Both blocks are seller-only
// per DECISIONS Item 1 / Item 4 (the structures don't exist on the buyer).
// In BASIC/L1 modes, the per-round inputs are partial per Q-iter4-A option (b)
// — the builders handle the partial-ness natively (omit steps whose inputs
// are absent; emit only treasury-consultation in delegationChain).
// Backward-compat: when neither thinkCycleRounds nor delegationSteps is
// passed, neither block is emitted (iter-3 and earlier callers untouched).
// ============================================================================
import {
    buildThinkCycleTrace,
    type ThinkCycleRoundInputs,
    type ThinkCycleTraceBlock,
} from "./audit-blocks/think-cycle-trace.js";
import {
    buildDelegationChain,
    type DelegationStepInputs,
    type DelegationChainBlock,
} from "./audit-blocks/delegation-chain.js";

// ============================================================================
// Audit Framework v6 — Iteration 5 imports.
// frameworkMetrics + selfCheck + compliance blocks. All three scoped "both"
// per DECISIONS iter-5 addendum Item 5. The block builders are pure functions
// over typed inputs; we extract those inputs from the already-assembled
// auditDoc just before serialization (Item 6 "deferred to code-edit phase"),
// so the agents themselves need ZERO changes for selfCheck + compliance.
//
// Only frameworkMetrics requires a new caller-side hook: on the BUYER side,
// LLM-cost telemetry has no thinkCycleTrace to walk, so the buyer agent
// must accumulate a per-negotiation llmAuditRecords[] and pass it in via
// the new optional saveAuditJson() param (wired in Step B).
// ============================================================================
import { createHash } from "node:crypto";
import {
    buildFrameworkMetrics,
    aggregateSellerCostFromThinkCycleTrace,
    aggregateCostFromLlmCallRecords,
    aggregateRiskAvoidedFromCommitGate,
    extractOutcomeMetrics,
    type FrameworkMetricsBlock,
    type FrameworkMetricsCost,
} from "./audit-blocks/framework-metrics.js";
import {
    buildSelfCheck,
    checkIdentityVerified,
    checkMessageIntegrityIntact,
    checkIntentDeclaredAndTracked,
    checkReasoningAuditable,
    checkDelegationAttested,
    type SelfCheckBlock,
} from "./audit-blocks/self-check.js";
import {
    buildCompliance,
    type ComplianceBlock,
} from "./audit-blocks/compliance.js";
import { computeDelegationSignatureValue } from "./audit-blocks/delegation-chain.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ANSI color codes
const C = {
    reset:    "\x1b[0m",
    bold:     "\x1b[1m",
    dim:      "\x1b[2m",
    red:      "\x1b[31m",
    green:    "\x1b[32m",
    yellow:   "\x1b[33m",
    blue:     "\x1b[34m",
    magenta:  "\x1b[35m",
    cyan:     "\x1b[36m",
    white:    "\x1b[37m",
    bgRed:    "\x1b[41m",
    bgGreen:  "\x1b[42m",
    bgBlue:   "\x1b[44m",
    bgYellow: "\x1b[43m",
};

// ─── Width constant for all boxes ────────────────────────────────────────────
const W = 58;

function hline(char = "─") { return char.repeat(W); }

// ── Suppress @a2a-js/sdk internal stdout noise ───────────────────────────────
const SDK_NOISE_PATTERNS = [
    "ResultManager:",
    "Error reading or parsing SSE stream:",
];

export function suppressSDKNoise(): void {
    const originalWrite = process.stdout.write.bind(process.stdout);

    (process.stdout.write as any) = function (
        chunk: any,
        encodingOrCallback?: any,
        callback?: any
    ): boolean {
        const text = typeof chunk === "string" ? chunk : chunk?.toString?.() ?? "";
        const isNoise = SDK_NOISE_PATTERNS.some((pattern) => text.includes(pattern));
        if (isNoise) {
            if (typeof encodingOrCallback === "function") encodingOrCallback();
            else if (typeof callback === "function") callback();
            return true;
        }
        return originalWrite(chunk, encodingOrCallback, callback);
    };
}

// ── Subtle internal-log helper — dimmed, no box ───────────────────────────────
export function logInternal(msg: string) {
    console.log(`${C.dim}  ⋯ ${msg}${C.reset}`);
}

export class NegotiationLogger {
    private logs: NegotiationLog[] = [];
    private negotiationId: string;
    private startTime: Date;
    private myRole: AgentRole;

    // Running price trail for the summary table
    private priceTrail: { round: number; buyer?: number; seller?: number }[] = [];

    constructor(negotiationId: string, myRole: AgentRole) {
        this.negotiationId = negotiationId;
        this.startTime     = new Date();
        this.myRole        = myRole;
    }

    // ── Public log entry point ────────────────────────────────────────────────
    log(entry: Omit<NegotiationLog, "timestamp" | "negotiationId">) {
        const logEntry: NegotiationLog = {
            ...entry,
            timestamp:     new Date().toISOString(),
            negotiationId: this.negotiationId,
        };
        this.logs.push(logEntry);
        this.printLog(logEntry);
    }

    // ── Core log printer ──────────────────────────────────────────────────────
    private printLog(log: NegotiationLog) {
        const isMine = log.from === this.myRole;

        const isEchoAccept =
            log.decision === "ACCEPT" &&
            log.reasoning?.toLowerCase().includes("bilateral");
        if (isEchoAccept) {
            logInternal(`Bilateral acceptance confirmed at ₹${log.offeredPrice}`);
            return;
        }

        let headerBg:   string;
        let headerText: string;
        let priceColor: string;

        switch (log.decision) {
            case "ACCEPT":
                headerBg   = C.bgGreen + C.bold + C.white;
                headerText = isMine ? "✓  ACCEPTED  ── sent to counterpart" : "✓  ACCEPTED  ── received";
                priceColor = C.green + C.bold;
                break;
            case "REJECT":
                headerBg   = C.bgRed + C.bold + C.white;
                headerText = isMine ? "✗  REJECTED  ── sent" : "✗  REJECTED  ── received";
                priceColor = C.red + C.bold;
                break;
            case "OFFER":
                headerBg   = C.bgBlue + C.bold + C.white;
                headerText = isMine ? "▶  INITIAL OFFER  ── sent to seller" : "▶  INITIAL OFFER  ── received from buyer";
                priceColor = C.cyan + C.bold;
                break;
            default:
                if (isMine) {
                    headerBg   = C.cyan  + C.bold;
                    headerText = "↑  COUNTER-OFFER  ── sent";
                    priceColor = C.cyan  + C.bold;
                } else {
                    headerBg   = C.yellow + C.bold;
                    headerText = "↓  COUNTER-OFFER  ── received";
                    priceColor = C.yellow + C.bold;
                }
                break;
        }

        console.log("");
        console.log(`  ${headerBg}  ${headerText.padEnd(W - 2)}  ${C.reset}`);

        if (log.offeredPrice !== undefined) {
            console.log(`  ${priceColor}    ₹${log.offeredPrice} / unit${C.reset}`);
        }

        if (log.previousPrice !== undefined && log.priceMovement !== undefined) {
            const arrow    = log.priceMovement >= 0 ? "▲" : "▼";
            const sign     = log.priceMovement >= 0 ? "+" : "";
            const movColor = log.priceMovement >= 0 ? C.green : C.red;
            const pct      = log.priceMovementPercent?.toFixed(1) ?? "0.0";
            console.log(
                `  ${C.dim}    was ₹${log.previousPrice}  ${C.reset}${movColor}${arrow} ${sign}₹${Math.abs(log.priceMovement)} (${sign}${pct}%)${C.reset}`
            );
        }

        if (log.gap !== undefined && log.gap > 0) {
            console.log(`  ${C.dim}    gap left : ₹${log.gap}${C.reset}`);
        }

        if (log.reasoning) {
            console.log(`  ${C.dim}    reason   : ${log.reasoning}${C.reset}`);
        }

        this.updatePriceTrail(log);
    }

    // ── Track prices per round ────────────────────────────────────────────────
    private updatePriceTrail(log: NegotiationLog) {
        if (log.offeredPrice === undefined) return;
        let entry = this.priceTrail.find(e => e.round === log.round);
        if (!entry) {
            entry = { round: log.round };
            this.priceTrail.push(entry);
        }
        if (log.from === "BUYER") entry.buyer  = log.offeredPrice;
        else                      entry.seller = log.offeredPrice;
    }

    // ── Round header ──────────────────────────────────────────────────────────
    printRoundHeader(round: number, maxRounds: number) {
        const isFinal = round === maxRounds;
        const label   = isFinal
            ? `  ROUND ${round} / ${maxRounds}  ◀  FINAL ROUND`
            : `  ROUND ${round} / ${maxRounds}`;
        const color   = isFinal ? C.magenta + C.bold : C.bold;
        console.log("");
        console.log(`${C.dim}  ${hline()}${C.reset}`);
        console.log(`${color}${label}${C.reset}`);
        console.log(`${C.dim}  ${hline()}${C.reset}`);
    }

    // ── Session header ────────────────────────────────────────────────────────
    printSessionHeader(_contextId: string) {
        const roleEmoji = this.myRole === "BUYER" ? "🛒" : "🏪";
        const roleName  = this.myRole === "BUYER" ? "BUYER AGENT" : "SELLER AGENT";

        console.log("");
        console.log(`${C.bold}  ╔${"═".repeat(W)}╗${C.reset}`);
        console.log(`${C.bold}  ║  ${roleEmoji}  ${roleName.padEnd(W - 5)}║${C.reset}`);
        console.log(`${C.bold}  ║  Negotiation : ${this.negotiationId.padEnd(W - 16)}║${C.reset}`);
        console.log(`${C.bold}  ║  Started     : ${this.startTime.toLocaleTimeString().padEnd(W - 16)}║${C.reset}`);
        console.log(`${C.bold}  ╚${"═".repeat(W)}╝${C.reset}`);
    }

    // ── Price trail table ─────────────────────────────────────────────────────
    private printPriceTrail() {
        if (this.priceTrail.length === 0) return;

        const col      = { round: 8, buyer: 14, seller: 14, gap: 12 };
        const rowWidth = col.round + col.buyer + col.seller + col.gap;

        console.log("");
        console.log(`${C.dim}  ┌─ Price Trail ${"─".repeat(rowWidth - 1)}┐${C.reset}`);
        console.log(
            `${C.dim}  │  ${"Rnd".padEnd(col.round)}${"Buyer".padEnd(col.buyer)}` +
            `${"Seller".padEnd(col.seller)}${"Gap".padEnd(col.gap)}│${C.reset}`
        );
        console.log(`${C.dim}  │  ${"─".repeat(rowWidth)}│${C.reset}`);

        for (const e of this.priceTrail) {
            const b   = e.buyer  !== undefined ? `₹${e.buyer}`  : "—";
            const s   = e.seller !== undefined ? `₹${e.seller}` : "—";
            const gap = (e.buyer !== undefined && e.seller !== undefined)
                ? `₹${Math.abs(e.seller - e.buyer)}`
                : "—";
            console.log(
                `${C.dim}  │  ${String(e.round).padEnd(col.round)}${b.padEnd(col.buyer)}` +
                `${s.padEnd(col.seller)}${gap.padEnd(col.gap)}│${C.reset}`
            );
        }
        console.log(`${C.dim}  └${"─".repeat(rowWidth + 2)}┘${C.reset}`);
    }

    // ── Negotiation summary ───────────────────────────────────────────────────
    printNegotiationSummary(
        status: "COMPLETED" | "FAILED",
        details: {
            roundsUsed:        number;
            maxRounds:         number;
            finalPrice?:       number;
            buyerStartPrice?:  number;
            sellerStartPrice?: number;
            totalCost?:        number;
            totalRevenue?:     number;
            profitMargin?:     number;
            quantity:          number;
        }
    ) {
        this.printPriceTrail();

        const isOk     = status === "COMPLETED";
        const bgColor  = isOk ? C.bgGreen + C.bold + C.white : C.bgRed + C.bold + C.white;
        const headline = isOk ? "✅  DEAL CLOSED" : "❌  NO DEAL REACHED";

        console.log("");
        console.log(`  ${bgColor}  ${headline.padEnd(W - 2)}  ${C.reset}`);
        console.log(`${C.dim}  Rounds: ${details.roundsUsed} / ${details.maxRounds}${C.reset}`);

        if (isOk && details.finalPrice !== undefined) {
            console.log(`  ${C.green + C.bold}  Final Price  →  ₹${details.finalPrice} / unit${C.reset}`);
            console.log(`  ${C.bold}  Quantity     →  ${details.quantity.toLocaleString()} units${C.reset}`);

            const total = details.totalCost ?? details.totalRevenue;
            if (total) {
                console.log(`  ${C.bold}  Total Value  →  ₹${total.toLocaleString()}${C.reset}`);
            }
            if (details.buyerStartPrice !== undefined) {
                const c   = details.finalPrice - details.buyerStartPrice;
                const pct = ((c / details.buyerStartPrice) * 100).toFixed(1);
                console.log(`${C.dim}  Buyer   : ₹${details.buyerStartPrice} → ₹${details.finalPrice}  (conceded ₹${c}, ${pct}%)${C.reset}`);
            }
            if (details.sellerStartPrice !== undefined) {
                const c   = details.sellerStartPrice - details.finalPrice;
                const pct = ((c / details.sellerStartPrice) * 100).toFixed(1);
                console.log(`${C.dim}  Seller  : ₹${details.sellerStartPrice} → ₹${details.finalPrice}  (conceded ₹${c}, ${pct}%)${C.reset}`);
            }
            if (details.profitMargin !== undefined) {
                console.log(`${C.dim}  Seller profit: ₹${details.profitMargin} / unit${C.reset}`);
            }
        } else {
            console.log(`  ${C.red}  No agreement after ${details.roundsUsed} round(s).${C.reset}`);
        }
        console.log(`  ${C.dim}${"═".repeat(W)}${C.reset}`);
    }

    // ── Escalation terminal notice ────────────────────────────────────────────
    printEscalationNotice(
        buyerFinalOffer:  number,
        sellerFinalOffer: number,
        gap:              number,
        reportPath:       string
    ) {
        this.printPriceTrail();

        console.log("");
        console.log(`  ${C.bgYellow + C.bold + C.white}  ⚠  ESCALATED TO HUMAN${"".padEnd(W - 21)}  ${C.reset}`);
        console.log(`${C.dim}  Gap of ₹${gap} remains after ${this.priceTrail.length} round(s)${C.reset}`);
        console.log(`  ${C.yellow}  Buyer final offer  : ₹${buyerFinalOffer}${C.reset}`);
        console.log(`  ${C.yellow}  Seller final offer : ₹${sellerFinalOffer}${C.reset}`);
        console.log(`  ${C.bold}  Report saved → ${reportPath}${C.reset}`);
        console.log(`  ${C.dim}${"═".repeat(W)}${C.reset}`);
    }

    // ── Seller escalation received notice ─────────────────────────────────────
    printEscalationReceived(gap: number, reportPath: string) {
        console.log("");
        console.log(`  ${C.bgYellow + C.bold + C.white}  ⚠  ESCALATION NOTICE RECEIVED${"".padEnd(W - 29)}  ${C.reset}`);
        console.log(`${C.dim}  Buyer could not close ₹${gap} gap — human review requested${C.reset}`);
        console.log(`  ${C.bold}  Report → ${reportPath}${C.reset}`);
        console.log(`  ${C.dim}${"═".repeat(W)}${C.reset}`);
    }

    // ── Success report terminal notice ────────────────────────────────────────
    printSuccessNotice(finalPrice: number, totalValue: number, reportPath: string) {
        console.log("");
        console.log(`  ${C.bgGreen + C.bold + C.white}  ✅  SUCCESS REPORT SAVED — HUMAN OVERVIEW${"".padEnd(W - 41)}  ${C.reset}`);
        console.log(`  ${C.green}  Final Price : ₹${finalPrice}/unit  |  Total: ₹${totalValue.toLocaleString()}${C.reset}`);
        console.log(`  ${C.bold}  Report → ${reportPath}${C.reset}`);
        console.log(`  ${C.dim}${"═".repeat(W)}${C.reset}`);
    }

    // ── Write escalation report to disk ──────────────────────────────────────
    saveEscalationReport(params: {
        buyerFinalOffer:  number;
        sellerFinalOffer: number;
        gap:              number;
        rounds:           number;
        maxRounds:        number;
        quantity:         number;
        deliveryDate:     string;
        logs:             NegotiationLog[];
    }): string {
        // v6 Iter1: per-deal folder; mkdir handled inside getDealFolder().
        const escalationsDir = getDealFolder(this.negotiationId);

        const filePath = path.join(escalationsDir, `${this.negotiationId}_escalation_${this.myRole}.txt`);
        const now      = new Date();

        const lines: string[] = [];
        const hr = "─".repeat(60);

        lines.push("╔══════════════════════════════════════════════════════════════╗");
        lines.push("║           NEGOTIATION ESCALATION REPORT                     ║");
        lines.push("╚══════════════════════════════════════════════════════════════╝");
        lines.push("");
        lines.push(`Negotiation ID   : ${this.negotiationId}`);
        lines.push(`Date / Time      : ${now.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} ${now.toLocaleTimeString()}`);
        lines.push(`Status           : ESCALATED — No agreement reached after ${params.rounds} round(s)`);
        lines.push(`Quantity         : ${params.quantity.toLocaleString()} units`);
        lines.push(`Delivery Date    : ${params.deliveryDate}`);
        lines.push("");
        lines.push(hr);
        lines.push("PRICE TRAIL");
        lines.push(hr);
        lines.push(`${"Rnd".padEnd(8)}${"Buyer".padEnd(14)}${"Seller".padEnd(14)}${"Gap".padEnd(12)}`);
        lines.push("─".repeat(48));

        // Rebuild trail from logs
        const trail = new Map<number, { buyer?: number; seller?: number }>();
        for (const log of params.logs) {
            if (log.offeredPrice === undefined) continue;
            if (!trail.has(log.round)) trail.set(log.round, {});
            const entry = trail.get(log.round)!;
            if (log.from === "BUYER")  entry.buyer  = log.offeredPrice;
            if (log.from === "SELLER") entry.seller = log.offeredPrice;
        }
        for (const [round, e] of [...trail.entries()].sort((a, b) => a[0] - b[0])) {
            const b   = e.buyer  !== undefined ? `₹${e.buyer}`  : "—";
            const s   = e.seller !== undefined ? `₹${e.seller}` : "—";
            const gap = (e.buyer !== undefined && e.seller !== undefined)
                ? `₹${Math.abs(e.seller - e.buyer)}`
                : "—";
            lines.push(`${String(round).padEnd(8)}${b.padEnd(14)}${s.padEnd(14)}${gap.padEnd(12)}`);
        }

        lines.push("");
        lines.push(hr);
        lines.push("FINAL POSITIONS");
        lines.push(hr);
        lines.push(`Buyer's last offer  : ₹${params.buyerFinalOffer}`);
        lines.push(`Seller's last offer : ₹${params.sellerFinalOffer}`);
        lines.push(`Remaining gap       : ₹${params.gap}`);
        lines.push(`Gap as % of seller  : ${((params.gap / params.sellerFinalOffer) * 100).toFixed(1)}%`);

        lines.push("");
        lines.push(hr);
        lines.push("AGENT REASONING — FINAL ROUND");
        lines.push(hr);
        const finalRoundLogs = params.logs.filter(l => l.round === params.rounds);
        for (const log of finalRoundLogs) {
            if (log.reasoning) {
                lines.push(`${log.from.padEnd(8)}: ${log.reasoning}`);
            }
        }

        lines.push("");
        lines.push(hr);
        lines.push("HUMAN ACTION REQUIRED");
        lines.push(hr);
        lines.push("Please review the negotiation above and choose one of:");
        lines.push("");
        lines.push(`  A)  Accept SELLER price     →  ₹${params.sellerFinalOffer} / unit`);
        lines.push(`  B)  Accept BUYER price      →  ₹${params.buyerFinalOffer} / unit`);
        lines.push(`  C)  Split the difference    →  ₹${Math.round((params.buyerFinalOffer + params.sellerFinalOffer) / 2)} / unit`);
        lines.push(`  D)  Reject — do not proceed`);
        lines.push("");
        lines.push(hr);
        lines.push(`Generated : ${now.toISOString()}`);
        lines.push(hr);

        fs.writeFileSync(filePath, lines.join("\n"), "utf8");
        return filePath;
    }

    // ── Write SUCCESS report to disk (human overview of completed deal) ───────
    saveSuccessReport(params: {
        finalPrice:         number;
        quantity:           number;
        totalDealValue:     number;
        deliveryDate:       string;
        paymentTerms:       string;
        roundsUsed:         number;
        maxRounds:          number;
        logs:               NegotiationLog[];
        // Optional pricing origin context
        buyerStartPrice?:   number;
        sellerStartPrice?:  number;
        // Seller-only fields
        profitPerUnit?:     number;
        totalRevenue?:      number;
        marginPrice?:       number;
        // Treasury summary (seller-only, when treasury was consulted)
        treasury?: {
            consultedRounds:      number[];
            allApproved:          boolean;
            overrideApplied:      boolean;
            finalNPV?:            number;
            finalNetProfit?:      number;
            projectedMinBalance?: number;
            safetyThreshold?:     number;
            workingCapitalCost?:  number;
        };
    }): string {
        // v6 Iter1: per-deal folder; mkdir handled inside getDealFolder().
        const reportsDir = getDealFolder(this.negotiationId);

        const filePath = path.join(reportsDir, `${this.negotiationId}_success_${this.myRole}.txt`);
        const now      = new Date();
        const hr       = "─".repeat(60);
        const lines: string[] = [];

        lines.push("╔══════════════════════════════════════════════════════════════╗");
        lines.push("║       NEGOTIATION SUCCESS REPORT — HUMAN OVERVIEW            ║");
        lines.push("╚══════════════════════════════════════════════════════════════╝");
        lines.push("");
        lines.push(`Negotiation ID   : ${this.negotiationId}`);
        lines.push(`Date / Time      : ${now.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} ${now.toLocaleTimeString()}`);
        lines.push(`Outcome          : DEAL CLOSED — Agreement reached in ${params.roundsUsed} round(s) (max ${params.maxRounds})`);
        lines.push(`Perspective      : ${this.myRole}`);
        lines.push("");

        lines.push(hr);
        lines.push("AGREED DEAL TERMS");
        lines.push(hr);
        lines.push(`Agreed Price     : Rs.${params.finalPrice} / unit`);
        lines.push(`Quantity         : ${params.quantity.toLocaleString()} units`);
        lines.push(`Total Deal Value : Rs.${params.totalDealValue.toLocaleString()}`);
        lines.push(`Delivery Date    : ${params.deliveryDate}`);
        lines.push(`Payment Terms    : ${params.paymentTerms}`);
        lines.push("");

        if (params.profitPerUnit !== undefined || params.totalRevenue !== undefined) {
            lines.push(hr);
            lines.push("SELLER FINANCIALS (Jupiter Knitting Company)");
            lines.push(hr);
            if (params.profitPerUnit !== undefined) {
                lines.push(`Profit per unit  : Rs.${params.profitPerUnit}`);
                if (params.marginPrice !== undefined) {
                    const pct = ((params.profitPerUnit / params.marginPrice) * 100).toFixed(1);
                    lines.push(`Margin (%)       : ${pct}%  above cost floor Rs.${params.marginPrice}`);
                }
            }
            if (params.totalRevenue !== undefined) {
                lines.push(`Total Revenue    : Rs.${params.totalRevenue.toLocaleString()}`);
            }
            lines.push("");
        }

        lines.push(hr);
        lines.push("PRICE TRAIL");
        lines.push(hr);
        lines.push(`${"Rnd".padEnd(8)}${"Buyer".padEnd(14)}${"Seller".padEnd(14)}${"Gap".padEnd(12)}`);
        lines.push("─".repeat(48));

        const trail = new Map<number, { buyer?: number; seller?: number }>();
        for (const log of params.logs) {
            if (log.offeredPrice === undefined) continue;
            if (!trail.has(log.round)) trail.set(log.round, {});
            const entry = trail.get(log.round)!;
            if (log.from === "BUYER")  entry.buyer  = log.offeredPrice;
            if (log.from === "SELLER") entry.seller = log.offeredPrice;
        }
        for (const [round, e] of [...trail.entries()].sort((a, b) => a[0] - b[0])) {
            const b   = e.buyer  !== undefined ? `Rs.${e.buyer}`  : "—";
            const s   = e.seller !== undefined ? `Rs.${e.seller}` : "—";
            const gap = (e.buyer !== undefined && e.seller !== undefined)
                ? `Rs.${Math.abs(e.seller - e.buyer)}`
                : "—";
            lines.push(`${String(round).padEnd(8)}${b.padEnd(14)}${s.padEnd(14)}${gap.padEnd(12)}`);
        }

        if (params.buyerStartPrice !== undefined && params.sellerStartPrice !== undefined) {
            lines.push("");
            const bc = params.finalPrice - params.buyerStartPrice;
            const sc = params.sellerStartPrice - params.finalPrice;
            lines.push(`Buyer conceded   : Rs.${bc}  (Rs.${params.buyerStartPrice} -> Rs.${params.finalPrice})`);
            lines.push(`Seller conceded  : Rs.${sc}  (Rs.${params.sellerStartPrice} -> Rs.${params.finalPrice})`);
        }

        lines.push("");
        lines.push(hr);
        lines.push("AGENT REASONING — FINAL ROUND");
        lines.push(hr);
        const finalLogs = params.logs.filter(l => l.round === params.roundsUsed && l.reasoning);
        if (finalLogs.length > 0) {
            for (const log of finalLogs) {
                lines.push(`${log.from.padEnd(8)}: ${log.reasoning}`);
            }
        } else {
            lines.push("(no reasoning captured for final round)");
        }

        if (params.treasury) {
            lines.push("");
            lines.push(hr);
            lines.push("TREASURY VALIDATION (JupiterTreasuryAgent — ACTUS PAM Simulation)");
            lines.push(hr);
            lines.push(`Consulted rounds : ${params.treasury.consultedRounds.join(", ")}`);
            lines.push(`All checks passed: ${params.treasury.allApproved ? "YES" : "NO — override(s) applied"}`);
            if (params.treasury.overrideApplied) {
                lines.push("Override applied : YES — seller countered at treasury minimum viable price in at least one round");
            }
            if (params.treasury.finalNPV !== undefined) {
                lines.push(`Deal NPV         : Rs.${params.treasury.finalNPV.toLocaleString()}`);
            }
            if (params.treasury.finalNetProfit !== undefined) {
                lines.push(`Net profit (adj.): Rs.${params.treasury.finalNetProfit.toLocaleString()} (after working capital financing cost)`);
            }
            if (params.treasury.workingCapitalCost !== undefined) {
                lines.push(`Working cap. cost: Rs.${params.treasury.workingCapitalCost.toLocaleString()}`);
            }
            if (params.treasury.projectedMinBalance !== undefined && params.treasury.safetyThreshold !== undefined) {
                const safe = params.treasury.projectedMinBalance >= params.treasury.safetyThreshold;
                lines.push(`Gap cash position: Rs.${params.treasury.projectedMinBalance.toLocaleString()} ${safe ? "[SAFE]" : "[BELOW THRESHOLD]"}  (threshold Rs.${params.treasury.safetyThreshold.toLocaleString()})`);
            }
        }

        lines.push("");
        lines.push(hr);
        lines.push("HUMAN REVIEW CHECKLIST");
        lines.push(hr);
        lines.push("This deal closed autonomously. Please confirm:");
        lines.push("");
        lines.push(`  [x]  Final price Rs.${params.finalPrice}/unit is within procurement policy`);
        lines.push(`  [x]  Delivery date ${params.deliveryDate} is operationally achievable`);
        lines.push(`  [x]  Payment terms ${params.paymentTerms} are acceptable to finance`);
        if (params.treasury?.overrideApplied) {
            lines.push("  [!]  Treasury override was applied — verify final cash position is adequate");
        }
        if (params.treasury && !params.treasury.allApproved) {
            lines.push("  [!]  At least one treasury check failed — review override logic");
        }
        lines.push("");
        lines.push(hr);
        lines.push(`Generated : ${now.toISOString()}`);
        lines.push(hr);

        fs.writeFileSync(filePath, lines.join("\n"), "utf8");
        return filePath;
    }

    // ── Write parallel audit.json (iteration 3) ──────────────────────────────
    /**
     * Write a structured JSON audit file alongside the .txt report. Used by:
     *   - The buyer's /api/quality/:negotiationId endpoint (iteration 3)
     *   - The React dashboard's DealQualityCard (iteration 3)
     *   - The PDF signed-audit builder (iteration 7)
     *
     * Naming convention:
     *   NEG-{id}_{outcome}_{role}.txt   (existing, plain-text human report)
     *   NEG-{id}_{outcome}_{role}.audit.json  (new, structured data)
     *
     * `outcomeQualityInputs` may be omitted (returns the JSON without the
     * quality block); when present, computes IR/ZOPA/NBS/surplus/flags and
     * embeds them under `outcomeQuality`.
     */
    saveAuditJson(params: {
        outcome:          "success" | "escalation";
        finalPrice?:      number;
        quantity:         number;
        deliveryDate?:    string;
        paymentTerms?:    string;
        roundsUsed:       number;
        maxRounds:        number;
        logs:             NegotiationLog[];
        // Identity from the verification step
        counterpartyLEI?:        string;
        counterpartyEntityName?: string;
        ownLEI?:                 string;
        ownEntityName?:          string;
        credentialMode?:         "plain" | "vlei";
        // Outcome-quality inputs
        outcomeQualityInputs?:   QualityInputs;
        // Free-form extras the agent wants to record
        treasury?:        Record<string, unknown>;
        extras?:          Record<string, unknown>;
        // ITERATION 4 — decision trail and constraint disclosure
        decisions?:           Record<string, unknown>[];   // DecisionTrailEntry[]
        constraintDisclosure?: Record<string, unknown>;     // ConstraintDisclosureRecord
        // AUDIT FRAMEWORK V6 — Iteration 1 (Phase 3c):
        // Seller's live mode block, fetched by the BUYER from the seller's
        // /api/self/mode-status endpoint at deal close. Embedded under the new
        // top-level `sellerResponseMode` key. The pre-v6 key with the same name
        // (now renamed to `selfProcessMode`) was misnamed: it actually contained
        // the agent's own self-resolved mode, not the seller's mode.
        // See AUDIT-FRAMEWORK-V6-DECISIONS.md errata E2 + CONT8 Finding #1.
        // Buyer-side only; seller writes its own selfProcessMode block which
        // IS the seller's live mode — no fetch needed on seller side.
        sellerLiveMode?:      Record<string, unknown> | null;
        // ====================================================================
        // AUDIT FRAMEWORK V6 — Iteration 2 inputs.
        // - ownIdentity: result of CredentialProvider.loadOwnIdentity()
        //   cached on the agent at startup. Optional for backward compat
        //   with callers that still pass only ownLEI/ownEntityName; when
        //   supplied, enables the richer `agent.self` + `identityProof.self`.
        // - counterpartyVerification: result of
        //   CredentialProvider.verifyCounterparty(). Same backward-compat note.
        // - signingMode / signerProvider: from getMessageSigner(). Drives
        //   the honest tier label in messageSigningPosture.
        // - signingTierOverride: rarely needed; reserved for future signers
        //   that don't map cleanly through defaultTierForMode().
        // ====================================================================
        ownIdentity?:              AgentIdentity;
        counterpartyVerification?: VerificationResult;
        signingMode?:              SigningMode;
        signerProvider?:           string;
        signingTierOverride?:      MessageSigningTier;
        // ====================================================================
        // AUDIT FRAMEWORK V6 — Iteration 3 inputs.
        //
        // INTENT BLOCK — reflects the declared mandate (or agent default).
        //   - intentScenario:        ScenarioIntentExcerpt captured on the
        //                            agent's state. Buyer captures it from
        //                            `loadScenario()` at startNegotiation;
        //                            seller captures it from OfferData.scenarioIntent.
        //                            When undefined, the block falls back to
        //                            the default* fields below.
        //   - intentDefault{Buyer,Seller,Situation}: minimal fallback the
        //                            agent supplies so the audit can still
        //                            describe its own mandate from CLI args.
        //   - intentActual:          facts about the deal at close. Drives
        //                            deviation analysis (T2).
        //
        // AUTONOMY BLOCK — reflects the autonomy posture + commitGate.
        //   - commitGateEvents:      events accumulated in `state.commitGateEvents`
        //                            by the agent over the deal lifecycle.
        //                            Default: []. Populates wouldFireAt[] (T3).
        //   - humanOversightPosition: usually omitted (default HOOTL_with_guardrails).
        //                            Override for tests or future postures.
        //   - guardrails:            override for active guardrails list.
        //
        // All Iter 3 params are optional. When all are absent, the blocks
        // are not emitted (backward-compat with pre-iter-3 callers).
        // ====================================================================
        intentScenario?:           ScenarioIntentExcerpt;
        intentDefaultBuyer?:       BuyerIntent;
        intentDefaultSeller?:      SellerIntent;
        intentDefaultSituation?:   Situation;
        intentActual?:             ActualOutcomeFacts;
        commitGateEvents?:         CommitGateEvent[];
        humanOversightPosition?:   HumanOversightPosition;
        guardrails?:               string[];
        // ====================================================================
        // AUDIT FRAMEWORK V6 — Iteration 4 inputs.
        //
        // thinkCycleTrace[] — per-round 5-step think cycle from FRAMEWORK-V2
        // §6 (DECISIONS Item 1). Seller-only.
        //   - thinkCycleRounds: one ThinkCycleRoundInputs per round. The
        //     CALLER decides which steps to populate; BASIC/L1 mode passes
        //     only step4+step5 (Q-iter4-A option (b)); L2+ passes all 5.
        //
        // delegationChain[] — per-round 6-step delegation chain from v6
        // App B.2.2 (DECISIONS Item 4). Seller-only.
        //   - delegationSteps: flat array of DelegationStepInputs across all
        //     rounds. Caller orders entries by round + canonical step order.
        //     BASIC mode passes only `treasury-consultation` per round;
        //     L2+ passes all 6 per round.
        //
        // Both params are optional; absence = block not emitted (backward
        // compat with iter-3 callers, and used by the BUYER audit which
        // never populates these per Item 1 / Item 4).
        // ====================================================================
        thinkCycleRounds?:         ThinkCycleRoundInputs[];
        delegationSteps?:          DelegationStepInputs[];
        // ====================================================================
        // AUDIT FRAMEWORK V6 — Iteration 5 inputs.
        //
        // llmAuditRecords[] — BUYER-SIDE LLM-call telemetry. Each record is the
        // audit-shaped slice returned by shared/llm-client.ts (model name +
        // token counts + estimatedCostUSD). The buyer-agent accumulates these
        // per negotiation and passes them in here so frameworkMetrics.cost can
        // be aggregated. Wired by Step B of the iter-5 plan.
        //
        // Seller side does NOT pass this — frameworkMetrics aggregates seller
        // cost from thinkCycleTrace[].steps[stepName=geminiCall] directly.
        //
        // When undefined on the buyer (e.g. pre-Step-B), totalCostUSD = 0
        // honestly per DECISIONS iter-5 Item 0 ("emit, don't omit").
        // ====================================================================
        llmAuditRecords?: Array<{
            modelRequested:    string;
            promptTokens?:     number;
            completionTokens?: number;
            estimatedCostUSD?: number;
        }>;
    }): string {
        // v6 Iter1: per-deal folder; mkdir handled inside getDealFolder().
        const dir = getDealFolder(this.negotiationId);
        // v6 Iter1 / T2: new filename pattern — role-only, outcome lives in JSON.
        //   audits/YYYY-MM-DD/NEG-{id}/buyer.audit.json
        //   audits/YYYY-MM-DD/NEG-{id}/seller.audit.json
        // The pre-v6 pattern `${negotiationId}_${outcome}_${role}.audit.json`
        // is preserved verbatim in audits/_legacy_escalations/ for all historical
        // deals; the buyer-agent UI endpoints fall back to that legacy folder
        // when a deal isn't found at the new path.
        const filePath = path.join(
            dir,
            `${this.myRole.toLowerCase()}.audit.json`,
        );

        const trail = this.buildTrailFromLogs(params.logs);
        const outcomeQuality = params.outcomeQualityInputs
            ? computeOutcomeQuality(params.outcomeQualityInputs)
            : undefined;

        // ================================================================
        // AUDIT FRAMEWORK V6 — Iteration 2: build the new audit blocks.
        // identityProof requires both own + counterparty data; falls back
        // to undefined when either is missing (backward compat with caller
        // paths still using the LEI-only iter-1 params).
        // ================================================================
        const collector = getMessageLogCollector();
        const messageLog: MessageLogEntry[] = collector.getLog(this.negotiationId);

        let identityProof: IdentityProofBlock | undefined;
        if (params.ownIdentity && params.counterpartyVerification) {
            identityProof = buildIdentityProofBlock(
                params.ownIdentity,
                params.counterpartyVerification,
            );
        }

        // messageSigningPosture is emitted whenever the signing mode is
        // known. Stats are derived from the collector's log for this deal.
        let messageSigningPosture: MessageSigningPostureBlock | undefined;
        if (params.signingMode) {
            messageSigningPosture = buildMessageSigningPostureBlock({
                signingMode:  params.signingMode,
                provider:     params.signerProvider ?? "unknown",
                stats:        collector.computeStats(this.negotiationId),
                tierOverride: params.signingTierOverride,
            });
        }

        // agent.self / agent.counterparty extend (not replace) the existing
        // `parties` block. These are lightweight "who acted" summaries; the
        // deep snapshot (GLEIF status, KERI chain, etc.) lives in identityProof.
        const agentSelf = params.ownIdentity ? {
            role:            this.myRole,
            agentName:       params.ownIdentity.agentName,
            legalEntityName: params.ownIdentity.legalEntityName,
            lei:             params.ownIdentity.lei,
            oorOfficer:      params.ownIdentity.oorOfficer,
            agentAID:        params.ownIdentity.agentAID,
        } : undefined;

        const agentCounterparty = params.counterpartyVerification ? {
            role:            this.myRole === "BUYER" ? "SELLER" : "BUYER",
            agentName:       params.counterpartyVerification.counterparty.agentName,
            legalEntityName: params.counterpartyVerification.counterparty.legalEntityName,
            lei:             params.counterpartyVerification.counterparty.lei,
            oorOfficer:      params.counterpartyVerification.counterparty.oorOfficer,
            agentAID:        params.counterpartyVerification.counterparty.agentAID,
        } : undefined;

        // ================================================================
        // AUDIT FRAMEWORK V6 — Iteration 3: intent + autonomy blocks.
        // Emitted whenever the caller passed AT LEAST ONE Iter 3 input.
        // Backward-compat: pre-iter-3 callers omit all Iter 3 params and
        // these blocks remain undefined (not spread into auditDoc).
        // ================================================================
        const hasIntentInputs =
            params.intentScenario !== undefined ||
            params.intentDefaultBuyer !== undefined ||
            params.intentDefaultSeller !== undefined ||
            params.intentDefaultSituation !== undefined ||
            params.intentActual !== undefined;

        let intent: IntentBlock | undefined;
        if (hasIntentInputs && params.intentActual) {
            intent = buildIntentBlock({
                perspective:         this.myRole,
                scenarioIntent:      params.intentScenario,
                actual:              params.intentActual,
                defaultBuyerIntent:  params.intentDefaultBuyer,
                defaultSellerIntent: params.intentDefaultSeller,
                defaultSituation:    params.intentDefaultSituation,
            });
        }

        const hasAutonomyInputs =
            params.commitGateEvents !== undefined ||
            params.humanOversightPosition !== undefined ||
            params.guardrails !== undefined;

        let autonomy: AutonomyBlock | undefined;
        if (hasAutonomyInputs || hasIntentInputs) {
            // When the caller has wired iter 3 at all (intent OR autonomy inputs),
            // emit the autonomy block. The defaults are honest for the current
            // state — HOOTL_with_guardrails + zero events when no events were passed.
            autonomy = buildAutonomyBlock({
                commitGateEvents:        params.commitGateEvents ?? [],
                humanOversightPosition:  params.humanOversightPosition,
                guardrails:              params.guardrails,
            });
        }

        // ================================================================
        // AUDIT FRAMEWORK V6 — Iteration 4: build thinkCycleTrace[] and
        // delegationChain[]. Both are seller-only; the buyer audit's caller
        // does not pass thinkCycleRounds or delegationSteps, so both blocks
        // remain undefined and are not spread into auditDoc.
        // ================================================================
        let thinkCycleBlock: ThinkCycleTraceBlock | undefined;
        if (params.thinkCycleRounds !== undefined) {
            thinkCycleBlock = buildThinkCycleTrace(params.thinkCycleRounds);
        }

        let delegationBlock: DelegationChainBlock | undefined;
        if (params.delegationSteps !== undefined) {
            delegationBlock = buildDelegationChain(params.delegationSteps);
        }

        const auditDoc = {
            negotiationId:  this.negotiationId,
            perspective:    this.myRole,
            outcome:        params.outcome,
            startedAt:      this.startTime.toISOString(),
            generatedAt:    new Date().toISOString(),
            // ================================================================
            // AUDIT FRAMEWORK V6 — Iteration 1 (Phase 3c) renames and additions
            // ----------------------------------------------------------------
            // BEFORE v6: there was a single `sellerResponseMode` block here,
            // populated from buildSellerResponseModeBlock(). That block was
            // MISNAMED — it actually contained the LOCAL agent's resolution
            // of the env vars, not the seller's mode (see CONT8 Finding #1).
            //
            // AFTER v6: two blocks.
            //   - `selfProcessMode`     = THIS agent's own resolution
            //                             (what was previously named sellerResponseMode)
            //   - `sellerResponseMode`  = the seller's actual live mode.
            //                             Buyer fetches /api/self/mode-status
            //                             on the seller and passes it as
            //                             params.sellerLiveMode. Seller-side
            //                             leaves this null (the seller's own
            //                             selfProcessMode IS the seller mode).
            // ================================================================
            selfProcessMode:    buildSellerResponseModeBlock(),
            sellerResponseMode: params.sellerLiveMode ?? null,
            parties: {
                self: {
                    role:            this.myRole,
                    lei:             params.ownLEI,
                    legalEntityName: params.ownEntityName,
                },
                counterparty: {
                    role:            this.myRole === "BUYER" ? "SELLER" : "BUYER",
                    lei:             params.counterpartyLEI,
                    legalEntityName: params.counterpartyEntityName,
                },
            },
            identity: {
                credentialMode: params.credentialMode ?? "plain",
            },
            // ================================================================
            // AUDIT FRAMEWORK V6 — Iteration 2 audit blocks.
            // - agent.self / agent.counterparty: lightweight "who acted" pair
            //   that EXTENDS the existing `parties` block (kept above for
            //   backward compat).
            // - identityProof: deep GLEIF + KERI + verification snapshot.
            //   Mirrors what the GLEIF UI shows for each agent (T1).
            // - messageSigningPosture: honest tamper-evidence tier (T2),
            //   with the 5-value enum locked in DECISIONS.md notes addendum.
            // - messageLog[]: every envelope sent or received this deal,
            //   each with transportSignature.payloadHash (T3, T4).
            // ================================================================
            agent: {
                self:         agentSelf,
                counterparty: agentCounterparty,
            },
            identityProof,
            messageSigningPosture,
            messageLog,
            // ================================================================
            // AUDIT FRAMEWORK V6 — Iteration 3 audit blocks.
            // - intent:    declared mandate (or agent default) + expectedOutcome
            //              with `shape` discriminator + deviationFromIntent.
            // - autonomy:  six pillars + humanOversightPosition + commitGate
            //              with wouldFireAt[] events.
            // Both blocks are undefined when no Iter 3 inputs were passed,
            // preserving backward compat with iter-2 callers.
            // ================================================================
            intent,
            autonomy,
            // ================================================================
            // AUDIT FRAMEWORK V6 — Iteration 4 audit blocks.
            // - thinkCycleTrace[] + thinkCycleTraceScope (Item 1, Item 8)
            // - delegationChain[] + delegationChainScope (Item 4, Item 8)
            // Both are seller-only; buyer audits leave them undefined and
            // they're not spread when undefined (the ...spread pattern).
            // ================================================================
            ...(thinkCycleBlock ?? {}),
            ...(delegationBlock ?? {}),
            negotiation: {
                roundsUsed:      params.roundsUsed,
                maxRounds:       params.maxRounds,
                finalPrice:      params.finalPrice,
                quantity:        params.quantity,
                deliveryDate:    params.deliveryDate,
                paymentTerms:    params.paymentTerms,
                priceTrail:      trail,
            },
            outcomeQuality,
            // ITERATION 4 blocks
            constraintDisclosure: params.constraintDisclosure,
            decisions:            params.decisions,
            treasury: params.treasury,
            extras:   params.extras,
            logs:     params.logs,
        };

        // ================================================================
        // AUDIT FRAMEWORK V6 — Iteration 5: build frameworkMetrics + selfCheck
        // + compliance from the already-assembled auditDoc.
        //
        // Per DECISIONS iter-5 addendum Item 6, this happens at code-edit
        // (logger) time, NOT at agent caller time. The agents pass nothing
        // new for selfCheck or compliance — those blocks are derived purely
        // from auditDoc fields the agents already populate (identityProof,
        // messageSigningPosture, messageLog, intent, thinkCycleTrace,
        // delegationChain, autonomy.commitGate, outcomeQuality).
        //
        // The two verifier closures are inline here so self-check.ts can stay
        // dependency-free (it doesn't import node:crypto or our delegation
        // signer). The hash verifier (#4) re-hashes prompt.text vs prompt.hash;
        // the HMAC verifier (#5) re-derives the entry signature via the
        // canonical computeDelegationSignatureValue() from delegation-chain.ts
        // and compares against signature.value.
        //
        // All three iter-5 blocks are spread into a new `finalDoc` so the
        // existing auditDoc-driven index-line construction below stays
        // unchanged. Iter-5 blocks land at the end of the JSON; order is
        // not part of the locked contract (only field names + scope markers).
        // ================================================================
        const verifySha256Hex = (text: string, expectedHex: string): boolean => {
            const computed = createHash("sha256").update(text).digest("hex");
            return computed === expectedHex;
        };

        const verifyDelegationSignature = (entry: Record<string, unknown>): boolean => {
            const sig = entry["signature"] as { value?: string } | undefined;
            if (!sig?.value) return false;
            // Strip signature from a shallow copy, re-derive via the canonical
            // signer, compare. The builder uses insertion-order JSON.stringify
            // for the hash (delegation-chain.ts comment on signing convention),
            // and the destructure-then-spread pattern preserves that order on
            // the round-trip.
            const { signature: _sig, ...entryMinusSignature } = entry as any;
            try {
                const expected = computeDelegationSignatureValue(entryMinusSignature);
                return expected === sig.value;
            } catch {
                return false;
            }
        };

        const auditAny = auditDoc as any;

        // selfCheck — 5 booleans, derived per DECISIONS iter-5 Item 2.
        // Seller-only checks (#4, #5) are forced to null on the buyer side by
        // the builder regardless of what we pass; we pass the honest computed
        // values anyway so a future cross-side audit can introspect.
        const selfCheck: SelfCheckBlock = buildSelfCheck({
            perspective: this.myRole,
            checks: {
                identityVerified:         checkIdentityVerified(auditAny),
                messageIntegrityIntact:   checkMessageIntegrityIntact(auditAny),
                intentDeclaredAndTracked: checkIntentDeclaredAndTracked(auditAny),
                reasoningAuditable:       checkReasoningAuditable(auditAny, this.myRole, verifySha256Hex),
                delegationAttested:       checkDelegationAttested(auditAny, this.myRole, verifyDelegationSignature),
            },
        });

        // frameworkMetrics — cost source switches on perspective.
        //   SELLER: walk thinkCycleTrace[].steps (iter-4 telemetry, already there).
        //   BUYER:  use the caller-supplied llmAuditRecords[] (Step B). When
        //           that param is undefined, totalCostUSD = 0 honestly.
        const cost: FrameworkMetricsCost = (this.myRole === "SELLER")
            ? aggregateSellerCostFromThinkCycleTrace(auditAny.thinkCycleTrace)
            : aggregateCostFromLlmCallRecords(params.llmAuditRecords);
        const outcome     = extractOutcomeMetrics(auditAny, this.myRole);
        const riskAvoided = aggregateRiskAvoidedFromCommitGate(auditAny.autonomy?.commitGate);
        const frameworkMetrics: FrameworkMetricsBlock = buildFrameworkMetrics({
            cost,
            outcome,
            riskAvoided,
        });

        // compliance — static crosswalk (DECISIONS iter-5 Item 4).
        const compliance: ComplianceBlock = buildCompliance();

        const finalDoc = {
            ...auditDoc,
            frameworkMetrics,
            selfCheck,
            compliance,
        };

        fs.writeFileSync(filePath, JSON.stringify(finalDoc, null, 2), "utf8");

        // Iter 2: free the in-memory message log for this negotiation now
        // that its content is durable on disk inside auditDoc.messageLog[].
        // Safe even if the collector was never populated for this deal
        // (clear() is a no-op when the negotiationId is unknown).
        collector.clear(this.negotiationId);

        // ================================================================
        // AUDIT FRAMEWORK V6 — Iteration 1 (Phase 2): append one line to
        // audits/index.jsonl per audit write. T3 expects exactly two new
        // lines per closed deal (buyer + seller perspective).
        // ================================================================
        try {
            const oq: any = outcomeQuality;
            const treasuryAny: any = params.treasury;
            const sellerLive: any = params.sellerLiveMode;
            const selfMode: any = (auditDoc as any).selfProcessMode;
            const totalDealValue =
                params.finalPrice !== undefined && params.outcome === "success"
                    ? params.finalPrice * params.quantity
                    : null;
            const indexLine: AuditIndexLine = {
                schemaVersion:          1,
                negotiationId:          this.negotiationId,
                perspective:            this.myRole,
                auditFile:              path.relative(getAuditsRoot(), filePath).replace(/\\/g, "/"),
                startedAt:              this.startTime.toISOString(),
                generatedAt:            (auditDoc as any).generatedAt,
                outcome:                params.outcome,
                finalPrice:             params.finalPrice ?? null,
                quantity:               params.quantity,
                totalDealValue,
                currency:               (oq?.currency ?? params.outcomeQualityInputs?.currency ?? "INR"),
                roundsUsed:             params.roundsUsed,
                maxRounds:              params.maxRounds,
                selfLei:                params.ownLEI,
                selfEntityName:         params.ownEntityName,
                counterpartyLei:        params.counterpartyLEI,
                counterpartyEntityName: params.counterpartyEntityName,
                credentialMode:         params.credentialMode ?? "plain",
                selfProcessMode:        selfMode?.mode,
                sellerLiveMode:         this.myRole === "BUYER"
                                            ? (sellerLive?.mode ?? null)
                                            : null,
                closed:                 oq?.closed ?? (params.outcome === "success"),
                buyerMax:               oq?.buyerMax  ?? null,
                sellerMin:              oq?.sellerMin ?? null,
                zopaFeasible:           oq?.ZOPA?.wasFeasible,
                outsideZopa:            oq?.flags?.outsideZOPA,
                decisionCount:          params.decisions?.length ?? 0,
                treasuryOverrideApplied: treasuryAny?.overrideApplied,
                treasuryFinalNPV:       treasuryAny?.npvOfDeal,
            };
            appendAuditIndexLine(indexLine);
        } catch (err: any) {
            // Audit JSON is already on disk; index failure is non-fatal.
            // eslint-disable-next-line no-console
            console.error(`[audit-index] line construction failed for ${this.negotiationId}: ${err?.message ?? err}`);
        }

        return filePath;
    }

    /** Internal: rebuild per-round price trail from log entries. */
    private buildTrailFromLogs(logs: NegotiationLog[]): { round: number; buyer?: number; seller?: number; gap?: number }[] {
        const trail = new Map<number, { round: number; buyer?: number; seller?: number; gap?: number }>();
        for (const log of logs) {
            if (log.offeredPrice === undefined) continue;
            if (!trail.has(log.round)) trail.set(log.round, { round: log.round });
            const entry = trail.get(log.round)!;
            if (log.from === "BUYER")  entry.buyer  = log.offeredPrice;
            if (log.from === "SELLER") entry.seller = log.offeredPrice;
            if (entry.buyer !== undefined && entry.seller !== undefined) {
                entry.gap = Math.abs(entry.seller - entry.buyer);
            }
        }
        return [...trail.values()].sort((a, b) => a.round - b.round);
    }
    printPurchaseOrder(poData: any) {
        console.log("");
        console.log(`  ${C.blue + C.bold}  📝  PURCHASE ORDER${"".padEnd(W - 19)}  ${C.reset}`);
        console.log(`${C.dim}  ${hline()}${C.reset}`);
        console.log(`${C.dim}  PO ID    : ${poData.poId}${C.reset}`);
        console.log(`  ${C.bold}  Price    →  ₹${poData.terms.pricePerUnit} / unit  ×  ${poData.terms.quantity} units${C.reset}`);
        console.log(`  ${C.bold}  Total    →  ₹${poData.terms.total.toLocaleString()}${C.reset}`);
        console.log(`${C.dim}  Delivery : ${poData.deliveryDate}${C.reset}`);
        console.log(`${C.dim}  ${hline()}${C.reset}`);
    }

    // ── Invoice block ─────────────────────────────────────────────────────────
    printInvoice(invoiceData: any) {
        console.log("");
        console.log(`  ${C.magenta + C.bold}  📄  INVOICE GENERATED${"".padEnd(W - 22)}  ${C.reset}`);
        console.log(`${C.dim}  ${hline()}${C.reset}`);
        console.log(`${C.dim}  Invoice  : ${invoiceData.invoiceId}${C.reset}`);
        console.log(`${C.dim}  PO Ref   : ${invoiceData.poId}${C.reset}`);
        console.log(`  ${C.bold}  Price    →  ₹${invoiceData.terms.pricePerUnit} / unit  ×  ${invoiceData.terms.quantity}${C.reset}`);
        console.log(`${C.dim}  Subtotal : ₹${invoiceData.terms.subtotal.toLocaleString()}${C.reset}`);
        console.log(`${C.dim}  GST 18%  : ₹${invoiceData.terms.tax.toLocaleString()}${C.reset}`);
        console.log(`  ${C.green + C.bold}  TOTAL    →  ₹${invoiceData.terms.total.toLocaleString()}${C.reset}`);
        console.log(`${C.dim}  Payment  : ${invoiceData.paymentTerms}${C.reset}`);
        console.log(`${C.dim}  Delivery : ${invoiceData.deliveryDate}${C.reset}`);
        console.log(`${C.dim}  ${hline()}${C.reset}`);
    }

    // ── Dynamic Discounting: DD_OFFER ────────────────────────────────────────
    printDDOffer(data: any) {
        const pct = (data.maxDiscountRate * 100).toFixed(3);
        const propPct = (data.discountAtProposedDate.appliedRate * 100).toFixed(3);
        console.log("");
        console.log(`  ${C.cyan + C.bold}  💰  DD OFFER SENT${''.padEnd(W - 18)}  ${C.reset}`);
        console.log(`${C.dim}  ${hline()}${C.reset}`);
        console.log(`${C.dim}  Invoice      : ${data.invoiceId}${C.reset}`);
        console.log(`${C.dim}  Original     : ₹${data.originalTotal.toLocaleString()}${C.reset}`);
        console.log(`  ${C.bold}  Max DD Rate  →  ${pct}% (linear)${C.reset}`);
        console.log(`  ${C.bold}  Proposed pay : ${data.proposedSettlementDate}  (${data.discountAtProposedDate.daysEarly} days early)${C.reset}`);
        console.log(`  ${C.green + C.bold}  If accepted  →  ₹${data.discountAtProposedDate.discountedAmount.toLocaleString()}  (save ₹${data.discountAtProposedDate.savingAmount.toLocaleString()} @ ${propPct}%)${C.reset}`);
        console.log(`${C.dim}  ${hline()}${C.reset}`);
    }

    // ── Dynamic Discounting: DD_ACCEPT ───────────────────────────────────────
    printDDAccept(data: any) {
        console.log("");
        console.log(`  ${C.green + C.bold}  ✓  DD ACCEPTED BY BUYER${''.padEnd(W - 24)}  ${C.reset}`);
        console.log(`${C.dim}  ${hline()}${C.reset}`);
        console.log(`${C.dim}  Invoice    : ${data.invoiceId}${C.reset}`);
        console.log(`  ${C.bold}  Settlement : ${data.chosenSettlementDate}${C.reset}`);
        console.log(`${C.dim}  Computing discounted amount and submitting to ACTUS...${C.reset}`);
        console.log(`${C.dim}  ${hline()}${C.reset}`);
    }

    // ── Dynamic Discounting: DD_INVOICE (final) ───────────────────────────────
    printDDInvoice(data: any) {
        const pct = (data.appliedRate * 100).toFixed(3);
        const statusColor = data.actusSimulationStatus === "SUCCESS" ? C.green + C.bold : C.red + C.bold;
        console.log("");
        console.log(`  ${C.magenta + C.bold}  📄  DD INVOICE — FINAL${''.padEnd(W - 23)}  ${C.reset}`);
        console.log(`${C.dim}  ${hline()}${C.reset}`);
        console.log(`${C.dim}  Invoice ID   : ${data.invoiceId}${C.reset}`);
        console.log(`${C.dim}  Original     : ₹${data.originalTotal.toLocaleString()}${C.reset}`);
        console.log(`  ${C.bold}  Applied Rate →  ${pct}%${C.reset}`);
        console.log(`  ${C.green + C.bold}  PAYABLE      →  ₹${data.discountedTotal.toLocaleString()}  (saved ₹${data.savingAmount.toLocaleString()})${C.reset}`);
        console.log(`  ${C.bold}  Settle by   →  ${data.settlementDate}${C.reset}`);
        console.log(`${C.dim}  ACTUS ID     : ${data.actusContractId}${C.reset}`);
        console.log(`  ${statusColor}  ACTUS Status →  ${data.actusSimulationStatus}${data.actusError ? ' — ' + data.actusError : ''}${C.reset}`);
        console.log(`${C.dim}  ${hline()}${C.reset}`);
    }

    getLogs(): NegotiationLog[] {
        return this.logs;
    }
}
