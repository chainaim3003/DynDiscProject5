// ============================================================================
// src/agents/audit-reporting-agent/index.ts  —  Audit Framework v6 / Iter 7
// ============================================================================
//
// AuditReportingAgent — the 8th agent in the procurement system. Unlike the
// other seven (which participate in negotiations), this one *observes* the
// audit corpus written by the negotiation agents and generates regulator-
// facing periodic and on-demand reports.
//
// Responsibilities:
//   1. Daily report   — every 24h at 21:00 UTC, summary of all deals closed
//                       or escalated in the prior 24h. Markdown output to
//                       audits/reports/daily/YYYY-MM-DD.md.
//   2. Weekly report  — every Sunday at 21:00 UTC, aggregated cost / deal
//                       count / escalation rate by day. Markdown output to
//                       audits/reports/weekly/YYYY-WW.md (ISO week).
//   3. Forensic report (on demand) — per-deal markdown narrative + PDF
//                       (PDF via the shared generateAuditPdf rendering all
//                       14 v6 audit blocks; see shared/audit-pdf.ts).
//   4. A2A trigger    — other agents can ping POST /a2a/reports/trigger to
//                       request an immediate daily/weekly/forensic refresh.
//                       Response cached for 5 minutes per Q26.
//   5. Self-audit     — every report-generation operation writes a
//                       report-generation.audit.json under
//                       audits/<today>/NEG-RG-<ts>/ — the agent audits
//                       itself, since "who watches the watchers" is a real
//                       regulatory question.
//
// Authority envelope — per Q27 the agent runs as "Chief Audit Officer"
// using a plain JSON identity envelope (vLEI deferred to a later iter).
// The envelope is built once at startup and embedded into every
// self-audit + report header.
//
// Locked decisions referenced here:
//   Q24 — this agent lives on port :7074
//   Q25 — cron: '0 21 * * *' daily UTC  +  '0 21 * * 0' weekly Sunday UTC
//   Q26 — A2A trigger responses cached 5 minutes
//   Q27 — Chief Audit Officer, non-vLEI plain JSON envelope
//
// Iter-7 addendum (DECISIONS.md):
//   Item 11 — templates co-located here (packages/ folder does not exist)
//   Item 12 — in-memory Map cache, key = `${type}:${windowKey}`, 5-min TTL
//   Item 13 — self-audit shape is a subset of NegotiationAudit shaped for a
//             non-NEG actor (no decisions/intent/thinkCycle — those don't
//             apply); we keep the framework metadata + outcome + identity.
//   Item 14 — cron timezone explicitly set to UTC on every schedule.
//   Item 15 — authority envelope shape locked in buildAuthorityEnvelope().
//
// HONESTY NOTE: the daily/weekly templates aggregate from index.jsonl only;
// they do NOT touch individual audit JSONs (fast scan, no I/O per deal).
// Forensic reports load the full per-deal audit JSON and (optionally) the
// seller-side audit to populate decision-trail data. The PDF path always
// delegates to shared/audit-pdf.ts → generateAuditPdf(), never duplicates
// rendering logic.
// ============================================================================

import express, { type Request, type Response } from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import cron from "node-cron";
import Handlebars from "handlebars";
import { fileURLToPath } from "url";

import {
    getAuditsRoot,
    getReportsRoot,
    getDealFolder,
    getIndexJsonlPath,
} from "../../shared/audit-paths.js";
import type { AuditIndexLine } from "../../shared/audit-index-schema.js";
import { generateAuditPdf } from "../../shared/audit-pdf.js";
import dotenv from "dotenv";

// ── Resolve __dirname for ESM ────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Load this agent's own .env (same pattern as the other sub-agents).
dotenv.config({ path: path.join(__dirname, ".env") });

// ── Constants (mirror the locked decisions) ──────────────────────────────
// HOST/PORT now read from env (see .env in this folder). The literals below
// are fallback defaults that preserve the previous hardcoded behavior.
const HOST            = process.env.HOST ?? "127.0.0.1";
const PORT            = Number(process.env.PORT ?? 7074);  // Q24 (override via .env)
const CRON_DAILY      = "0 21 * * *";             // Q25 — daily 21:00 UTC
const CRON_WEEKLY     = "0 21 * * 0";             // Q25 — Sunday 21:00 UTC
const CRON_TIMEZONE   = "UTC";                    // Item 14
const CACHE_TTL_MS    = 5 * 60 * 1000;            // Q26 — 5 minutes
const AUTHORITY_ROLE  = "Chief Audit Officer";    // Q27

// ── Template paths (Item 11 — co-located, not packages/) ─────────────────
const TPL_DIR       = path.join(__dirname, "templates");
const TPL_DAILY     = path.join(TPL_DIR, "daily.md.hbs");
const TPL_WEEKLY    = path.join(TPL_DIR, "weekly.md.hbs");
const TPL_FORENSIC  = path.join(TPL_DIR, "forensic.md.hbs");

