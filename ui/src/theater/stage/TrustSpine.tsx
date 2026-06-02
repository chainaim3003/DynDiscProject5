/**
 * TrustSpine — two "vLEI Agent" boxes flanking the centre spine that make the
 * ALREADY-PROVEN kram + vLEI two-layer security visible, live, from real SSE.
 * ---------------------------------------------------------------------------
 * NOTHING here is mocked. Every value is derived from LogEvents the backend
 * actually broadcasts:
 *
 *   1. One-time vLEI IDENTITY CEREMONY (chain unfurl → shield) per side, fired
 *      when that side's identity-verification line arrives over SSE:
 *        buyer  : "✅ Seller vLEI delegation chain verified (…)"  (from=BUYER)
 *        seller : "✅ Buyer  vLEI delegation chain verified (…)"  (from=SELLER,
 *                  added in seller-agent handleBuyerOffer)
 *      Matches the same patterns useVerificationRiver uses
 *      (/delegation chain verified/i, /identity check passed/i).
 *
 *   2. Per-message KRAM TICK rail, fired on every `[verify] ✓ …` line both
 *      agents now emit at the envelope-verify success site:
 *        [verify] ✓ counter=<n> type=<TYPE> payloadHash=<12hex>
 *                 aid=<senderAid> mode=<kram|plain> neg=<NEG-id> valid=true
 *      `aid` is the LIVE, per-message-verified sender AID (envelope.senderAid),
 *      NOT the stale identities.ts agentAID. The box's static LEI comes from
 *      IDENTITIES (those LEIs are correct); the live AID comes from the wire.
 *
 * Cross-verify across the spine (per the feature spec): the BUYER box renders
 * the ticks the buyer agent emitted (it verifies SELLER messages → each tick's
 * verified-sender AID is the seller's); the SELLER box renders the seller
 * agent's ticks (verifying BUYER messages → buyer's AID).
 *
 * On deal close (Deal Closed / ✓✓), a link to the real audit the buyer agent
 * wrote is shown — http://localhost:9090/api/quality/<negId>{,/pdf} — using the
 * negotiationId captured live from the tick stream.
 *
 * Escalation human-icon = Phase 2 (backend doesn't emit it yet) — deferred.
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
  msgType: string;        // OFFER | COUNTER_OFFER | ACCEPT_OFFER | PURCHASE_ORDER | DD_* | …
  payloadHash: string;    // first 12 hex chars
  aid: string;            // LIVE verified sender AID (or "n/a" in plain mode)
  mode: string;           // kram | plain
  neg: string;            // NEG-… (may be "")
  valid: boolean;
  ts: string;             // ISO timestamp from the agent
}

const IDENTITY_VERIFIED = /delegation chain verified/i;
const IDENTITY_PLAIN     = /identity check passed/i;
const DEAL_CLOSED        = /(Deal Closed|✓✓|DEAL CLOSED)/;
const ESCALATED          = /(escalat|NO DEAL)/i;   // escalation also writes an audit JSON

/** Parse a `[verify] ✓ …` tick line. Returns null for any other text. */
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
  identityMode: 'vlei' | 'plain' | null;   // vlei = full chain, plain = GLEIF-only
  identityText: string;
  ticks: VerifyTick[];                      // newest last
  negotiationId: string;
  dealClosed: boolean;
  escalated: boolean;
}

const emptySide = (): SideTrust => ({
  identityVerified: false,
  identityMode: null,
  identityText: '',
  ticks: [],
  negotiationId: '',
  dealClosed: false,
  escalated: false,
});

/**
 * Fold the event log into per-side trust state. Pure + idempotent: re-running
 * over the same events yields the same state, so it is safe to recompute on
 * every render via useMemo. A change of negotiationId resets that side's ticks
 * (a fresh negotiation starts a fresh rail).
 */
function deriveTrust(events: LogEvent[]): { buyer: SideTrust; seller: SideTrust } {
  const buyer = emptySide();
  const seller = emptySide();

  for (const ev of events) {
    if (ev.kind !== 'sse') continue;
    const side = ev.payload.from === 'BUYER' ? buyer
               : ev.payload.from === 'SELLER' ? seller
               : null;
    if (!side) continue;                       // ignore TREASURY channel here
    const text = ev.payload.text;

    // ── per-message KRAM tick ──
    const tick = parseVerifyTick(ev.id, text, ev.payload.rawTimestamp);
    if (tick) {
      if (tick.neg && tick.neg !== side.negotiationId) {
        // New negotiation on this side — reset the rail + ceremony state.
        side.negotiationId = tick.neg;
        side.ticks = [];
        side.dealClosed = false;
        side.escalated = false;
      }
      // Dedup by counter (SSE/StrictMode can double-deliver).
      if (!side.ticks.some(t => t.counter === tick.counter)) {
        side.ticks = [...side.ticks, tick].sort((a, b) => a.counter - b.counter);
      }
      continue;
    }

    // ── one-time identity ceremony trigger ──
    if (IDENTITY_VERIFIED.test(text)) {
      side.identityVerified = true;
      side.identityMode = 'vlei';
      side.identityText = text;
    } else if (IDENTITY_PLAIN.test(text)) {
      side.identityVerified = true;
      side.identityMode = 'plain';
      side.identityText = text;
    }

    // ── deal close / escalation → reveal audit link (both write an audit JSON) ──
    if (DEAL_CLOSED.test(text)) side.dealClosed = true;
    if (ESCALATED.test(text)) side.escalated = true;
  }

  return { buyer, seller };
}

