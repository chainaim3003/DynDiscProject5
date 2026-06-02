/**
 * TrustSpine — agentic trust theater, TWO-SIDED & 100% live from SSE.
 * ===========================================================================
 * NOTHING is mocked. Every value is derived from LogEvents the backend
 * actually broadcasts. Rendered as a single SVG overlay (viewBox 0 0 1000 600,
 * matching the stage) plus small HTML cards. It does NOT touch the SVG stage
 * nodes or the EnvelopeLayer, so the message-envelope flights between agents
 * keep playing underneath, and nothing in the arena breaks.
 *
 * Layout — symmetric split down the center:
 *   LEFT half  = the BUYER working in full  (Tommy → Buyer-vLEI panel → journey)
 *   RIGHT half = the SELLER working in full  (Jupiter → Seller-vLEI panel → journey)
 * Both halves run the identical live machinery; each is fed its own side's data.
 *
 * Live signals (all real):
 *   - Identity : "✅ Buyer/Seller vLEI delegation chain verified (<script>)"
 *   - KRAM tick: "[verify] ✓ counter=<n> type=<T> payloadHash=<12hex>
 *                 aid=<senderAid> mode=<kram|plain> neg=<NEG-id> valid=true"
 *   - Outcome  : Deal Closed / ✓✓  OR  escalation (both write an audit JSON)
 *
 * Cross-verify (real): the BUYER vLEI agent verifies the SELLER's messages
 * (from=BUYER ticks → senderAid = seller's live AID), and vice-versa. So a
 * principal's OWN live AID is the senderAid carried on the OTHER side's ticks.
 *
 * NOT shown (to avoid mocks): per-step narration ("consulting"/"decided") and
 * true round numbers — not confirmed on the wire. Ticks are numbered by their
 * real sequence, never by an invented round.
 */

import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { gsap } from './gsap-setup';
import type { LogEvent } from '@/theater/shared/types';
import { IDENTITIES, shortLei } from '@/theater/shared/identities';
import { BACKENDS } from '@/theater/shared/constants';

// ─── Parsing (pure) ─────────────────────────────────────────────────────────

export interface VerifyTick {
  eventId: string;
  counter: number;
  msgType: string;
  payloadHash: string;
  aid: string;
  mode: string;
  neg: string;
  valid: boolean;
  ts: string;
}

const IDENTITY_VERIFIED = /delegation chain verified/i;
const IDENTITY_PLAIN     = /identity check passed/i;
const DEAL_CLOSED        = /(Deal Closed|✓✓|DEAL CLOSED)/;
const ESCALATED          = /(escalat|NO DEAL)/i;

export function parseVerifyTick(eventId: string, text: string, ts: string): VerifyTick | null {
  if (!text.startsWith('[verify]')) return null;
  const counter = Number(text.match(/counter=(\d+)/)?.[1] ?? NaN);
  if (Number.isNaN(counter)) return null;
  return {
    eventId,
    counter,
    msgType:     text.match(/type=(\S+)/)?.[1] ?? '?',
    payloadHash: text.match(/payloadHash=([0-9a-fA-F]+)/)?.[1] ?? '',
    aid:         text.match(/aid=(\S+)/)?.[1] ?? 'n/a',
    mode:        text.match(/mode=(\w+)/)?.[1] ?? '?',
    neg:         text.match(/neg=(NEG-\d+)/)?.[1] ?? '',
    valid:       /valid=true/.test(text),
    ts,
  };
}

interface SideTrust {
  identityVerified: boolean;
  identityMode: 'vlei' | 'plain' | null;
  identityScript: string;
  ticks: VerifyTick[];
  negotiationId: string;
  dealClosed: boolean;
  escalated: boolean;
  treasuryConsults: number;   // real count of '[treasury] consulted' SSE lines (seller side)
}

const emptySide = (): SideTrust => ({
  identityVerified: false, identityMode: null, identityScript: '',
  ticks: [], negotiationId: '', dealClosed: false, escalated: false, treasuryConsults: 0,
});

