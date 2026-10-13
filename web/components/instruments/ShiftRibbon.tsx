"use client";
import { useMemo } from "react";
import type { Day } from "@/lib/types";
import { CAUSE_COLOR, CAUSE_LABEL } from "@/lib/palette";
import { useCursor, hhmmss } from "@/lib/cursor";

/** THE SHIFT, ONE MINUTE PER BAR.
 *
 *  Answers "where are we and what has happened" in one glance, which no
 *  number on the live screen does. Each minute wears the colour of the cause
 *  that owns it, so the same hue that labels a stop on the timeline and the
 *  spine labels it here too — causes are entity-locked across the app.
 *
 *  Drawn as one SVG rather than 510 <button>s (which is what the operator
 *  screen did): same interaction, one element, and the bars stay crisp at any
 *  width because they are rects on a shared scale rather than flexed divs.
 *
 *  The FUTURE is not painted. A shift ribbon that fills to the right edge at
 *  09:40 is claiming to know how the afternoon went. */
export function ShiftRibbon({ day, h = 34, showLegend = true }: {
  day: Day; h?: number; showLegend?: boolean;
}) {
  const { t, setT, openInspector } = useCursor();
  const nowM = Math.floor(t / 60);

  const bars = useMemo(() => {
    const out: { m: number; color: string; title: string; gap: string | null }[] = [];
    for (const m of day.minutes) {
      if (m.m < day.shift.m0 || m.m >= day.shift.m1) continue;
      const future = m.m > nowM;
      const g = day.gaps.find((x) => m.m * 60 >= x.t0 && m.m * 60 < x.t1);
      const color = future ? "var(--grid)"
        : m.s > 0 ? "var(--good)"
        : g ? CAUSE_COLOR[g.cause]
        : m.motor ? "var(--s2)" : "var(--dim)";
      const what = future ? "not yet"
        : g ? CAUSE_LABEL[g.cause]
        : m.s > 0 ? `${m.s} strokes`
        : m.motor ? "motor on, no output" : "stopped";
      out.push({ m: m.m, color, title: `${hhmmss(m.m * 60).slice(0, 5)} — ${what}`, gap: g?.id ?? null });
    }
    return out;
  }, [day, nowM]);

  if (!bars.length) return null;
  const n = bars.length;
  const slot = 100 / n;                       // percent, so it scales with the card
  const doneM = bars.filter((b) => b.m <= nowM).length;

  return (
    <div className="flex flex-col gap-1.5">
      <svg width="100%" height={h} viewBox={`0 0 100 ${h}`} preserveAspectRatio="none"
           role="img" aria-label="Shift so far, one bar per minute"
           style={{ display: "block" }}>
        {bars.map((b, i) => (
          <rect key={b.m} x={i * slot} y={0} width={slot * 1.02} height={h} fill={b.color}
                style={{ cursor: "pointer" }}
                onClick={() => { setT(b.m * 60); if (b.gap) openInspector(b.gap); }}>
            <title>{b.title}</title>
          </rect>
        ))}
        {/* the playhead */}
        <rect x={Math.max(0, (doneM - 1) * slot)} y={0} width={Math.max(0.35, slot * 0.9)} height={h}
              fill="var(--ink)" pointerEvents="none" />
      </svg>
      {showLegend && (
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[10px] text-[var(--muted)]">
          {[["var(--good)", "running"], ["var(--s2)", "motor on, no output"],
            ["var(--grid)", "not yet"]].map(([c, l]) => (
            <span key={l} className="flex items-center gap-1">
              <i className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: c }} />{l}
            </span>
          ))}
          <span className="ml-auto tnum">
            {hhmmss(day.shift.m0 * 60).slice(0, 5)}–{hhmmss(day.shift.m1 * 60).slice(0, 5)} ·
            {" "}click any minute to seek
          </span>
        </div>
      )}
    </div>
  );
}
