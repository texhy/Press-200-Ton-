"use client";
import React, { useRef, useState, useCallback, useMemo } from "react";
import { scaleLinear, niceDomain, ticks, MARK } from "@/lib/scales";
import { Legend } from "@/components/ui";
import { useCursor } from "@/lib/cursor";

/* ===========================================================================
   Shared chart furniture.
   Specs are imported from MARK, never re-typed: bars <=24px with a 4px rounded
   data-end square at the baseline, 2px lines, >=8px markers, a 2px surface gap
   between touching fills, hairline SOLID gridlines (never dashed).
   =========================================================================== */

const PAD = { t: 10, r: 14, b: 22, l: 54 };

/** Ticks must never repeat a label. On a small domain (0..1) rounding to
 *  integers printed "1 1 1 0 0", so pick decimals from the tick spacing. */
function defaultTick(v: number, all: number[]): string {
  const step = all.length > 1 ? Math.abs(all[1] - all[0]) : 1;
  const dp = step >= 10 ? 0 : step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function Grid({ w, h, yTicks, y, fmt, xTicks, x, xFmt }: {
  w: number; h: number; yTicks: number[]; y: (v: number) => number;
  fmt?: (v: number) => string;
  /** X labels. Every chart here had a y-axis and no x-axis at all: xFmt was
   *  wired to the tooltip only, so a reader could see "12.4" but not whether
   *  the series ran over a day, a week or a month without hovering it. An
   *  unlabelled time axis is the single most common reason a chart "looks
   *  hard to read". */
  xTicks?: number[]; x?: (v: number) => number; xFmt?: (v: number) => string;
}) {
  return (
    <g aria-hidden>
      {yTicks.map((t) => (
        <g key={t}>
          <line x1={PAD.l} x2={w - PAD.r} y1={y(t)} y2={y(t)}
                stroke="var(--grid)" strokeWidth={1} shapeRendering="crispEdges" />
          <text x={PAD.l - 6} y={y(t)} dy="0.32em" textAnchor="end"
                fill="var(--muted)" fontSize={10} className="tnum">
            {fmt ? fmt(t) : defaultTick(t, yTicks)}
          </text>
        </g>
      ))}
      <line x1={PAD.l} x2={w - PAD.r} y1={h - PAD.b} y2={h - PAD.b}
            stroke="var(--axis)" strokeWidth={1} shapeRendering="crispEdges" />
      {xTicks && x && xFmt && xTicks.map((t, i) => {
        const px = x(t);
        // never let the first/last label hang off the plot
        const anchor = i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle";
        return (
          <text key={t} x={px} y={h - PAD.b + 13} textAnchor={anchor}
                fill="var(--muted)" fontSize={10} className="tnum">{xFmt(t)}</text>
        );
      })}
    </g>
  );
}

/** Pick ~n evenly spaced sample positions from an x array, always including
 *  the first and last so the reader can see the full extent. */
function xTickValues(x: number[], n = 5): number[] {
  if (x.length <= n) return x;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(x[Math.round((i * (x.length - 1)) / (n - 1))]);
  return [...new Set(out)];
}

/** Tooltip positioned inside the card, never clipped. */
function Tip({ x, y, w, children }: { x: number; y: number; w: number; children: React.ReactNode }) {
  const flip = x > w * 0.62;
  return (
    <div className="over absolute pointer-events-none z-20 px-2.5 py-2 text-[11px] whitespace-nowrap"
         style={{ left: flip ? undefined : x + 12, right: flip ? w - x + 12 : undefined, top: Math.max(4, y - 10) }}>
      {children}
    </div>
  );
}

function useBox() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 640, h: 180 });
  const cb = useCallback((n: HTMLDivElement | null) => {
    ref.current = n;
    if (!n) return;
    const ro = new ResizeObserver(() => {
      const r = n.getBoundingClientRect();
      if (r.width > 10) setBox({ w: r.width, h: r.height });
    });
    ro.observe(n);
    const r = n.getBoundingClientRect();
    if (r.width > 10) setBox({ w: r.width, h: r.height });
  }, []);
  return { cb, box };
}

/* ======================================================= LineChart / Area
   Crosshair finds the X; ONE tooltip lists EVERY series at that X, so the
   pointer never has to land on a line. */
