"use client";
import React from "react";
import type { Severity, Trust } from "@/lib/types";
import { STATUS_COLOR, STATUS_ICON, ZONE_COLOR } from "@/lib/palette";
import { MARK } from "@/lib/scales";

/* ------------------------------------------------------------------ Card */
export function Card({ title, sub, right, children, pad = true, edge, className = "" }: {
  title?: string; sub?: string; right?: React.ReactNode;
  children?: React.ReactNode; pad?: boolean;
  /** status edge-bar: 3px on the left. Status NEVER fills a card. */
  edge?: Severity; className?: string;
}) {
  return (
    <section className={`card relative overflow-hidden ${className}`}>
      {edge && (
        <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[3px]"
              style={{ background: STATUS_COLOR[edge] }} />
      )}
      {(title || right) && (
        <header className="flex items-baseline justify-between gap-3 px-4 pt-3 pb-2">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-[650] tracking-[-0.2px] truncate">{title}</h2>}
            {sub && <p className="text-[11px] text-[var(--muted)] mt-0.5">{sub}</p>}
          </div>
          {right && <div className="shrink-0 text-[11px] text-[var(--muted)]">{right}</div>}
        </header>
      )}
      <div className={pad ? "px-4 pb-4" : ""}>{children}</div>
    </section>
  );
}

/* -------------------------------------------------------------- StatTile */
export function StatTile({ label, value, unit, delta, deltaGood, spark, tone, sub, source, sourceNote }: {
  label: string; value: React.ReactNode; unit?: string;
  delta?: number; deltaGood?: "up" | "down";
  spark?: number[]; tone?: string; sub?: string;
  /** which channel produced this number — see <Source> */
  source?: SourceKind | SourceKind[]; sourceNote?: string;
}) {
  const dir = delta === undefined ? 0 : Math.sign(delta);
  const good = deltaGood === "down" ? dir < 0 : dir > 0;
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className="text-[11px] text-[var(--muted)] leading-tight flex items-center gap-1.5 flex-wrap">
        {label}{source && <Source from={source} note={sourceNote} />}
      </span>
      <span className="flex items-baseline gap-1.5 min-w-0">
        {/* proportional figures: tabular-nums makes a big number look loose */}
        <span className="text-[28px] font-[620] leading-none truncate"
              style={tone ? { color: tone } : undefined}>{value}</span>
        {unit && <span className="text-[11px] text-[var(--muted)]">{unit}</span>}
      </span>
      {delta !== undefined && (
        <span className="text-[11px] tnum" style={{ color: dir === 0 ? "var(--muted)" : good ? "var(--good)" : "var(--critical)" }}>
          {dir > 0 ? "▲" : dir < 0 ? "▼" : "—"} {Math.abs(delta).toFixed(1)}%
        </span>
      )}
      {sub && <span className="text-[11px] text-[var(--muted)]">{sub}</span>}
      {spark && <Sparkline values={spark} h={22} />}
    </div>
  );
}