function deriveTrust(events: LogEvent[]): { buyer: SideTrust; seller: SideTrust } {
  const buyer = emptySide();
  const seller = emptySide();
  for (const ev of events) {
    if (ev.kind !== 'sse') continue;
    const side = ev.payload.from === 'BUYER' ? buyer : ev.payload.from === 'SELLER' ? seller : null;
    if (!side) continue;
    const text = ev.payload.text;
    const tick = parseVerifyTick(ev.id, text, ev.payload.rawTimestamp);
    if (tick) {
      if (tick.neg && tick.neg !== side.negotiationId) {
        side.negotiationId = tick.neg; side.ticks = []; side.dealClosed = false; side.escalated = false; side.treasuryConsults = 0;
      }
      if (!side.ticks.some(t => t.counter === tick.counter)) {
        side.ticks = [...side.ticks, tick].sort((a, b) => a.counter - b.counter);
      }
      continue;
    }
    if (IDENTITY_VERIFIED.test(text)) {
      side.identityVerified = true; side.identityMode = 'vlei';
      side.identityScript = text.match(/\(([^)]+)\)/)?.[1] ?? '';
    } else if (IDENTITY_PLAIN.test(text)) {
      side.identityVerified = true; side.identityMode = 'plain';
    }
    if (DEAL_CLOSED.test(text)) side.dealClosed = true;
    if (ESCALATED.test(text)) side.escalated = true;
    // Real per-round Treasury consult marker (seller broadcasts this right
    // before consultTreasury() runs). Drives the seller-hop dip toward Treasury.
    if (/^\[treasury\] consulted/.test(text)) side.treasuryConsults += 1;
  }
  return { buyer, seller };
}

const prefersReduced = (): boolean =>
  typeof window !== 'undefined' && !!window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ─── Geometry (viewBox 1000 × 600) ──────────────────────────────────────────

// NOTE: NODE cx 130/870 intentionally match useStageLayout positions.buyer/
// seller (the envelope-flight endpoints), so message envelopes land ON the
// Tommy/Jupiter agents in full-theater mode. Don't move these without moving
// the layout endpoints too.
const CORE = { x: 350, y: 116, w: 300, h: 96 };
const PANEL = {
  buyer:  { x: CORE.x + 14, y: CORE.y + 30, w: 132, h: 54 },
  seller: { x: CORE.x + CORE.w - 146, y: CORE.y + 30, w: 132, h: 54 },
};
const NODE = {
  buyer:  { cx: 130, cy: 250, r: 34, accent: '#3b82f6' },
  seller: { cx: 870, cy: 250, r: 34, accent: '#10b981' },
};
const COLS = 3;              // nodes per row before wrapping
const ROW_GAP = 56;          // vertical gap between wrapped rows
const RAIL = {
  buyer:  { x0: 70,  x1: 430, y0: 374 },
  seller: { x0: 570, x1: 930, y0: 374 },
};
// Seller-side Treasury anchor — Jupiter consults its Treasury each round.
// Sits below the seller rail, right of the (faint) back-office strip.
const TREASURY = { x: 880, y: 496 };

// Left-to-right, wrapping every COLS nodes onto a new row below.
// Index 0,1,2 on row 0; 3,4,5 on row 1; etc.
function railPoint(rail: { x0: number; x1: number; y0: number }, i: number) {
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  const step = (rail.x1 - rail.x0) / (COLS - 1);
  return { x: rail.x0 + col * step, y: rail.y0 + row * ROW_GAP, col, row };
}

type Side = 'buyer' | 'seller';

// ─── Center vLEI panel (one half) ────────────────────────────────────────────