export interface Series { key: string; label: string; color: string; values: number[]; dash?: boolean; area?: boolean }

/** A horizontal reference line: a target, a takt, a measured median. Drawn
 *  BEHIND the data in --axis and labelled at the right, so it reads as the
 *  chart's furniture rather than as another series competing for attention. */
export interface Rule { v: number; label: string; color?: string }

export function LineChart({ x, series, height = 180, yFmt, xFmt, legendKind = "line", stack = false, yMax, rules }: {
  x: number[]; series: Series[]; height?: number;
  yFmt?: (v: number) => string; xFmt?: (v: number) => string;
  legendKind?: "line" | "rect"; stack?: boolean; yMax?: number;
  rules?: Rule[];
}) {
  const { cb, box } = useBox();
  const [hi, setHi] = useState<number | null>(null);
  const w = box.w, h = height;

  const stacked = useMemo(() => {
    if (!stack) return null;
    const out: number[][] = [];
    for (let i = 0; i < x.length; i++) {
      let acc = 0;
      const col: number[] = [];
      for (const s of series) { acc += s.values[i] ?? 0; col.push(acc); }
      out.push(col);
    }
    return out;
  }, [stack, series, x.length]);

  const allVals = stack
    ? (stacked ?? []).map((c) => c[c.length - 1])
    : series.flatMap((s) => s.values);
  // a reference line above every data point must still be in frame, or the
  // chart silently claims the target does not exist
  const [lo, hiV] = yMax !== undefined
    ? [0, yMax]
    : niceDomain([...allVals, ...(rules ?? []).map((r) => r.v)]);
  const xs = scaleLinear().domain([x[0] ?? 0, x[x.length - 1] ?? 1]).range([PAD.l, w - PAD.r]);
  const ys = scaleLinear().domain([lo, hiV]).range([h - PAD.b, PAD.t]);
  const yT = ticks(lo, hiV, 4);

  const onMove = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = e.clientX - r.left;
    if (px < PAD.l || px > w - PAD.r) { setHi(null); return; }
    const t = xs.invert(px);
    let best = 0, bd = Infinity;
    for (let i = 0; i < x.length; i++) { const d = Math.abs(x[i] - t); if (d < bd) { bd = d; best = i; } }
    setHi(best);
  };

  return (
    <div className="flex flex-col gap-2">
      <div ref={cb} className="relative w-full" style={{ height: h }}
           onPointerMove={onMove} onPointerLeave={() => setHi(null)}>
        <svg width="100%" height={h} role="img">
          <Grid w={w} h={h} yTicks={yT} y={ys} fmt={yFmt}
                xTicks={xFmt ? xTickValues(x, w > 560 ? 6 : 3) : undefined} x={xs} xFmt={xFmt} />
          {(rules ?? []).map((r) => (
            <g key={r.label} aria-hidden>
              <line x1={PAD.l} x2={w - PAD.r} y1={ys(r.v)} y2={ys(r.v)}
                    stroke={r.color ?? "var(--axis)"} strokeWidth={1} strokeDasharray="4 3"
                    shapeRendering="crispEdges" />
              <text x={w - PAD.r} y={ys(r.v) - 4} textAnchor="end"
                    fill={r.color ?? "var(--muted)"} fontSize={9} className="tnum">{r.label}</text>
            </g>
          ))}
          {/* areas first so lines sit on top */}
          {series.map((s, si) => {
            if (!s.area && !stack) return null;
            const base = stack && si > 0 ? (i: number) => ys(stacked![i][si - 1]) : () => ys(lo);
            const top = (i: number) => ys(stack ? stacked![i][si] : s.values[i] ?? 0);
            const d = [
              ...x.map((xv, i) => `${i ? "L" : "M"}${xs(xv).toFixed(1)},${top(i).toFixed(1)}`),
              ...x.map((xv, i) => `L${xs(x[x.length - 1 - i]).toFixed(1)},${base(x.length - 1 - i).toFixed(1)}`),
              "Z",
            ].join("");
            return <path key={s.key} d={d} fill={s.color}
                         fillOpacity={stack ? 0.9 : MARK.areaOpacity}
                         stroke={stack ? "var(--surface)" : "none"} strokeWidth={stack ? MARK.gap : 0} />;
          })}
          {!stack && series.map((s) => {
            const d = x.map((xv, i) => `${i ? "L" : "M"}${xs(xv).toFixed(1)},${ys(s.values[i] ?? 0).toFixed(1)}`).join("");
            return <path key={s.key} d={d} fill="none" stroke={s.color} strokeWidth={MARK.line}
                         strokeLinejoin="round" strokeLinecap="round"
                         strokeDasharray={s.dash ? "5 4" : undefined} />;
          })}
          {hi !== null && (
            <g aria-hidden>
              <line x1={xs(x[hi])} x2={xs(x[hi])} y1={PAD.t} y2={h - PAD.b}
                    stroke="var(--hair-strong)" strokeWidth={1} shapeRendering="crispEdges" />
              {series.map((s, si) => {
                const v = stack ? stacked![hi][si] : s.values[hi] ?? 0;
                return <circle key={s.key} cx={xs(x[hi])} cy={ys(v)} r={MARK.marker / 2}
                               fill={s.color} stroke="var(--surface)" strokeWidth={MARK.gap} />;
              })}
            </g>
          )}
        </svg>
        {hi !== null && (
          <Tip x={xs(x[hi])} y={PAD.t} w={w}>
            <div className="text-[var(--muted)] mb-1 tnum">{xFmt ? xFmt(x[hi]) : x[hi]}</div>
            {series.map((s) => (
              <div key={s.key} className="flex items-center gap-2">
                <span aria-hidden style={{ background: s.color, width: 10, height: 2, borderRadius: 2 }} />
                {/* value leads, label follows — the reader has the series and wants the number */}
                <span className="font-[650] tnum">{yFmt ? yFmt(s.values[hi] ?? 0) : (s.values[hi] ?? 0).toFixed(1)}</span>
                <span className="text-[var(--muted)]">{s.label}</span>
              </div>
            ))}
          </Tip>
        )}
      </div>
      <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} kind={legendKind} />
    </div>
  );
}