// ─────────────────────────────────────────────────────────────────────────
// Authority envelope (Item 15 — JSON shape locked)
// ─────────────────────────────────────────────────────────────────────────

interface AuthorityEnvelope {
    actorId:        string;            // "AGT-RG-<epochms>" stable per process
    actorType:      "AuditReportingAgent";
    role:           "Chief Audit Officer";
    credentialMode: "plain";           // Q27 — vLEI deferred
    vLeiDeferred:   true;              // explicit marker for future regulators
    authorityScope: string[];          // what this actor is authorized to do
    issuedAt:       string;            // ISO 8601
    lei:            null;              // explicit null until vLEI lands
}

let processAuthority: AuthorityEnvelope | null = null;

function buildAuthorityEnvelope(): AuthorityEnvelope {
    return {
        actorId:        `AGT-RG-${Date.now()}`,
        actorType:      "AuditReportingAgent",
        role:           AUTHORITY_ROLE,
        credentialMode: "plain",
        vLeiDeferred:   true,
        authorityScope: [
            "generate-daily-report",
            "generate-weekly-report",
            "generate-forensic-report",
            "read-audit-corpus",
            "write-self-audit",
        ],
        issuedAt:       new Date().toISOString(),
        lei:            null,
    };
}

// ─────────────────────────────────────────────────────────────────────────
// In-memory cache (Item 12)
// Key shape:  `${type}:${windowKey}`  e.g. "daily:2026-05-26", "weekly:2026-21"
// ─────────────────────────────────────────────────────────────────────────

interface CacheEntry {
    expiresAt: number;
    payload:   any;
}

const cache = new Map<string, CacheEntry>();

function cacheGet(key: string): any | null {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        cache.delete(key);
        return null;
    }
    return entry.payload;
}