// ─── Identity ceremony (chain unfurl → shield), GSAP, plugin-free ───────────

function IdentityCeremony({ played, mode }: { played: boolean; mode: 'vlei' | 'plain' | null }) {
  const chainRef = useRef<SVGPathElement | null>(null);
  const shieldRef = useRef<SVGGElement | null>(null);

  useLayoutEffect(() => {
    const chain = chainRef.current;
    const shield = shieldRef.current;
    if (!chain || !shield) return;
    if (!played) {
      gsap.set(chain, { strokeDashoffset: 1 });
      gsap.set(shield, { opacity: 0, scale: 0.4, transformOrigin: '50% 50%' });
      return;
    }
    // Chain unfurls (dash-offset, no premium plugin), then the shield clicks in.
    const tl = gsap.timeline();
    tl.fromTo(chain, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.7, ease: 'power2.inOut' })
      .fromTo(
        shield,
        { opacity: 0, scale: 0.4, transformOrigin: '50% 50%' },
        { opacity: 1, scale: 1, duration: 0.45, ease: 'back.out(2.2)' },
        '-=0.15',
      );
    return () => { tl.kill(); };
  }, [played]);

  const stroke = played ? (mode === 'plain' ? '#d97706' : '#10b981') : 'currentColor';

  return (
    <svg viewBox="0 0 120 28" className="w-full h-7" aria-hidden>
      {/* chain: three links drawn as one dashed path that "unfurls" */}
      <path
        ref={chainRef}
        d="M 6 14 q 12 -10 24 0 q 12 10 24 0 q 12 -10 24 0"
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        strokeLinecap="round"
        pathLength={1}
        style={{ strokeDasharray: 1, strokeDashoffset: 1, opacity: played ? 0.9 : 0.25, transition: 'opacity 200ms' }}
      />
      {/* shield, fades/clicks in at the end of the chain */}
      <g ref={shieldRef} style={{ opacity: 0 }}>
        <path
          d="M 100 4 l 12 4 v 7 c 0 6 -5 9 -12 11 c -7 -2 -12 -5 -12 -11 v -7 z"
          fill={mode === 'plain' ? 'rgba(217,119,6,0.15)' : 'rgba(16,185,129,0.15)'}
          stroke={mode === 'plain' ? '#d97706' : '#10b981'}
          strokeWidth={1.4}
        />
        <path d="M 94 14 l 4 4 l 8 -8" fill="none" stroke={mode === 'plain' ? '#d97706' : '#10b981'} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

// ─── Per-message tick chip with rich hover ──────────────────────────────────

function TickChip({
  tick,
  counterpartyLabel,
  onHover,
}: {
  tick: VerifyTick;
  counterpartyLabel: string;
  onHover: (t: VerifyTick | null) => void;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    if (ref.current) {
      gsap.from(ref.current, { scale: 0, opacity: 0, duration: 0.32, ease: 'back.out(2.4)' });
    }
  }, []);
  const ok = tick.valid;
  return (
    <button
      ref={ref}
      type="button"
      onMouseEnter={() => onHover(tick)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(tick)}
      onBlur={() => onHover(null)}
      className={[
        'relative flex items-center justify-center w-6 h-6 rounded-md border text-[10px] font-mono font-bold',
        ok
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
          : 'border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-300',
      ].join(' ')}
      title={`#${tick.counter} ${tick.msgType} — ${ok ? 'KERI Ed25519 verified' : 'REJECTED'} (verified sender ${counterpartyLabel})`}
      aria-label={`Verified message ${tick.counter}, ${tick.msgType}`}
    >
      {ok ? '✓' : '✗'}
      <span className="absolute -bottom-1.5 -right-1.5 text-[8px] leading-none px-0.5 rounded bg-card border border-border text-muted-foreground">
        {tick.counter}
      </span>
    </button>
  );
}

// ─── One side's box ─────────────────────────────────────────────────────────

interface BoxProps {
  title: string;            // "vLEI Agent — Tommy"
  lei: string;              // box LEI (static, correct)
  trust: SideTrust;
  /** Human label for the counterparty whose messages this box verifies. */
  counterpartyLabel: string;
  side: 'left' | 'right';
}