function VleiPanel({ side, verified, mode, script, count }: {
  side: Side; verified: boolean; mode: 'vlei' | 'plain' | null; script: string; count: number;
}) {
  const box = PANEL[side];
  const ref = useRef<SVGGElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    if (!verified || prefersReduced()) { gsap.set(el, { opacity: verified ? 1 : 0.3, scale: 1 }); return; }
    gsap.fromTo(el, { opacity: 0.2, scale: 0.5, transformOrigin: '50% 50%' },
      { opacity: 1, scale: 1, duration: 0.5, ease: 'back.out(2.2)' });
  }, [verified]);
  const accent = !verified ? '#9ca3af' : mode === 'plain' ? '#d97706' : '#10b981';
  const cx = box.x + 26, cy = box.y + box.h / 2;
  const label = side === 'buyer' ? 'Buyer vLEI agent' : 'Seller vLEI agent';
  return (
    <g>
      <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={8}
        fill="currentColor" fillOpacity={0.03} stroke={accent} strokeOpacity={0.45} strokeWidth={1} />
      <g ref={ref}>
        <path d={`M ${cx} ${cy - 16} l 13 4 v 8 c 0 7 -5 11 -13 13 c -8 -2 -13 -6 -13 -13 v -8 z`}
          fill={accent} fillOpacity={0.14} stroke={accent} strokeWidth={1.4} />
        {verified && <path d={`M ${cx - 6} ${cy} l 4 4 l 8 -9`} fill="none" stroke={accent} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />}
      </g>
      <text x={box.x + 50} y={cy - 6} fontSize={11} fontWeight={600} fill="currentColor" fillOpacity={0.85}>{label}</text>
      <text x={box.x + 50} y={cy + 9} fontSize={9} fontFamily="ui-monospace, monospace" fill={accent}>
        {verified ? (mode === 'plain' ? 'GLEIF only' : `vLEI ✓ ${script}`) : 'pending…'}
      </text>
      <text x={box.x + 50} y={cy + 22} fontSize={8.5} fontFamily="ui-monospace, monospace" fill="currentColor" fillOpacity={0.5}>
        {count} msg verified
      </text>
    </g>
  );
}

// ─── Principal node (Tommy / Jupiter) — icon + name + LEI + live AID ─────────

function PrincipalNode({ side, ownAid }: { side: Side; ownAid: string }) {
  const n = NODE[side];
  const name = side === 'buyer' ? 'Tommy Agent' : 'Jupiter Agent';
  const lei = IDENTITIES[side].lei;
  return (
    <g>
      <circle cx={n.cx} cy={n.cy} r={n.r} fill="currentColor" fillOpacity={0.03} stroke={n.accent} strokeOpacity={0.5} strokeWidth={1.4} />
      {/* agent glyph: antenna + head + eyes + mouth (fit to r=34) */}
      <line x1={n.cx} y1={n.cy - 20} x2={n.cx} y2={n.cy - 12} stroke={n.accent} strokeWidth={1.3} strokeLinecap="round" />
      <circle cx={n.cx} cy={n.cy - 22} r={2} fill={n.accent} />
      <rect x={n.cx - 12} y={n.cy - 11} width={24} height={19} rx={5} fill="none" stroke={n.accent} strokeWidth={1.3} />
      <circle cx={n.cx - 5} cy={n.cy - 2} r={2.1} fill={n.accent} />
      <circle cx={n.cx + 5} cy={n.cy - 2} r={2.1} fill={n.accent} />
      <line x1={n.cx - 4} y1={n.cy + 4} x2={n.cx + 4} y2={n.cy + 4} stroke={n.accent} strokeWidth={1.3} strokeLinecap="round" />
      <text x={n.cx} y={n.cy + n.r + 15} fontSize={13} fontWeight={600} fill="currentColor" textAnchor="middle">{name}</text>
      <text x={n.cx} y={n.cy + n.r + 29} fontSize={9} fontFamily="ui-monospace, monospace" fill="currentColor" fillOpacity={0.6} textAnchor="middle">
        LEI {shortLei(lei, 8)}
      </text>
      <text x={n.cx} y={n.cy + n.r + 41} fontSize={8.5} fontFamily="ui-monospace, monospace" fill={n.accent} fillOpacity={0.85} textAnchor="middle">
        AID {ownAid === 'n/a' ? 'n/a' : ownAid.slice(0, 12) + '…'}
      </text>
    </g>
  );
}