function cacheSet(key: string, payload: any): void {
    cache.set(key, { payload, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ─────────────────────────────────────────────────────────────────────────
// Index.jsonl reader — single source for daily/weekly aggregation
// ─────────────────────────────────────────────────────────────────────────

/**
 * Read all index.jsonl lines. Returns [] if the file is missing.
 * Malformed lines are skipped (with a warn to stderr) rather than crashing.
 * BOM-tolerant: strips UTF-8 BOM from file start and from any individual line.
 */
function readIndexLines(): AuditIndexLine[] {
    const file = getIndexJsonlPath();
    if (!fs.existsSync(file)) return [];
    let raw = fs.readFileSync(file, "utf8");
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    const out: AuditIndexLine[] = [];
    for (const line of raw.split(/\r?\n/)) {
        let trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.charCodeAt(0) === 0xFEFF) trimmed = trimmed.slice(1).trim();
        if (!trimmed) continue;
        try {
            out.push(JSON.parse(trimmed) as AuditIndexLine);
        } catch (e: any) {
            console.warn(`[audit-reporting] skipping malformed index line: ${e?.message ?? e}`);
        }
    }
    return out;
}

/**
 * BOM-tolerant JSON file reader. Some older audit.json files were written
 * with a UTF-8 BOM at file start (legacy writer bug, since fixed in newer
 * writes). JSON.parse rejects BOM, so we strip it here defensively. This is
 * safe for clean files too — the check is a single charCodeAt.
 */
function parseJsonFile(filePath: string): any {
    let raw = fs.readFileSync(filePath, "utf8");
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    return JSON.parse(raw);
}

/**
 * Filter index lines to BUYER-perspective only (avoids double-counting
 * each deal — every deal has one BUYER and one SELLER line). For the
 * daily/weekly summaries we want one row per deal.
 */
function buyerOnly(lines: AuditIndexLine[]): AuditIndexLine[] {
    return lines.filter(l => l.perspective === "BUYER");
}

function isWithin(line: AuditIndexLine, sinceMs: number, untilMs: number): boolean {
    const t = Date.parse(line.generatedAt);
    if (!Number.isFinite(t)) return false;
    return t >= sinceMs && t < untilMs;
}

// ── UTC date helpers ─────────────────────────────────────────────────────

function todayUtcYmd(): string {
    const d = new Date();
    return formatYmdUtc(d);
}

function formatYmdUtc(d: Date): string {
    const y = d.getUTCFullYear().toString().padStart(4, "0");
    const m = (d.getUTCMonth() + 1).toString().padStart(2, "0");
    const day = d.getUTCDate().toString().padStart(2, "0");
    return `${y}-${m}-${day}`;
}

/** ISO 8601 week (Monday-start). Returns "YYYY-WW". */
function isoWeekKey(d: Date): string {
    // Copy so we don't mutate caller's date
    const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    // ISO weeks: Thursday in current week decides the year
    const dayNum = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((tmp.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `${tmp.getUTCFullYear()}-${weekNo.toString().padStart(2, "0")}`;
}

/**
 * Human-readable monthly-week key — "YYYY-Mon-WeekN".
 *
 * Definition (unambiguous, no month overlap):
 *   - The week is labeled by the calendar month of its MONDAY (UTC).
 *   - Within that month, weeks are numbered 1, 2, 3, ... by the count of
 *     Mondays from the start of the month up to and including this week's
 *     Monday.
 *
 * Examples (UTC):
 *   Mon May  4 2026 → "2026-May-Week2"  (2nd Monday of May)
 *   Mon May 25 2026 → "2026-May-Week4"  (4th Monday of May)
 *   Mon Jun  1 2026 → "2026-Jun-Week1"  (1st Monday of June)
 *
 * Input convention: `d` is interpreted as the Monday of the week to label.
 * In this file, callers always pass `new Date(since)` where `since` is the
 * UTC midnight of the week-start Monday — so the input contract is satisfied
 * by construction. The helper does NOT shift `d` to find the Monday itself;
 * it just reads `d`'s UTC year / month / day-of-month directly.
 */
function monthlyWeekKey(d: Date): string {
    const monthAbbrev = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    const year      = d.getUTCFullYear();
    const monthIdx  = d.getUTCMonth();          // 0..11
    const monthName = monthAbbrev[monthIdx];
    const dayOfMonth = d.getUTCDate();          // 1..31

    // Nth Monday of the month = ceil(dayOfMonth / 7) when d itself is a
    // Monday. (e.g. May 4 → 1; May 11 → 2; May 18 → 3; May 25 → 4.)
    const weekNoInMonth = Math.ceil(dayOfMonth / 7);

    return `${year}-${monthName}-Week${weekNoInMonth}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Daily-report builder
// ─────────────────────────────────────────────────────────────────────────

interface DailyReportContext {
    dateUtc:           string;           // "YYYY-MM-DD"
    generatedAtUtc:    string;
    authority:         AuthorityEnvelope;
    dealCount:         number;
    successCount:      number;
    escalationCount:   number;
    escalationRatePct: string;           // pre-formatted "12.5"
    totalDealValueByCurrency: Array<{ currency: string; value: number }>;
    deals: Array<{
        negotiationId:   string;
        startedAt:       string;
        generatedAt:     string;
        outcome:         string;
        counterparty:    string;
        finalPrice:      number | null;
        quantity:        number;
        totalDealValue:  number | null;
        currency:        string;
        roundsUsed:      number;
        maxRounds:       number;
        zopaFeasible:    boolean | undefined;
        outsideZopa:     boolean | undefined;
    }>;
}

function buildDailyContext(dateUtc: string): DailyReportContext {
    const since = Date.parse(`${dateUtc}T00:00:00Z`);
    const until = since + 24 * 60 * 60 * 1000;
    const all   = buyerOnly(readIndexLines()).filter(l => isWithin(l, since, until));

    const successCount    = all.filter(l => l.outcome === "success").length;
    const escalationCount = all.filter(l => l.outcome === "escalation").length;
    const totalsByCcy     = new Map<string, number>();
    for (const l of all) {
        if (l.totalDealValue != null) {
            totalsByCcy.set(l.currency, (totalsByCcy.get(l.currency) ?? 0) + l.totalDealValue);
        }
    }

    return {
        dateUtc,
        generatedAtUtc:    new Date().toISOString(),
        authority:         processAuthority!,
        dealCount:         all.length,
        successCount,
        escalationCount,
        escalationRatePct: all.length === 0
            ? "0.0"
            : (100 * escalationCount / all.length).toFixed(1),
        totalDealValueByCurrency: Array.from(totalsByCcy.entries()).map(([currency, value]) => ({ currency, value })),
        deals: all.map(l => ({
            negotiationId:  l.negotiationId,
            startedAt:      l.startedAt,
            generatedAt:    l.generatedAt,
            outcome:        l.outcome,
            counterparty:   l.counterpartyEntityName ?? l.counterpartyLei ?? "(unknown)",
            finalPrice:     l.finalPrice,
            quantity:       l.quantity,
            totalDealValue: l.totalDealValue,
            currency:       l.currency,
            roundsUsed:     l.roundsUsed,
            maxRounds:      l.maxRounds,
            zopaFeasible:   l.zopaFeasible,
            outsideZopa:    l.outsideZopa,
        })),
    };
}

// ─────────────────────────────────────────────────────────────────────────
// Weekly-report builder
// ─────────────────────────────────────────────────────────────────────────

interface WeeklyReportContext {
    weekKey:           string;           // "YYYY-WW"
    weekStartUtc:      string;           // ISO date of Monday
    weekEndUtc:        string;           // ISO date of Sunday
    generatedAtUtc:    string;
    authority:         AuthorityEnvelope;
    dealCount:         number;
    successCount:      number;
    escalationCount:   number;
    escalationRatePct: string;
    totalDealValueByCurrency: Array<{ currency: string; value: number }>;
    byDay: Array<{
        dateUtc:         string;
        dealCount:       number;
        successCount:    number;
        escalationCount: number;
    }>;
}

function buildWeeklyContext(weekStartUtc: string): WeeklyReportContext {
    const since = Date.parse(`${weekStartUtc}T00:00:00Z`);
    const until = since + 7 * 24 * 60 * 60 * 1000;
    const all   = buyerOnly(readIndexLines()).filter(l => isWithin(l, since, until));

    const successCount    = all.filter(l => l.outcome === "success").length;
    const escalationCount = all.filter(l => l.outcome === "escalation").length;
    const totalsByCcy     = new Map<string, number>();
    for (const l of all) {
        if (l.totalDealValue != null) {
            totalsByCcy.set(l.currency, (totalsByCcy.get(l.currency) ?? 0) + l.totalDealValue);
        }
    }

    // Per-day rollup
    const byDay: Array<{
        dateUtc: string; dealCount: number; successCount: number; escalationCount: number;
    }> = [];
    for (let i = 0; i < 7; i++) {
        const dayStart = since + i * 24 * 60 * 60 * 1000;
        const dayEnd   = dayStart + 24 * 60 * 60 * 1000;
        const dateUtc  = formatYmdUtc(new Date(dayStart));
        const inDay    = all.filter(l => isWithin(l, dayStart, dayEnd));
        byDay.push({
            dateUtc,
            dealCount:       inDay.length,
            successCount:    inDay.filter(l => l.outcome === "success").length,
            escalationCount: inDay.filter(l => l.outcome === "escalation").length,
        });
    }

    const weekEndDate = new Date(since + 6 * 24 * 60 * 60 * 1000);

    return {
        weekKey:           monthlyWeekKey(new Date(since)),
        weekStartUtc,
        weekEndUtc:        formatYmdUtc(weekEndDate),
        generatedAtUtc:    new Date().toISOString(),
        authority:         processAuthority!,
        dealCount:         all.length,
        successCount,
        escalationCount,
        escalationRatePct: all.length === 0
            ? "0.0"
            : (100 * escalationCount / all.length).toFixed(1),
        totalDealValueByCurrency: Array.from(totalsByCcy.entries()).map(([currency, value]) => ({ currency, value })),
        byDay,
    };
}

// ─────────────────────────────────────────────────────────────────────────
// Forensic-report builder (single deal)
// ─────────────────────────────────────────────────────────────────────────

interface ForensicLoadResult {
    auditFile:    string;                // resolved absolute path
    audit:        any;                   // BUYER-perspective audit JSON
    sellerAudit:  any | null;            // SELLER-perspective audit JSON if found
}

/**
 * Locate and load a deal's BUYER audit JSON + (if present) SELLER audit
 * JSON via the index.jsonl lookup. Returns null if the deal is not found.
 */
function loadDealAudits(negotiationId: string): ForensicLoadResult | null {
    const lines      = readIndexLines();
    const buyerLine  = lines.find(l => l.negotiationId === negotiationId && l.perspective === "BUYER");
    const sellerLine = lines.find(l => l.negotiationId === negotiationId && l.perspective === "SELLER");
    if (!buyerLine) {
        // Fall back to seller audit if that's all we have
        if (!sellerLine) return null;
        const sellerPath = path.join(getAuditsRoot(), sellerLine.auditFile);
        if (!fs.existsSync(sellerPath)) return null;
        return {
            auditFile:   sellerPath,
            audit:       parseJsonFile(sellerPath),
            sellerAudit: null,
        };
    }
    const buyerPath = path.join(getAuditsRoot(), buyerLine.auditFile);
    if (!fs.existsSync(buyerPath)) return null;
    const buyerJson = parseJsonFile(buyerPath);
    let sellerJson: any = null;
    if (sellerLine) {
        const sellerPath = path.join(getAuditsRoot(), sellerLine.auditFile);
        if (fs.existsSync(sellerPath)) {
            try { sellerJson = parseJsonFile(sellerPath); }
            catch { sellerJson = null; }
        }
    }
    return {
        auditFile:   buyerPath,
        audit:       buyerJson,
        sellerAudit: sellerJson,
    };
}

interface ForensicReportContext {
    negotiationId:  string;
    generatedAtUtc: string;
    authority:      AuthorityEnvelope;
    audit:          any;            // pass the full audit blob through to the template
    hasSellerAudit: boolean;
}

function buildForensicContext(negotiationId: string, loaded: ForensicLoadResult): ForensicReportContext {
    return {
        negotiationId,
        generatedAtUtc: new Date().toISOString(),
        authority:      processAuthority!,
        audit:          loaded.audit,
        hasSellerAudit: loaded.sellerAudit !== null,
    };
}

// ─────────────────────────────────────────────────────────────────────────
// Template rendering
// ─────────────────────────────────────────────────────────────────────────

// Compile lazily so a template syntax error doesn't crash startup
const compiled: Record<string, HandlebarsTemplateDelegate | null> = {
    daily:    null,
    weekly:   null,
    forensic: null,
};

function getTemplate(name: "daily" | "weekly" | "forensic"): HandlebarsTemplateDelegate {
    if (compiled[name]) return compiled[name]!;
    const file =
        name === "daily"    ? TPL_DAILY  :
        name === "weekly"   ? TPL_WEEKLY :
                              TPL_FORENSIC;
    const src = fs.readFileSync(file, "utf8");
    compiled[name] = Handlebars.compile(src, { noEscape: true });
    return compiled[name]!;
}

// Register helpers once at module load
Handlebars.registerHelper("fmtNum", (v: any) => {
    if (v === null || v === undefined || Number.isNaN(v)) return "—";
    return Number(v).toLocaleString("en-US");
});
Handlebars.registerHelper("fmtMoney", (v: any, ccy: any) => {
    if (v === null || v === undefined || Number.isNaN(v)) return "—";
    const sym = ccy === "USD" ? "$" : ccy === "INR" ? "₹" : "";
    return `${sym}${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
});
Handlebars.registerHelper("jsonStringify", (v: any) => {
    try { return JSON.stringify(v, null, 2); } catch { return String(v); }
});
Handlebars.registerHelper("eq", (a: any, b: any) => a === b);

// ─────────────────────────────────────────────────────────────────────────
// Self-audit writer (Item 13 — subset of NegotiationAudit for non-NEG actor)
// ─────────────────────────────────────────────────────────────────────────

interface ReportGenerationSelfAudit {
    schemaVersion:        1;
    auditKind:            "report-generation";
    actorId:              string;
    actorRole:            string;
    reportType:           "daily" | "weekly" | "forensic";
    reportKey:            string;          // e.g. date / week-key / NEG-id
    outputPath:           string;          // absolute file path written
    triggerSource:        "cron" | "http-ui" | "http-a2a";
    durationMs:           number;
    inputLineCount?:      number;          // for daily/weekly: how many index lines scanned
    targetNegotiationId?: string;          // for forensic
    pdfBytes?:            number;          // for forensic PDF only
    authority:            AuthorityEnvelope;
    startedAt:            string;          // ISO 8601
    completedAt:          string;          // ISO 8601
}

function writeSelfAudit(rec: ReportGenerationSelfAudit): string {
    const negotiationId = `NEG-RG-${Date.now()}`;
    const folder = getDealFolder(negotiationId);    // creates today/NEG-RG-<ts>/
    const file   = path.join(folder, "report-generation.audit.json");
    fs.writeFileSync(file, JSON.stringify(rec, null, 2), "utf8");
    return file;
}

// ─────────────────────────────────────────────────────────────────────────
// Report writers
// ─────────────────────────────────────────────────────────────────────────

function writeDailyReport(dateUtc: string, trigger: "cron" | "http-ui" | "http-a2a"): { outputPath: string; selfAuditPath: string; ctx: DailyReportContext } {
    const startedAt = new Date();
    const ctx       = buildDailyContext(dateUtc);
    const markdown  = getTemplate("daily")(ctx);
    const outDir    = path.join(getReportsRoot(), "daily");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outFile   = path.join(outDir, `${dateUtc}.md`);
    fs.writeFileSync(outFile, markdown, "utf8");
    const completedAt = new Date();
    const selfAuditPath = writeSelfAudit({
        schemaVersion:   1,
        auditKind:       "report-generation",
        actorId:         processAuthority!.actorId,
        actorRole:       processAuthority!.role,
        reportType:      "daily",
        reportKey:       dateUtc,
        outputPath:      outFile,
        triggerSource:   trigger,
        durationMs:      completedAt.getTime() - startedAt.getTime(),
        inputLineCount:  ctx.dealCount,
        authority:       processAuthority!,
        startedAt:       startedAt.toISOString(),
        completedAt:     completedAt.toISOString(),
    });
    return { outputPath: outFile, selfAuditPath, ctx };
}

function writeWeeklyReport(weekStartUtc: string, trigger: "cron" | "http-ui" | "http-a2a"): { outputPath: string; selfAuditPath: string; ctx: WeeklyReportContext } {
    const startedAt = new Date();
    const ctx       = buildWeeklyContext(weekStartUtc);
    const markdown  = getTemplate("weekly")(ctx);
    const outDir    = path.join(getReportsRoot(), "weekly");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outFile   = path.join(outDir, `${ctx.weekKey}.md`);
    fs.writeFileSync(outFile, markdown, "utf8");
    const completedAt = new Date();
    const selfAuditPath = writeSelfAudit({
        schemaVersion:   1,
        auditKind:       "report-generation",
        actorId:         processAuthority!.actorId,
        actorRole:       processAuthority!.role,
        reportType:      "weekly",
        reportKey:       ctx.weekKey,
        outputPath:      outFile,
        triggerSource:   trigger,
        durationMs:      completedAt.getTime() - startedAt.getTime(),
        inputLineCount:  ctx.dealCount,
        authority:       processAuthority!,
        startedAt:       startedAt.toISOString(),
        completedAt:     completedAt.toISOString(),
    });
    return { outputPath: outFile, selfAuditPath, ctx };
}

/**
 * Forensic: writes the markdown narrative AND streams the PDF to `res`.
 * The PDF is the canonical artifact (regulator-grade, signed by render);
 * markdown is convenience text for human review.
 */
async function writeForensicReport(
    negotiationId: string,
    trigger:       "http-ui" | "http-a2a",
    res:           Response,
): Promise<void> {
    const startedAt = new Date();
    const loaded    = loadDealAudits(negotiationId);
    if (!loaded) {
        res.status(404).json({ error: "negotiation not found", negotiationId });
        return;
    }

    // 1. Write markdown narrative to on-demand folder
    const ctx      = buildForensicContext(negotiationId, loaded);
    const markdown = getTemplate("forensic")(ctx);
    const onDir    = path.join(getReportsRoot(), "on-demand");
    if (!fs.existsSync(onDir)) fs.mkdirSync(onDir, { recursive: true });
    const mdFile   = path.join(onDir, `${negotiationId}.forensic.md`);
    fs.writeFileSync(mdFile, markdown, "utf8");

    // 2. Stream the PDF (uses shared/audit-pdf.ts generateAuditPdf; never
    //    duplicates rendering logic).
    res.status(200);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${negotiationId}.audit.pdf"`);

    // Count bytes written by tapping the stream — for the self-audit
    let pdfBytes = 0;
    const origWrite = res.write.bind(res);
    (res as any).write = (chunk: any, ...rest: any[]): boolean => {
        if (chunk && typeof chunk !== "function") {
            const len = Buffer.isBuffer(chunk) ? chunk.length :
                        typeof chunk === "string" ? Buffer.byteLength(chunk) : 0;
            pdfBytes += len;
        }
        return (origWrite as any)(chunk, ...rest);
    };

    await generateAuditPdf(loaded.audit, loaded.sellerAudit, res);

    const completedAt = new Date();
    writeSelfAudit({
        schemaVersion:        1,
        auditKind:            "report-generation",
        actorId:              processAuthority!.actorId,
        actorRole:            processAuthority!.role,
        reportType:           "forensic",
        reportKey:            negotiationId,
        outputPath:           mdFile,                       // PDF was streamed, not file-written
        triggerSource:        trigger,
        durationMs:           completedAt.getTime() - startedAt.getTime(),
        targetNegotiationId:  negotiationId,
        pdfBytes,
        authority:            processAuthority!,
        startedAt:            startedAt.toISOString(),
        completedAt:          completedAt.toISOString(),
    });
}

// ─────────────────────────────────────────────────────────────────────────
// Cron jobs
// ─────────────────────────────────────────────────────────────────────────

function registerCronJobs(): void {
    cron.schedule(CRON_DAILY, () => {
        // Cron fires at 21:00 UTC on date D; reports cover the prior 24h
        // — by convention we use the date the cron fires on (i.e. "today's
        // accumulated activity through 21:00 UTC"). This matches the
        // spec wording in the iter-7 plan.
        const dateUtc = todayUtcYmd();
        try {
            const r = writeDailyReport(dateUtc, "cron");
            console.log(`[audit-reporting] cron-daily wrote ${r.outputPath} (${r.ctx.dealCount} deals)`);
        } catch (e: any) {
            console.error(`[audit-reporting] cron-daily failed: ${e?.message ?? e}`);
        }
    }, { timezone: CRON_TIMEZONE });

    cron.schedule(CRON_WEEKLY, () => {
        // Sunday 21:00 UTC → cover Monday-Sunday week ending today.
        // Find this week's Monday (UTC) by subtracting 6 days from Sunday.
        const now    = new Date();
        const monday = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
        const weekStartUtc = formatYmdUtc(monday);
        try {
            const r = writeWeeklyReport(weekStartUtc, "cron");
            console.log(`[audit-reporting] cron-weekly wrote ${r.outputPath} (${r.ctx.dealCount} deals)`);
        } catch (e: any) {
            console.error(`[audit-reporting] cron-weekly failed: ${e?.message ?? e}`);
        }
    }, { timezone: CRON_TIMEZONE });

    console.log(`[audit-reporting] cron registered: daily="${CRON_DAILY}" weekly="${CRON_WEEKLY}" tz=${CRON_TIMEZONE}`);
}

// ─────────────────────────────────────────────────────────────────────────
// HTTP endpoints
// ─────────────────────────────────────────────────────────────────────────

function buildApp(): express.Express {
    const app = express();
    app.use(cors());
    app.use(express.json({ limit: "1mb" }));

    // Health probe ────────────────────────────────────────────────────────
    app.get("/health", (_req: Request, res: Response) => {
        res.json({
            status:    "ok",
            agent:     "audit-reporting-agent",
            port:      PORT,
            role:      AUTHORITY_ROLE,
            authority: processAuthority,
            uptimeSec: Math.round(process.uptime()),
        });
    });

    // Authority discovery (a counterpart's first call before A2A trigger)
    app.get("/api/authority", (_req: Request, res: Response) => {
        res.json(processAuthority);
    });

    // List existing reports (UI populates the AuditReports page from this)
    app.get("/api/reports/list", (_req: Request, res: Response) => {
        const root = getReportsRoot();
        const list = (sub: string): Array<{ name: string; sizeBytes: number; mtime: string }> => {
            const dir = path.join(root, sub);
            if (!fs.existsSync(dir)) return [];
            return fs.readdirSync(dir)
                .filter(f => f.endsWith(".md"))
                .map(f => {
                    const stat = fs.statSync(path.join(dir, f));
                    return { name: f, sizeBytes: stat.size, mtime: stat.mtime.toISOString() };
                })
                .sort((a, b) => b.mtime.localeCompare(a.mtime));
        };
        res.json({
            daily:     list("daily"),
            weekly:    list("weekly"),
            onDemand:  list("on-demand"),
        });
    });

    // List deals that have v6 forensic audit JSON available (UI dropdown source).
    // Reads index.jsonl + verifies the underlying audit file actually exists on
    // disk, so every deal returned here is guaranteed to produce a real PDF —
    // no 404s, no half-rendered "(not available)" sections. Dedupes BUYER+SELLER
    // index lines into one row per negotiationId (prefers BUYER when both exist).
    app.get("/api/reports/forensic/available-deals", (_req: Request, res: Response) => {
        const lines = readIndexLines();
        const root  = getAuditsRoot();

        // Group by negotiationId — prefer BUYER perspective if both exist
        const byId = new Map<string, AuditIndexLine>();
        for (const line of lines) {
            const existing = byId.get(line.negotiationId);
            if (!existing) {
                byId.set(line.negotiationId, line);
            } else if (existing.perspective === "SELLER" && line.perspective === "BUYER") {
                byId.set(line.negotiationId, line);
            }
        }

        // Only include deals whose audit file actually exists on disk —
        // a stale index.jsonl entry without a backing file would 404 the PDF.
        const deals: Array<{
            negotiationId:          string;
            outcome:                "success" | "escalation";
            generatedAt:            string;
            totalDealValue:         number | null;
            currency:               string;
            counterpartyEntityName: string | null;
        }> = [];

        for (const line of byId.values()) {
            const auditPath = path.join(root, line.auditFile);
            if (!fs.existsSync(auditPath)) continue;
            deals.push({
                negotiationId:          line.negotiationId,
                outcome:                line.outcome,
                generatedAt:            line.generatedAt,
                totalDealValue:         line.totalDealValue,
                currency:               line.currency,
                counterpartyEntityName: line.counterpartyEntityName ?? null,
            });
        }

        // Sort newest first so the most recent demo deal sits at the top
        deals.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));

        res.json({ deals, count: deals.length });
    });

    // Fetch a single report's markdown content
    app.get("/api/reports/content", (req: Request, res: Response) => {
        const kind = String(req.query.kind ?? "");
        const name = String(req.query.name ?? "");
        const allowedKinds = new Set(["daily", "weekly", "on-demand"]);
        if (!allowedKinds.has(kind)) {
            res.status(400).json({ error: "kind must be daily|weekly|on-demand" });
            return;
        }
        // Defence-in-depth: no slashes or '..' in the name
        if (!/^[A-Za-z0-9._-]+\.md$/.test(name)) {
            res.status(400).json({ error: "invalid report name" });
            return;
        }
        const file = path.join(getReportsRoot(), kind, name);
        if (!fs.existsSync(file)) {
            res.status(404).json({ error: "report not found" });
            return;
        }
        res.setHeader("Content-Type", "text/markdown; charset=utf-8");
        res.send(fs.readFileSync(file, "utf8"));
    });

    // On-demand daily trigger (UI button) ────────────────────────────────
    app.post("/api/reports/daily", (req: Request, res: Response) => {
        const dateUtc = typeof req.body?.dateUtc === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.body.dateUtc)
            ? req.body.dateUtc
            : todayUtcYmd();
        const trigger = "http-ui" as const;
        try {
            const r = writeDailyReport(dateUtc, trigger);
            res.json({
                ok:            true,
                outputPath:    r.outputPath,
                selfAuditPath: r.selfAuditPath,
                dealCount:     r.ctx.dealCount,
                dateUtc,
            });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e?.message ?? String(e) });
        }
    });

    // On-demand weekly trigger (UI button) ───────────────────────────────
    app.post("/api/reports/weekly", (req: Request, res: Response) => {
        // Default: most recent ISO Monday on or before today (UTC).
        let weekStartUtc: string;
        if (typeof req.body?.weekStartUtc === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.body.weekStartUtc)) {
            weekStartUtc = req.body.weekStartUtc;
        } else {
            const now    = new Date();
            const dow    = now.getUTCDay() || 7;           // 1..7 Mon..Sun
            const monday = new Date(now.getTime() - (dow - 1) * 24 * 60 * 60 * 1000);
            weekStartUtc = formatYmdUtc(monday);
        }
        try {
            const r = writeWeeklyReport(weekStartUtc, "http-ui");
            res.json({
                ok:            true,
                outputPath:    r.outputPath,
                selfAuditPath: r.selfAuditPath,
                dealCount:     r.ctx.dealCount,
                weekKey:       r.ctx.weekKey,
            });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e?.message ?? String(e) });
        }
    });

    // Forensic PDF (UI per-deal button) ──────────────────────────────────
    app.post("/api/reports/forensic", async (req: Request, res: Response) => {
        const negotiationId = String(req.body?.negotiationId ?? "");
        if (!/^NEG-[A-Za-z0-9_-]+$/.test(negotiationId)) {
            res.status(400).json({ error: "negotiationId must match /^NEG-[A-Za-z0-9_-]+$/" });
            return;
        }
        try {
            await writeForensicReport(negotiationId, "http-ui", res);
        } catch (e: any) {
            // If headers were already sent (PDF streaming started), we can't
            // change the status — log and let the broken pipe error surface.
            if (!res.headersSent) {
                res.status(500).json({ ok: false, error: e?.message ?? String(e) });
            } else {
                console.error(`[audit-reporting] forensic stream error after headers sent: ${e?.message ?? e}`);
            }
        }
    });

    // A2A trigger — 5-minute cache per Q26 ───────────────────────────────
    app.post("/a2a/reports/trigger", (req: Request, res: Response) => {
        const type = String(req.body?.type ?? "");
        if (type !== "daily" && type !== "weekly") {
            res.status(400).json({ error: "type must be 'daily' or 'weekly' for A2A trigger" });
            return;
        }
        const windowKey = type === "daily"
            ? todayUtcYmd()
            : (() => {
                const now    = new Date();
                const dow    = now.getUTCDay() || 7;
                const monday = new Date(now.getTime() - (dow - 1) * 24 * 60 * 60 * 1000);
                return formatYmdUtc(monday);
            })();
        const key = `${type}:${windowKey}`;
        const cached = cacheGet(key);
        if (cached) {
            res.json({ ok: true, cached: true, ...cached });
            return;
        }
        try {
            const r = type === "daily"
                ? writeDailyReport(windowKey, "http-a2a")
                : writeWeeklyReport(windowKey, "http-a2a");
            const payload = {
                outputPath:    r.outputPath,
                selfAuditPath: r.selfAuditPath,
                dealCount:     r.ctx.dealCount,
                windowKey,
            };
            cacheSet(key, payload);
            res.json({ ok: true, cached: false, ...payload });
        } catch (e: any) {
            res.status(500).json({ ok: false, error: e?.message ?? String(e) });
        }
    });

    return app;
}