function VleiBox({ title, lei, trust, counterpartyLabel, side }: BoxProps) {
  const [hovered, setHovered] = useState<VerifyTick | null>(null);
  const lastVerified = trust.ticks.length ? trust.ticks[trust.ticks.length - 1] : null;
  // The AID shown is the LIVE per-message-verified sender AID — falls back to
  // the most-recent tick when not hovering a specific one.
  const shownTick = hovered ?? lastVerified;

  return (
    <div
      className="pointer-events-auto absolute z-20 w-[224px] rounded-lg border border-border bg-card/85 backdrop-blur-md shadow-lg p-3 text-foreground"
      style={{ top: 64, [side === 'left' ? 'left' : 'right']: 8 } as React.CSSProperties}
    >
      {/* header */}
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold tracking-tight">{title}</span>
        <span
          className={[
            'text-[9px] font-mono px-1.5 py-0.5 rounded-full border',
            trust.identityVerified
              ? trust.identityMode === 'plain'
                ? 'border-amber-500/40 text-amber-600 dark:text-amber-300'
                : 'border-emerald-500/40 text-emerald-600 dark:text-emerald-300'
              : 'border-border text-muted-foreground',
          ].join(' ')}
        >
          {trust.identityVerified ? (trust.identityMode === 'plain' ? 'GLEIF' : 'vLEI ✓') : 'pending'}
        </span>
      </div>

      {/* LEI on the box (static, correct) */}
      <div className="mt-0.5 text-[10px] font-mono text-muted-foreground" title={`LEI ${lei}`}>
        LEI {shortLei(lei, 10)}
      </div>

      {/* one-time identity ceremony: chain unfurl → shield */}
      <div className="mt-1.5">
        <IdentityCeremony played={trust.identityVerified} mode={trust.identityMode} />
      </div>

      {/* per-message KRAM tick rail */}
      <div className="mt-1 flex items-center justify-between">
        <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/70">
          KRAM · {trust.ticks.length} verified
        </span>
        {trust.ticks.length > 0 && (
          <span className="text-[9px] font-mono text-muted-foreground/70">{trust.ticks[0]?.mode}</span>
        )}
      </div>
      <div className="mt-1 flex flex-wrap gap-1 min-h-[24px]">
        {trust.ticks.length === 0 && (
          <span className="text-[10px] text-muted-foreground/50 italic">awaiting messages…</span>
        )}
        {trust.ticks.map(t => (
          <TickChip key={t.eventId} tick={t} counterpartyLabel={counterpartyLabel} onHover={setHovered} />
        ))}
      </div>

      {/* hover detail (current message) / last-verified summary */}
      {shownTick && (
        <div className="mt-2 rounded-md border border-border bg-background/60 p-1.5 text-[9px] font-mono leading-relaxed">
          <div className="text-muted-foreground/70">
            {hovered ? 'message' : 'last verified'} #{shownTick.counter}
          </div>
          <div>type: <span className="text-foreground">{shownTick.msgType}</span></div>
          <div>hash: <span className="text-foreground">{shownTick.payloadHash}…</span></div>
          <div className="truncate" title={shownTick.aid}>
            sender AID: <span className="text-foreground">{shownTick.aid}</span>
          </div>
          <div className={shownTick.mode === 'kram' ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-300'}>
            {shownTick.mode === 'kram' ? 'KERI Ed25519 verified' : 'hash-envelope (plain — not a KERI signature)'}
          </div>
          <div className="text-muted-foreground/60">{shownTick.ts}</div>
        </div>
      )}

      {/* audit link on deal close OR escalation (both write an audit JSON) */}
      {(trust.dealClosed || trust.escalated) && trust.negotiationId && (
        <div className="mt-2 flex items-center gap-2 text-[10px]">
          <span className="text-muted-foreground/60">{trust.dealClosed ? 'closed' : 'escalated'} ·</span>
          <a
            href={`${BACKENDS.buyer}/api/quality/${trust.negotiationId}`}
            target="_blank"
            rel="noreferrer"
            className="underline text-emerald-600 dark:text-emerald-300 hover:opacity-80"
          >
            audit JSON
          </a>
          <a
            href={`${BACKENDS.buyer}/api/quality/${trust.negotiationId}/pdf`}
            target="_blank"
            rel="noreferrer"
            className="underline text-emerald-600 dark:text-emerald-300 hover:opacity-80"
          >
            PDF
          </a>
          <span className="text-muted-foreground/60 font-mono">{trust.negotiationId}</span>
        </div>
      )}
    </div>
  );
}

// ─── Public component ───────────────────────────────────────────────────────

export function TrustSpine({ events }: { events: LogEvent[] }) {
  const { buyer, seller } = useMemo(() => deriveTrust(events), [events]);

  // Buyer box verifies SELLER's messages → counterparty = Jupiter (seller).
  // Seller box verifies BUYER's messages  → counterparty = Tommy  (buyer).
  return (
    <>
      <VleiBox
        side="left"
        title={`vLEI Agent — Tommy`}
        lei={IDENTITIES.buyer.lei}
        trust={buyer}
        counterpartyLabel={IDENTITIES.seller.shortName}
      />
      <VleiBox
        side="right"
        title={`vLEI Agent — Jupiter`}
        lei={IDENTITIES.seller.lei}
        trust={seller}
        counterpartyLabel={IDENTITIES.buyer.shortName}
      />
    </>
  );
}