/* ------------------------------------------------------------ HeroFigure */
export function HeroFigure({ value, unit, label, sub }: {
  value: React.ReactNode; unit?: string; label: string; sub?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1 py-1">
      <span className="flex items-baseline gap-2">
        <span className="hero">{value}</span>
        {unit && <span className="text-[13px] text-[var(--muted)]">{unit}</span>}
      </span>
      <span className="text-[12px] text-[var(--ink-2)]">{label}</span>
      {sub && <span className="text-[11px] text-[var(--muted)] tnum">{sub}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ Meter
   Severity rides the FILL; the track is chrome.

   Two things were wrong here. The track was --q700 — the darkest step of the
   data ramp — which on a light surface is near-black, so Quality, which has
   NO SOURCE and therefore no value at all, rendered as a solid dark bar and
   read as 100%: the one number on the page we cannot know looked like the
   best one. And "no value" and "zero" drew identically.

   So: the track wears --track, and an unmeasurable value gets a hatched
   track and no fill, which cannot be mistaken for a reading. */
export function Meter({ label, value, max = 100, tone, note }: {
  label: string; value: number | null; max?: number; tone?: string; note?: string;
}) {
  const unknown = value === null;
  const pctv = unknown ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  const color = tone ?? (pctv >= 85 ? "var(--good)" : pctv >= 60 ? "var(--warning)" : "var(--serious)");
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] text-[var(--ink-2)]">{label}</span>
        <span className="text-[13px] readout">
          {unknown
            ? <span className="text-[var(--muted)] text-[11px]">no source</span>
            : `${value.toFixed(1)}%`}
        </span>
      </div>
      <div className="h-[6px] rounded-full overflow-hidden"
           role="img"
           aria-label={unknown ? `${label}: no source` : `${label}: ${value.toFixed(1)} percent`}
           style={unknown
             ? { background: "var(--track)",
                 backgroundImage: "repeating-linear-gradient(135deg, var(--hair) 0 3px, transparent 3px 6px)" }
             : { background: "var(--track)" }}>
        {!unknown && (
          <div className="h-full rounded-full transition-[width]"
               style={{ width: `${pctv}%`, background: color, transitionDuration: "var(--t-slow)",
                        transitionTimingFunction: "var(--e-out)" }} />
        )}
      </div>
      {note && <span className="text-[10px] text-[var(--muted)] leading-snug">{note}</span>}
    </div>
  );
}

/* ----------------------------------------------------------------- Source
   WHICH BOX DID THIS NUMBER COME FROM.

   Orthogonal to TrustChip, and both are needed. TrustChip answers "is this
   real or synthesised"; Source answers "which of the three channels produced
   it" — because the three disagree in kind, not just in quality:

     PLC     Omron CIO bits off the tap, polled at ~200 ms. Knows machine
             STATE, cannot see anything finer than a poll.
     VFD     Delta VFD-B Modbus registers. Knows the DRIVE — power, current,
             torque, bus. Knows nothing about parts or people.
     CAMERA  The vision pass at 25 Hz. The only channel that sees parts,
             people, sheets and the die — and the only one fast enough to
             split a 560 ms down-stroke from a 560 ms up-stroke.
     CALC    Derived from the above; the tooltip says from what.
     PLAN    A business input — a target, a tariff, a schedule. Not measured
             by anything, and not pretending to be. */
export type SourceKind = "plc" | "vfd" | "camera" | "calc" | "plan";

const SOURCE_META: Record<SourceKind, { label: string; color: string; what: string }> = {
  plc:    { label: "PLC",    color: "var(--s1)",    what: "Omron CIO tap · polled ~200 ms" },
  vfd:    { label: "VFD",    color: "var(--s7)",    what: "Delta VFD-B Modbus registers" },
  camera: { label: "CAMERA", color: "var(--s3)",    what: "vision pass over the footage · 25 Hz" },
  calc:   { label: "CALC",   color: "var(--muted)", what: "derived" },
  plan:   { label: "PLAN",   color: "var(--muted)", what: "planned value, not measured" },
};

export function Source({ from, note }: { from: SourceKind | SourceKind[]; note?: string }) {
  const kinds = Array.isArray(from) ? from : [from];
  const title = kinds.map((k) => `${SOURCE_META[k].label}: ${SOURCE_META[k].what}`).join("\n")
    + (note ? `\n${note}` : "");
  return (
    <span className="inline-flex items-center gap-[3px] align-middle" title={title}>
      {kinds.map((k) => (
        <span key={k}
              className="inline-flex items-center px-[4px] h-[13px] rounded-[2px] text-[8px] font-[700]
                         tracking-[0.06em] leading-none whitespace-nowrap"
              style={{ color: SOURCE_META[k].color,
                       background: `color-mix(in oklab, ${SOURCE_META[k].color} 12%, transparent)` }}>
          {SOURCE_META[k].label}
        </span>
      ))}
    </span>
  );
}

/* ---------------------------------------------------------------- Readout
   Mono + tabular so the digits never reflow as the value changes. */
export function Readout({ value, unit, size = 28, tone, label }: {
  value: React.ReactNode; unit?: string; size?: number; tone?: string; label?: string;
}) {
  return (
    <span className="inline-flex flex-col">
      {label && <span className="text-[11px] text-[var(--muted)]">{label}</span>}
      <span className="inline-flex items-baseline gap-1">
        <span className="readout" style={{ fontSize: size, color: tone, lineHeight: 1 }}>{value}</span>
        {unit && <span className="text-[11px] text-[var(--muted)]">{unit}</span>}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------- StatusPill
   Status colour NEVER carries meaning alone — icon + label, always. */
export function StatusPill({ severity, children, dot }: {
  severity: Severity; children: React.ReactNode; dot?: boolean;
}) {
  const c = STATUS_COLOR[severity];
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-[3px] rounded-full text-[11px] font-[550]"
          style={{ background: `color-mix(in oklab, ${c} 16%, transparent)`, color: c,
                   border: `1px solid color-mix(in oklab, ${c} 34%, transparent)` }}>
      <span aria-hidden className={dot ? "w-[6px] h-[6px] rounded-full" : ""}
            style={dot ? { background: c } : undefined}>{dot ? "" : STATUS_ICON[severity]}</span>
      {children}
    </span>
  );
}

/* --------------------------------------------------------------- TrustChip
   Rule 7: measured / inferred / simulated is visible on every number. */
const TRUST_STYLE: Record<Trust, { c: string; t: string }> = {
  measured:  { c: "var(--s3)",   t: "MEASURED" },
  inferred:  { c: "var(--s7)",   t: "INFERRED" },
  simulated: { c: "var(--muted)", t: "SIMULATED" },
};
export function TrustChip({ trust, what }: { trust: Trust; what?: string }) {
  const s = TRUST_STYLE[trust];
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-[2px] rounded text-[9px] font-[650] tracking-[0.04em]"
          style={{ color: s.c, border: `1px solid color-mix(in oklab, ${s.c} 30%, transparent)` }}>
      {what ? `${what} — ${s.t}` : s.t}
    </span>
  );
}

/* --------------------------------------------------------------- Sparkline */
export function Sparkline({ values, h = 26, color = "var(--s1)", live = false }: {
  values: number[]; h?: number; color?: string; live?: boolean;
}) {
  if (!values.length) return null;
  const w = 100, lo = Math.min(...values), hi = Math.max(...values);
  const span = hi - lo || 1;
  const pts = values.map((v, i) => [
    (i / Math.max(1, values.length - 1)) * w,
    h - 2 - ((v - lo) / span) * (h - 4),
  ]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none"
         aria-hidden className="overflow-visible">
      <path d={d} fill="none" stroke={color} strokeWidth={MARK.line * 0.75}
            strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r={2.6} fill={color}
              className={live ? "breathing" : ""} />
    </svg>
  );
}

/* ------------------------------------------------------------------ Legend
   Always present for >= 2 series. Mirrors the mark: rect for bars/areas,
   line for lines. Text wears TEXT tokens, never the series colour. */
export function Legend({ items, kind = "rect" }: {
  items: { label: string; color: string }[]; kind?: "rect" | "line";
}) {
  if (items.length < 2) return null;   // one series needs no legend; the title names it
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 list-none m-0 p-0">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5 text-[11px] text-[var(--ink-2)]">
          <span aria-hidden style={{
            background: it.color,
            width: kind === "line" ? 12 : 9,
            height: kind === "line" ? 2 : 9,
            borderRadius: kind === "line" ? 2 : 2,
          }} />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

/* ----------------------------------------------------------- Zone badge */
export function ZoneBadge({ zone }: { zone: "A" | "B" | "C" | "D" }) {
  const c = ZONE_COLOR[zone];
  return (
    <span className="inline-flex items-center justify-center w-[20px] h-[18px] rounded text-[10px] font-[700]"
          style={{ color: c, border: `1px solid color-mix(in oklab, ${c} 40%, transparent)`,
                   background: `color-mix(in oklab, ${c} 12%, transparent)` }}>
      {zone}
    </span>
  );
}

/* --------------------------------------------------------------- TableView
   Every chart has a table twin — nothing is gated behind a hover. */
export function TableView({ cols, rows, caption }: {
  cols: string[]; rows: (React.ReactNode)[][]; caption?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] border-collapse">
        {caption && <caption className="text-left text-[11px] text-[var(--muted)] pb-2">{caption}</caption>}
        <thead>
          <tr>{cols.map((c) => (
            <th key={c} className="text-left font-[600] text-[var(--muted)] py-1.5 px-2 whitespace-nowrap"
                style={{ borderBottom: "1px solid var(--hair)" }}>{c}</th>
          ))}</tr>
        </thead>
        <tbody className="tnum">
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => (
              <td key={j} className="py-1.5 px-2 whitespace-nowrap"
                  style={{ borderBottom: "1px solid var(--hair)" }}>{c}</td>
            ))}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* --------------------------------------------------- Collapsible details */
export function Reveal({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="group">
      <summary className="cursor-pointer text-[11px] text-[var(--muted)] hover:text-[var(--ink-2)] list-none select-none">
        <span className="inline-block transition-transform group-open:rotate-90">▸</span> {label}
      </summary>
      <div className="pt-2">{children}</div>
    </details>
  );
}