// ─────────────────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────────────────

async function main() {
    processAuthority = buildAuthorityEnvelope();
    console.log(`[audit-reporting] authority: ${processAuthority.actorId} (${processAuthority.role}, credentialMode=${processAuthority.credentialMode})`);

    // Sanity-check template files (fail fast if missing — they ship with the agent)
    for (const f of [TPL_DAILY, TPL_WEEKLY, TPL_FORENSIC]) {
        if (!fs.existsSync(f)) {
            console.error(`[audit-reporting] missing template: ${f}`);
            process.exit(1);
        }
    }

    // Ensure reports root exists (Iter-1 created it; defensive mkdir)
    fs.mkdirSync(path.join(getReportsRoot(), "daily"),     { recursive: true });
    fs.mkdirSync(path.join(getReportsRoot(), "weekly"),    { recursive: true });
    fs.mkdirSync(path.join(getReportsRoot(), "on-demand"), { recursive: true });

    const app = buildApp();
    registerCronJobs();

    const server = app.listen(PORT, HOST, () => {
        console.log(`[audit-reporting] HTTP ready at http://${HOST}:${PORT}`);
        console.log(`[audit-reporting] endpoints:`);
        console.log(`    GET  /health`);
        console.log(`    GET  /api/authority`);
        console.log(`    GET  /api/reports/list`);
        console.log(`    GET  /api/reports/forensic/available-deals`);
        console.log(`    GET  /api/reports/content?kind=daily|weekly|on-demand&name=<file>.md`);
        console.log(`    POST /api/reports/daily      { dateUtc?: "YYYY-MM-DD" }`);
        console.log(`    POST /api/reports/weekly     { weekStartUtc?: "YYYY-MM-DD" }`);
        console.log(`    POST /api/reports/forensic   { negotiationId: "NEG-..." }   → PDF stream`);
        console.log(`    POST /a2a/reports/trigger    { type: "daily" | "weekly" }   (5m cache)`);
    });

    // Clean shutdown
    let shuttingDown = false;
    const shutdown = (signal: string) => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`[audit-reporting] ${signal} received, shutting down...`);
        server.close(() => {
            console.log(`[audit-reporting] shutdown complete`);
            process.exit(0);
        });
        setTimeout(() => {
            console.warn(`[audit-reporting] forced exit after 5s`);
            process.exit(1);
        }, 5000).unref();
    };
    process.on("SIGINT",  () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch(e => {
    console.error(`[audit-reporting] fatal: ${e?.message ?? e}`);
    process.exit(1);
});