/* ================================================================= Bars
   On bars the MARK is the hit target; the hovered bar lifts so it responds. */
export function BarChart({ data, height = 180, horizontal = false, yFmt, onPick, valueLabel }: {
  data: { label: string; value: number; color: string; key?: string }[];
  height?: number; horizontal?: boolean; yFmt?: (v: number) => string;
  onPick?: (k: string) => void; valueLabel?: boolean;
}) {
  const { cb, box } = useBox();
  const [hi, setHi] = useState<number | null>(null);
  const { hovered, setHovered } = useCursor();
  const w = box.w, h = height;
  const [lo, hiV] = niceDomain(data.map((d) => d.value));

  if (horizontal) {
    const L = 118;
    const xs = scaleLinear().domain([0, hiV]).range([L, w - 56]);
    const band = (h - PAD.t) / Math.max(1, data.length);
    const bh = Math.min(MARK.barMax, band - 8);
    return (
      <div className="flex flex-col gap-2">
        <div ref={cb} className="relative w-full" style={{ height: h }}>
          <svg width="100%" height={h} role="img">
            {data.map((d, i) => {
              const y = PAD.t + i * band + (band - bh) / 2;
              const bw = Math.max(0, xs(d.value) - L);
              const on = hi === i || hovered === (d.key ?? d.label);
              return (
                <g key={d.label}
                   onPointerEnter={() => { setHi(i); setHovered(d.key ?? d.label); }}
                   onPointerLeave={() => { setHi(null); setHovered(null); }}
                   onClick={() => onPick?.(d.key ?? d.label)}
                   style={{ cursor: onPick ? "pointer" : "default" }}>
                  {/* hit area is bigger than the mark */}
                  <rect x={0} y={PAD.t + i * band} width={w} height={band} fill="transparent" />
                  <text x={L - 8} y={y + bh / 2} dy="0.32em" textAnchor="end"
                        fill={on ? "var(--ink)" : "var(--ink-2)"} fontSize={11}>{d.label}</text>
                  {/* 4px rounded data-end, SQUARE at the baseline */}
                  <path d={rr(L, y, bw, bh, MARK.barRadius, "r")} fill={d.color}
                        opacity={on ? 1 : 0.86} />
                  {valueLabel !== false && (
                    <text x={L + bw + 6} y={y + bh / 2} dy="0.32em"
                          fill="var(--ink-2)" fontSize={11} className="tnum">
                      {yFmt ? yFmt(d.value) : d.value.toLocaleString("en-US")}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    );
  }

  const band = (w - PAD.l - PAD.r) / Math.max(1, data.length);
  const bw = Math.min(MARK.barMax, band - 6);
  const ys = scaleLinear().domain([lo, hiV]).range([h - PAD.b, PAD.t]);
  return (
    <div className="flex flex-col gap-2">
      <div ref={cb} className="relative w-full" style={{ height: h }}>
        <svg width="100%" height={h} role="img">
          <Grid w={w} h={h} yTicks={ticks(lo, hiV, 4)} y={ys} fmt={yFmt} />
          {data.map((d, i) => {
            const x = PAD.l + i * band + (band - bw) / 2;
            const bhh = Math.max(0, (h - PAD.b) - ys(d.value));
            const on = hi === i;
            return (
              <g key={d.label} onPointerEnter={() => setHi(i)} onPointerLeave={() => setHi(null)}>
                <rect x={PAD.l + i * band} y={PAD.t} width={band} height={h - PAD.b - PAD.t} fill="transparent" />
                <path d={rr(x, ys(d.value), bw, bhh, MARK.barRadius, "t")} fill={d.color} opacity={on ? 1 : 0.86} />
                {data.length <= 14 && (
                  <text x={x + bw / 2} y={h - PAD.b + 12} textAnchor="middle"
                        fill="var(--muted)" fontSize={10}>{d.label}</text>
                )}
              </g>
            );
          })}
        </svg>
        {hi !== null && (
          <Tip x={PAD.l + hi * band + band / 2} y={ys(data[hi].value)} w={w}>
            <span className="font-[650] tnum">{yFmt ? yFmt(data[hi].value) : data[hi].value.toLocaleString("en-US")}</span>
            <span className="text-[var(--muted)] ml-1.5">{data[hi].label}</span>
          </Tip>
        )}
      </div>
    </div>
  );
}

/** Rounded data-end only: `t` = rounded top (columns), `r` = rounded right (bars). */
/** A bar with its DATA END rounded and its baseline end square, per the mark
 *  spec. `side` is which end carries the radius: "t" top, "r" right, "b"
 *  bottom — "b" exists for diverging bars, whose negative half grows downward
 *  from a centred zero line. */
function rr(x: number, y: number, w: number, h: number, r: number, side: "t" | "r" | "b") {
  if (w <= 0 || h <= 0) return "";
  const vertical = side === "t" || side === "b";
  const k = Math.min(r, vertical ? w / 2 : h / 2, vertical ? h : w);
  if (side === "t") {
    return `M${x},${y + h}L${x},${y + k}Q${x},${y} ${x + k},${y}L${x + w - k},${y}Q${x + w},${y} ${x + w},${y + k}L${x + w},${y + h}Z`;
  }
  if (side === "b") {
    return `M${x},${y}L${x + w},${y}L${x + w},${y + h - k}Q${x + w},${y + h} ${x + w - k},${y + h}L${x + k},${y + h}Q${x},${y + h} ${x},${y + h - k}Z`;
  }
  return `M${x},${y}L${x + w - k},${y}Q${x + w},${y} ${x + w},${y + k}L${x + w},${y + h - k}Q${x + w},${y + h} ${x + w - k},${y + h}L${x},${y + h}Z`;
}

/* ======================================================== DivergingBar
   Above/below a baseline. Two hues that read as OPPOSITE + neutral midpoint. */
export function DivergingBar({ data, height = 180, unit = "" }: {
  data: { label: string; value: number }[]; height?: number; unit?: string;
}) {
  const { cb, box } = useBox();
  const [hi, setHi] = useState<number | null>(null);
  const w = box.w, h = height;
  const m = Math.max(...data.map((d) => Math.abs(d.value)), 1);
  const xs = scaleLinear().domain([-m, m]).range([PAD.l + 60, w - PAD.r]);
  const band = (h - PAD.t - PAD.b) / Math.max(1, data.length);
  const bh = Math.min(MARK.barMax, band - 6);
  const zero = xs(0);
  return (
    <div ref={cb} className="relative w-full" style={{ height: h }}>
      <svg width="100%" height={h} role="img">
        <line x1={zero} x2={zero} y1={PAD.t} y2={h - PAD.b} stroke="var(--axis)" strokeWidth={1} shapeRendering="crispEdges" />
        {data.map((d, i) => {
          const y = PAD.t + i * band + (band - bh) / 2;
          const pos = d.value >= 0;
          const x0 = pos ? zero : xs(d.value);
          const bw = Math.abs(xs(d.value) - zero);
          return (
            <g key={d.label} onPointerEnter={() => setHi(i)} onPointerLeave={() => setHi(null)}>
              <rect x={0} y={PAD.t + i * band} width={w} height={band} fill="transparent" />
              <text x={PAD.l + 54} y={y + bh / 2} dy="0.32em" textAnchor="end" fill="var(--ink-2)" fontSize={11}>{d.label}</text>
              <path d={rr(x0, y, bw, bh, MARK.barRadius, "r")}
                    fill={pos ? "var(--dv-pos)" : "var(--dv-neg)"} opacity={hi === i ? 1 : 0.86} />
            </g>
          );
        })}
      </svg>
      {hi !== null && (
        <Tip x={zero} y={PAD.t + hi * band} w={w}>
          <span className="font-[650] tnum">{data[hi].value > 0 ? "+" : ""}{data[hi].value.toFixed(1)}{unit}</span>
          <span className="text-[var(--muted)] ml-1.5">{data[hi].label}</span>
        </Tip>
      )}
    </div>
  );
}

/* ============================================================== Heatmap
   Magnitude on a grid -> SEQUENTIAL, one hue, light->dark. Never a rainbow. */
export function Heatmap({ rows, cols, values, fmt, rowLabel, colLabel }: {
  rows: string[]; cols: string[]; values: (number | null)[][];
  fmt?: (v: number) => string; rowLabel?: string; colLabel?: string;
}) {
  const [hi, setHi] = useState<[number, number] | null>(null);
  const flat = values.flat().filter((v): v is number => v !== null);
  const mx = Math.max(...flat, 1);
  const ramp = ["var(--q100)", "var(--q200)", "var(--q300)", "var(--q400)", "var(--q500)", "var(--q600)", "var(--q700)"];
  const color = (v: number | null) =>
    v === null ? "transparent" : ramp[Math.min(ramp.length - 1, Math.floor((v / mx) * (ramp.length - 1) + 0.0001))];
  return (
    <div className="relative overflow-x-auto">
      <div className="inline-block min-w-full">
        <div className="flex gap-[2px] pl-[48px] mb-[2px]">
          {cols.map((c) => <span key={c} className="flex-1 text-[9px] text-[var(--muted)] text-center min-w-[16px]">{c}</span>)}
        </div>
        {rows.map((r, i) => (
          <div key={r} className="flex gap-[2px] mb-[2px] items-center">
            <span className="w-[44px] shrink-0 text-[10px] text-[var(--muted)] text-right pr-1 tnum">{r}</span>
            {cols.map((c, j) => {
              const v = values[i]?.[j] ?? null;
              const on = hi && hi[0] === i && hi[1] === j;
              return (
                <span key={c} className="flex-1 min-w-[16px] h-[20px] rounded-[2px] relative"
                      style={{ background: color(v),
                               border: v === null ? "1px dashed var(--grid)" : on ? "1px solid var(--ink)" : "1px solid transparent" }}
                      onPointerEnter={() => setHi([i, j])} onPointerLeave={() => setHi(null)}
                      title={v === null ? "no coverage" : `${r} ${c}: ${fmt ? fmt(v) : v}`} />
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 mt-2 text-[10px] text-[var(--muted)]">
        <span>0</span>
        {ramp.map((c) => <span key={c} className="w-[14px] h-[8px] rounded-[1px]" style={{ background: c }} />)}
        <span>{fmt ? fmt(mx) : mx}</span>
        <span className="ml-2">· dashed = no coverage</span>
      </div>
    </div>
  );
}

/* ============================================================= Histogram */
export function Histogram({ values, bins = 18, height = 150, unit = "", color = "var(--s1)" }: {
  values: number[]; bins?: number; height?: number; unit?: string; color?: string;
}) {
  const clean = values.filter((v) => Number.isFinite(v));
  if (!clean.length) return <Empty h={height} msg="no strokes measured yet" />;
  const lo = Math.min(...clean), hi = Math.max(...clean);
  const step = (hi - lo) / bins || 1;
  const counts = new Array(bins).fill(0);
  clean.forEach((v) => { counts[Math.min(bins - 1, Math.floor((v - lo) / step))]++; });
  return (
    <BarChart height={height}
      data={counts.map((c, i) => ({ label: (lo + i * step).toFixed(1), value: c, color }))}
      yFmt={(v) => `${v}`} valueLabel={false} />
  );
}

/* ========================================================= SmallMultiples
   Past ~4 converging series, facet instead of stacking labels.

   These are DISCRETE DAILY TOTALS — minutes lost to one cause on one day —
   so the mark is a bar, not a line. A line between day 3 and day 7 draws a
   slope through four days that did not happen, and when most days are zero
   (which is the normal shape of a downtime cause) it renders as a square
   wave that reads as noise rather than as "this happened twice".

   All panels share one y-domain so heights are comparable across causes.
   That was already true and completely invisible, so the shared maximum is
   now printed once above the group — a shared scale nobody can see is the
   same as no shared scale. */
export function SmallMultiples({ panels, height = 74, xFmt, yFmt }: {
  panels: { label: string; color: string; x: number[]; values: number[] }[];
  height?: number; xFmt?: (v: number) => string; yFmt?: (v: number) => string;
}) {
  const shared = niceDomain(panels.flatMap((p) => p.values));
  const fmt = yFmt ?? ((v: number) => v.toFixed(0));
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-[10px] text-[var(--muted)]">
        Shared scale across all {panels.length} panels — 0 to {fmt(shared[1])}. Bars are per day.
      </p>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
        {panels.map((p) => {
          const peak = Math.max(0, ...p.values);
          return (
            <div key={p.label} className="min-w-0">
              <div className="flex items-baseline gap-1.5 mb-1">
                <span aria-hidden style={{ background: p.color, width: 9, height: 9, borderRadius: 2 }} />
                <span className="text-[11px] text-[var(--ink-2)] truncate">{p.label}</span>
                <span className="ml-auto text-[10px] text-[var(--muted)] tnum shrink-0">
                  peak {fmt(peak)}
                </span>
              </div>
              <MiniBars x={p.x} values={p.values} color={p.color} h={height}
                        domain={shared} yFmt={fmt} xFmt={xFmt} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MiniBars({ x, values, color, h, domain, yFmt, xFmt }: {
  x: number[]; values: number[]; color: string; h: number;
  domain: [number, number]; yFmt: (v: number) => string; xFmt?: (v: number) => string;
}) {
  const { cb, box } = useBox();
  const [hi, setHi] = useState<number | null>(null);
  const w = box.w;
  const base = h - 12;
  const ys = scaleLinear().domain(domain).range([base, 4]);
  const n = Math.max(1, values.length);
  const slot = (w - 4) / n;
  const bw = Math.max(1.5, Math.min(MARK.barMax, slot - 1.5));
  return (
    <div ref={cb} className="relative w-full" style={{ height: h }}
         onPointerMove={(e) => {
           const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
           const i = Math.floor((e.clientX - r.left - 2) / slot);
           setHi(i >= 0 && i < n ? i : null);
         }}
         onPointerLeave={() => setHi(null)}>
      <svg width="100%" height={h} role="img">
        <line x1={2} x2={w - 2} y1={base} y2={base} stroke="var(--grid)"
              strokeWidth={1} shapeRendering="crispEdges" />
        {values.map((v, i) => {
          const bh = Math.max(0, base - ys(v));
          const bx = 2 + i * slot + (slot - bw) / 2;
          return (
            <g key={i}>
              <rect x={2 + i * slot} y={0} width={slot} height={h} fill="transparent" />
              {bh > 0 && (
                <path d={rr(bx, base - bh, bw, bh, Math.min(MARK.barRadius, bw / 2), "t")}
                      fill={color} opacity={hi === null || hi === i ? 1 : 0.55} />
              )}
            </g>
          );
        })}
      </svg>
      {hi !== null && values[hi] !== undefined && (
        <Tip x={2 + hi * slot + slot / 2} y={0} w={w}>
          <div className="text-[var(--muted)] mb-0.5 tnum">{xFmt ? xFmt(x[hi]) : x[hi]}</div>
          <div className="font-[650] tnum">{yFmt(values[hi])}</div>
        </Tip>
      )}
    </div>
  );
}

export function Empty({ h = 140, msg }: { h?: number; msg: string }) {
  return (
    <div className="flex items-center justify-center text-[11px] text-[var(--muted)]"
         style={{ height: h, border: "1px dashed var(--grid)", borderRadius: 6 }}>
      {msg}
    </div>
  );
}

/* ====================================================== DivergingBars
   PLAN vs ACTUAL. One measure with a meaningful zero and two directions, so
   it gets the diverging pair and a NEUTRAL midpoint — never a hue at zero,
   and never a sequential ramp, which would imply "more is more" when the
   whole point is that both directions are departures.

   Bars grow from a centred baseline. Over-plan is the cool pole, under-plan
   the warm one; the zero line is drawn in --axis so the eye lands on it
   first. */
export function DivergingBars({ data, height = 190, fmt, xFmt }: {
  data: { label: string; value: number; sub?: string }[];
  height?: number; fmt?: (v: number) => string; xFmt?: (v: string) => string;
}) {
  const { cb, box } = useBox();
  const [hi, setHi] = useState<number | null>(null);
  const w = box.w, h = height;
  const peak = Math.max(1, ...data.map((d) => Math.abs(d.value)));
  const [, nice] = niceDomain([peak]);
  const mid = PAD.t + (h - PAD.t - PAD.b) / 2;
  const half = (h - PAD.t - PAD.b) / 2;
  const yOf = (v: number) => mid - (v / nice) * half;
  const n = Math.max(1, data.length);
  const slot = (w - PAD.l - PAD.r) / n;
  const bw = Math.max(2, Math.min(MARK.barMax, slot - 2));
  const f = fmt ?? ((v: number) => (v > 0 ? "+" : "") + Math.round(v).toLocaleString("en-US"));

  return (
    <div className="flex flex-col gap-2">
      <div ref={cb} className="relative w-full" style={{ height: h }}
           onPointerLeave={() => setHi(null)}>
        <svg width="100%" height={h} role="img">
          {[nice, nice / 2, 0, -nice / 2, -nice].map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={w - PAD.r} y1={yOf(v)} y2={yOf(v)}
                    stroke={v === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth={1}
                    shapeRendering="crispEdges" />
              <text x={PAD.l - 6} y={yOf(v)} dy="0.32em" textAnchor="end"
                    fill="var(--muted)" fontSize={10} className="tnum">{f(v)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = PAD.l + i * slot + (slot - bw) / 2;
            const top = d.value >= 0 ? yOf(d.value) : mid;
            const bh = Math.abs(yOf(d.value) - mid);
            const on = hi === null || hi === i;
            return (
              <g key={d.label} onPointerEnter={() => setHi(i)}>
                <rect x={PAD.l + i * slot} y={PAD.t} width={slot} height={h - PAD.t - PAD.b} fill="transparent" />
                <path d={rr(x, top, bw, Math.max(1, bh), Math.min(MARK.barRadius, bw / 2),
                            d.value >= 0 ? "t" : "b")}
                      fill={d.value >= 0 ? "var(--dv-neg)" : "var(--dv-pos)"}
                      opacity={on ? 1 : 0.5} />
              </g>
            );
          })}
        </svg>
        {hi !== null && data[hi] && (
          <Tip x={PAD.l + hi * slot + slot / 2} y={PAD.t} w={w}>
            <div className="text-[var(--muted)] mb-0.5 tnum">
              {xFmt ? xFmt(data[hi].label) : data[hi].label}
            </div>
            <div className="font-[650] tnum"
                 style={{ color: data[hi].value >= 0 ? "var(--dv-neg)" : "var(--dv-pos)" }}>
              {f(data[hi].value)}
            </div>
            {data[hi].sub && <div className="text-[var(--muted)]">{data[hi].sub}</div>}
          </Tip>
        )}
      </div>
      <Legend kind="rect" items={[
        { label: "over plan", color: "var(--dv-neg)" },
        { label: "under plan", color: "var(--dv-pos)" },
      ]} />
    </div>
  );
}