// Map a real message type → category label + colour. Derived ONLY from the
// verified envelope's payload type (real data) — no invented categories.
function category(msgType: string): { label: string; color: string } {
  const t = (msgType || '').toUpperCase();
  if (t.includes('ESCALAT')) return { label: 'escalation', color: '#f97316' };
  if (t.includes('REJECT'))  return { label: 'rejection',  color: '#ef4444' };
  if (t.includes('DD') || t.includes('INVOICE')) return { label: 'DD', color: '#d97706' };
  if (t.includes('ACCEPT'))  return { label: 'accept',     color: '#10b981' };
  if (t.includes('PURCHASE') || t.includes('ORDER') || t === 'PO') return { label: 'order', color: '#06b6d4' };
  if (t.includes('OFFER') || t.includes('COUNTER')) return { label: 'message', color: '#3b82f6' };
  return { label: 'message', color: '#94a3b8' };
}

// ─── A single step node — a category-coloured envelope ───────────────────────

function StepNode({ tick, x, y, index, onHover }: {
  tick: VerifyTick; x: number; y: number; index: number; onHover: (t: VerifyTick | null) => void;
}) {
  const ref = useRef<SVGGElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current; if (!el || prefersReduced()) return;
    gsap.from(el, { scale: 0, opacity: 0, duration: 0.34, ease: 'back.out(2.6)', transformOrigin: '50% 50%' });
  }, []);
  const ok = tick.valid;
  const cat = category(tick.msgType);
  const color = ok ? cat.color : '#ef4444';
  return (
    <g ref={ref} style={{ cursor: 'pointer', pointerEvents: 'auto' }} onMouseEnter={() => onHover(tick)} onMouseLeave={() => onHover(null)}>
      {/* envelope body + flap */}
      <rect x={x - 16} y={y - 11} width={32} height={22} rx={3} fill={color} fillOpacity={0.14} stroke={color} strokeOpacity={0.7} strokeWidth={1.3} />
      <polyline points={`${x - 16},${y - 11} ${x},${y + 2} ${x + 16},${y - 11}`} fill="none" stroke={color} strokeOpacity={0.7} strokeWidth={1} strokeLinejoin="round" />
      {/* verified / rejected badge */}
      <circle cx={x + 14} cy={y + 11} r={6.5} fill={ok ? '#10b981' : '#ef4444'} />
      <text x={x + 14} y={y + 11} fontSize={9} fontWeight={700} fill="#ffffff" textAnchor="middle" dominantBaseline="central">{ok ? '✓' : '✗'}</text>
      {/* index badge */}
      <text x={x - 16} y={y - 15} fontSize={9} fontWeight={700} fill={color} textAnchor="start">{index + 1}</text>
      {/* category name */}
      <text x={x} y={y + 24} fontSize={8.5} fontFamily="ui-monospace, monospace" fill={color} fillOpacity={0.95} textAnchor="middle">{cat.label}</text>
      {/* hover hit area */}
      <rect x={x - 22} y={y - 18} width={44} height={48} fill="transparent" />
    </g>
  );
}

// ─── Treasury anchor (seller-side) — Jupiter consults Treasury each round ────

function TreasuryAnchor({ consults }: { consults: number }) {
  const { x, y } = TREASURY;
  const c = '#a855f7';
  return (
    <g>
      {/* faint tether from the seller rail down to Treasury */}
      <line x1={x} y1={RAIL.seller.y0 + ROW_GAP} x2={x} y2={y - 14} stroke={c} strokeOpacity={0.22} strokeWidth={1} strokeDasharray="3 3" />
      <rect x={x - 16} y={y - 14} width={32} height={26} rx={5} fill={c} fillOpacity={0.1} stroke={c} strokeOpacity={0.6} strokeWidth={1.2} />
      {/* small bank glyph: roof + 3 pillars + base */}
      <path d={`M ${x - 10} ${y - 6} L ${x} ${y - 11} L ${x + 10} ${y - 6}`} fill="none" stroke={c} strokeWidth={1.2} strokeLinejoin="round" />
      <line x1={x - 7} y1={y - 4} x2={x - 7} y2={y + 5} stroke={c} strokeWidth={1.2} />
      <line x1={x} y1={y - 4} x2={x} y2={y + 5} stroke={c} strokeWidth={1.2} />
      <line x1={x + 7} y1={y - 4} x2={x + 7} y2={y + 5} stroke={c} strokeWidth={1.2} />
      <line x1={x - 10} y1={y + 7} x2={x + 10} y2={y + 7} stroke={c} strokeWidth={1.2} />
      <text x={x} y={y + 22} fontSize={8.5} fontFamily="ui-monospace, monospace" fill={c} textAnchor="middle">Treasury ({consults})</text>
    </g>
  );
}

// ─── Hopping envelope — flies node N-1 → N on each new verification ──────────
// When `via` is provided (seller side with a real Treasury consult), the hop
// detours through that point first — "routed via Treasury this round".

function HopEnvelope({ side, count, via }: { side: Side; count: number; via?: { x: number; y: number } }) {
  const ref = useRef<SVGGElement | null>(null);
  const prev = useRef(0);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) { prev.current = count; return; }
    if (!prefersReduced() && count > prev.current && count >= 2) {
      const a = railPoint(RAIL[side], count - 2);
      const b = railPoint(RAIL[side], count - 1);
      if (via) {
        const tl = gsap.timeline();
        tl.set(el, { x: a.x, y: a.y, opacity: 1 });
        tl.to(el, { x: via.x, y: via.y, duration: 0.42, ease: 'power1.in' });
        tl.to(el, { x: b.x, y: b.y, opacity: 0, duration: 0.42, ease: 'power1.out' });
      } else {
        gsap.fromTo(el, { x: a.x, y: a.y, opacity: 1 }, { x: b.x, y: b.y, opacity: 0, duration: 0.6, ease: 'power1.inOut' });
      }
    }
    prev.current = count;
  }, [count]);
  return (
    <g ref={ref} opacity={0} style={{ pointerEvents: 'none' }}>
      <rect x={-7} y={-5} width={14} height={10} rx={2} fill="#10b981" opacity={0.9} />
      <polyline points="-7,-5 0,1 7,-5" fill="none" stroke="#ffffff" strokeOpacity={0.7} strokeWidth={0.8} />
    </g>
  );
}

// ─── One side's journey (rail + nodes + progressive draw + outcome flag) ─────

function SideJourney({ side, trust, onHover }: { side: Side; trust: SideTrust; onHover: (t: VerifyTick | null) => void }) {
  const rail = RAIL[side];
  const steps = trust.ticks;
  const labelX = side === 'buyer' ? rail.x0 - 10 : rail.x1 + 10;
  const labelAnchor = side === 'buyer' ? 'start' : 'end';
  const outcomeVisible = (trust.dealClosed || trust.escalated) && trust.negotiationId;
  const verifierLabel = side === 'buyer' ? 'Buyer vLEI agent · verifying seller' : 'Seller vLEI agent · verifying buyer';
  const railColor = steps.some(t => !t.valid) ? '#ef4444' : '#10b981';

  // Connector segments: link consecutive nodes. Same-row links run straight
  // across; a wrap (col 2 → col 0 on the next row) drops down then back, drawn
  // as a simple two-leg path so 1→2→3 ↘ 4→5→6 reads clearly.
  const segments = steps.slice(1).map((_, k) => {
    const a = railPoint(rail, k);
    const b = railPoint(rail, k + 1);
    if (a.row === b.row) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
    const midY = (a.y + b.y) / 2;
    return `M ${a.x} ${a.y} L ${a.x} ${midY} L ${b.x} ${midY} L ${b.x} ${b.y}`;
  });

  return (
    <g>
      <text x={labelX} y={rail.y0 - 22} fontSize={10} fontWeight={600} fill="currentColor" fillOpacity={0.7} textAnchor={labelAnchor}>
        {verifierLabel} ({steps.length})
      </text>
      {segments.map((d, k) => (
        <path key={k} d={d} fill="none" stroke={railColor} strokeOpacity={0.4} strokeWidth={1.4} />
      ))}
      {steps.map((t, i) => { const p = railPoint(rail, i); return <StepNode key={t.eventId} tick={t} x={p.x} y={p.y} index={i} onHover={onHover} />; })}
      {side === 'seller' && trust.treasuryConsults > 0 && <TreasuryAnchor consults={trust.treasuryConsults} />}
      <HopEnvelope side={side} count={steps.length} via={side === 'seller' && trust.treasuryConsults > 0 ? TREASURY : undefined} />
      {steps.length === 0 && (
        <text x={side === 'buyer' ? rail.x0 : rail.x1} y={rail.y0} fontSize={11} fontStyle="italic" fill="currentColor" fillOpacity={0.4} textAnchor={labelAnchor}>
          awaiting verified messages…
        </text>
      )}
      {outcomeVisible && steps.length > 0 && (() => {
        const p = railPoint(rail, steps.length - 1);
        const c = trust.dealClosed ? '#10b981' : '#d97706';
        return (
          <g>
            <line x1={p.x + 24} y1={p.y - 16} x2={p.x + 24} y2={p.y + 16} stroke={c} strokeWidth={1.2} />
            <path d={`M ${p.x + 24} ${p.y - 16} l 20 5 l -20 5 z`} fill={c} fillOpacity={0.7} />
          </g>
        );
      })()}
    </g>
  );
}

// ─── Travel pulse (principal → its vLEI panel) on each new verification ──────

function TravelPulse({ side, count }: { side: Side; count: number }) {
  const ref = useRef<SVGCircleElement | null>(null);
  const prev = useRef(0);
  const n = NODE[side], box = PANEL[side];
  const fromX = n.cx, fromY = n.cy - n.r;
  const toX = side === 'buyer' ? box.x + 26 : box.x + box.w - 26;
  const toY = box.y + box.h;
  useLayoutEffect(() => {
    const el = ref.current; if (!el) { prev.current = count; return; }
    if (!prefersReduced() && count > prev.current) {
      gsap.fromTo(el, { attr: { cx: fromX, cy: fromY }, opacity: 0.9 },
        { attr: { cx: toX, cy: toY }, opacity: 0, duration: 0.75, ease: 'power1.inOut' });
    }
    prev.current = count;
  }, [count]);
  return <circle ref={ref} r={4} fill={n.accent} opacity={0} cx={fromX} cy={fromY} />;
}

// ─── HTML detail card for a side ─────────────────────────────────────────────

function DetailCard({ side, shown, hovering }: { side: Side; shown: VerifyTick; hovering: boolean }) {
  const counterparty = side === 'buyer' ? 'seller' : 'buyer';
  return (
    <div className={`absolute ${side === 'buyer' ? 'left-2' : 'right-2'} bottom-12 w-[230px] rounded-md border border-border bg-card/90 backdrop-blur p-2 text-[9px] font-mono leading-relaxed pointer-events-auto`}>
      <div className="text-muted-foreground/70">{hovering ? 'verifying message' : 'last verified'} #{shown.counter}</div>
      <div>type: <span className="text-foreground">{shown.msgType}</span></div>
      <div>hash: <span className="text-foreground">{shown.payloadHash}…</span></div>
      <div className="truncate" title={shown.aid}>{counterparty} AID: <span className="text-foreground">{shown.aid}</span></div>
      <div className={shown.mode === 'kram' ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-300'}>
        {shown.mode === 'kram' ? 'KERI Ed25519 verified' : 'hash-envelope (plain — not a KERI signature)'}
      </div>
      <div className="text-muted-foreground/60">{shown.ts}</div>
    </div>
  );
}

function AuditBox({ neg, status }: { neg: string; status: 'closed' | 'escalated' }) {
  const base = `${BACKENDS.buyer}/api/quality/${neg}`;
  const tile = 'flex flex-col items-center justify-center w-12 h-12 rounded-md border border-border hover:border-emerald-500/60 hover:bg-emerald-500/5 transition-colors text-emerald-600 dark:text-emerald-300';
  // Both sides are served from the buyer's port (:9090) — that process owns the
  // shared per-deal audit folder. Buyer = buyer.audit.json; Seller = seller.audit.json.
  const sideGroup = (label: string, jsonHref: string, pdfHref: string) => (
    <div className="flex flex-col items-center gap-1">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="flex gap-2">
        <a href={jsonHref} target="_blank" rel="noreferrer" className={tile} title={`${label} audit JSON`}>
          <span className="text-base leading-none">{'{ }'}</span>
          <span className="text-[10px] font-mono mt-0.5">JSON</span>
        </a>
        <a href={pdfHref} target="_blank" rel="noreferrer" className={tile} title={`${label} audit PDF`}>
          <span className="text-base leading-none">↓</span>
          <span className="text-[10px] font-mono mt-0.5">PDF</span>
        </a>
      </div>
    </div>
  );
  return (
    <div className="absolute left-1/2 -translate-x-1/2 bottom-3 pointer-events-auto">
      <div className="rounded-lg border border-border bg-card/90 backdrop-blur px-4 py-2 text-center">
        <div className="text-[10px] font-semibold text-foreground">
          Audit <span className={status === 'closed' ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-300'}>· {status}</span>
        </div>
        <div className="mt-1.5 flex gap-6 justify-center">
          {sideGroup('Buyer',  base,             `${base}/pdf`)}
          <div className="w-px self-stretch bg-border" />
          {sideGroup('Seller', `${base}/seller`, `${base}/seller/pdf`)}
        </div>
        <div className="mt-1 text-[8px] font-mono text-muted-foreground/60">{neg}</div>
      </div>
    </div>
  );
}

// ─── Public component ────────────────────────────────────────────────────────

export function TrustSpine({ events, vleiReachable = true, viewBox = '0 0 1000 600' }: { events: LogEvent[]; vleiReachable?: boolean; viewBox?: string }) {
  const { buyer, seller } = useMemo(() => deriveTrust(events), [events]);
  const [hoverBuyer, setHoverBuyer] = useState<VerifyTick | null>(null);
  const [hoverSeller, setHoverSeller] = useState<VerifyTick | null>(null);

  // A principal's OWN live AID = the verified-sender AID on the OTHER side's
  // ticks (that side verified messages whose sender is this principal).
  const tommyAid   = seller.ticks.length ? seller.ticks[seller.ticks.length - 1].aid : 'n/a';
  const jupiterAid = buyer.ticks.length  ? buyer.ticks[buyer.ticks.length - 1].aid  : 'n/a';

  // Hover-only details: the detail card appears ONLY while the pointer is over
  // a specific envelope chip; nothing is shown otherwise (no persistent
  // "last verified" card). The per-chip pointerEvents:'auto' on each StepNode
  // re-enables hover through the otherwise pointer-events-none overlay.
  const shownBuyer  = hoverBuyer;
  const shownSeller = hoverSeller;

  // Audit box appears only at the END — after the full buyer-side flow incl.
  // the final DD invoice. The terminal message is DD_INVOICE (seller→buyer);
  // the buyer verifies it, so it lands as a buyer-side verify tick. We gate on
  // that, NOT on "Deal Closed" (✓✓) which fires back at ACCEPT — long before
  // PO / INVOICE / DD_OFFER / DD_ACCEPT / DD_INVOICE. Escalation has no DD
  // stage, so it still surfaces the audit immediately.
  const ddInvoiceVerified = buyer.ticks.some(t => /DD[_-]?INVOICE/i.test(t.msgType));
  const anyEscalated = buyer.escalated || seller.escalated;
  const auditNeg = buyer.negotiationId || seller.negotiationId;
  const showAudit = (ddInvoiceVerified || anyEscalated) && !!auditNeg;
  const auditStatus: 'closed' | 'escalated' = ddInvoiceVerified ? 'closed' : 'escalated';

  return (
    <div className="absolute inset-0 pointer-events-none">
      <svg viewBox={viewBox} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 w-full h-full text-foreground">
        {/* faint center divider — the two-sided split */}
        <line x1={500} y1={224} x2={500} y2={470} stroke="currentColor" strokeOpacity={0.07} strokeWidth={1} strokeDasharray="2 6" />

        {/* connectors: principal → its vLEI panel */}
        <path d={`M ${NODE.buyer.cx} ${NODE.buyer.cy - NODE.buyer.r} C ${NODE.buyer.cx} ${NODE.buyer.cy - NODE.buyer.r - 14}, ${PANEL.buyer.x + 26} ${PANEL.buyer.y + PANEL.buyer.h + 14}, ${PANEL.buyer.x + 26} ${PANEL.buyer.y + PANEL.buyer.h}`}
          fill="none" stroke={NODE.buyer.accent} strokeOpacity={0.22} strokeWidth={1} strokeDasharray="4 4" />
        <path d={`M ${NODE.seller.cx} ${NODE.seller.cy - NODE.seller.r} C ${NODE.seller.cx} ${NODE.seller.cy - NODE.seller.r - 14}, ${PANEL.seller.x + PANEL.seller.w - 26} ${PANEL.seller.y + PANEL.seller.h + 14}, ${PANEL.seller.x + PANEL.seller.w - 26} ${PANEL.seller.y + PANEL.seller.h}`}
          fill="none" stroke={NODE.seller.accent} strokeOpacity={0.22} strokeWidth={1} strokeDasharray="4 4" />

        {/* vLEI Agent core (vLEI mode only; plain mode keeps the stage lock) */}
        {vleiReachable && (
          <g>
            <rect x={CORE.x} y={CORE.y} width={CORE.w} height={CORE.h} rx={12} fill="currentColor" fillOpacity={0.04} stroke="currentColor" strokeOpacity={0.25} strokeWidth={1} />
            <text x={CORE.x + CORE.w / 2} y={CORE.y + 20} fontSize={13} fontWeight={600} fill="currentColor" fillOpacity={0.9} textAnchor="middle">vLEI Agent</text>
            <VleiPanel side="buyer"  verified={buyer.identityVerified}  mode={buyer.identityMode}  script={buyer.identityScript}  count={buyer.ticks.length} />
            <VleiPanel side="seller" verified={seller.identityVerified} mode={seller.identityMode} script={seller.identityScript} count={seller.ticks.length} />
          </g>
        )}

        {/* travel pulses */}
        <TravelPulse side="buyer"  count={buyer.ticks.length} />
        <TravelPulse side="seller" count={seller.ticks.length} />

        {/* principals */}
        <PrincipalNode side="buyer"  ownAid={tommyAid} />
        <PrincipalNode side="seller" ownAid={jupiterAid} />

        {/* journeys (mirrored, each fed its own live data) */}
        <SideJourney side="buyer"  trust={buyer}  onHover={setHoverBuyer} />
        <SideJourney side="seller" trust={seller} onHover={setHoverSeller} />
      </svg>

      {shownBuyer  && <DetailCard side="buyer"  shown={shownBuyer}  hovering={!!hoverBuyer} />}
      {shownSeller && <DetailCard side="seller" shown={shownSeller} hovering={!!hoverSeller} />}
      {showAudit && <AuditBox neg={auditNeg} status={auditStatus} />}
    </div>
  );
}
