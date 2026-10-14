"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import type { Day } from "@/lib/types";
import { CAUSE_COLOR, CAUSE_LABEL, PLC_STATUS_COLOR } from "@/lib/palette";
import { useCursor, hhmm, hhmmss } from "@/lib/cursor";

/** INSTRUMENT III — the day on six lanes.
 *
 *  Canvas because it draws tens of thousands of samples and must stay smooth
 *  while zooming from 24 h down to a second. The crosshair is instant (0 ms) —
 *  latency in a crosshair feels broken.
 *
 *  The four simulated PLC/VFD lanes (motor, mode, alarms, power) were removed:
 *  what is left is the measured camera channel plus the reasons derived from it,
 *  which is what a reader is actually meant to take away. */

const LANES = [
  { key: "plc",    label: "PLC status" },
  { key: "op",     label: "CV operator" },
  { key: "stroke", label: "CV strokes" },
  { key: "sheet",  label: "CV sheets" },
  { key: "die",    label: "CV die" },
  { key: "reason", label: "REASONS" },
] as const;

/** Lanes are addressed by key, never by a literal row number — deleting a lane
 *  used to silently shift every lane below it into the wrong row. */
const LI = Object.fromEntries(LANES.map((l, i) => [l.key, i])) as
  Record<(typeof LANES)[number]["key"], number>;

const ROW = 22, GAPY = 4, RULER = 20, LABEL_W = 96;

export function LaneTimeline({ day, height }: { day: Day; height?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const wrap = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(900);
  const { t, span, hoverT, setT, setHoverT, setSpan, openInspector } = useCursor();
  const drag = useRef<{ x: number; t0: number } | null>(null);

  const H = height ?? RULER + LANES.length * (ROW + GAPY) + 6;

  // visible window, centred on the cursor and clamped to the day
  const half = span / 2;
  let v0 = t - half, v1 = t + half;
  if (v0 < 0) { v0 = 0; v1 = span; }
  if (v1 > 86400) { v1 = 86400; v0 = 86400 - span; }

  const toX = useCallback((s: number) => LABEL_W + ((s - v0) / (v1 - v0)) * (w - LABEL_W - 8), [v0, v1, w]);
  const toT = useCallback((x: number) => v0 + ((x - LABEL_W) / (w - LABEL_W - 8)) * (v1 - v0), [v0, v1, w]);

  useEffect(() => {
    const n = wrap.current;
    if (!n) return;
    const ro = new ResizeObserver(() => {
      const r = n.getBoundingClientRect();
      if (r.width > 20) setW(r.width);
    });
    ro.observe(n);
    const r = n.getBoundingClientRect();
    if (r.width > 20) setW(r.width);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = w * dpr; cv.height = H * dpr;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, H);

    const css = getComputedStyle(document.documentElement);
    const C = (v: string, f: string) => css.getPropertyValue(v).trim() || f;
    const ink = C("--ink", "#fff"), muted = C("--muted", "#8b949e");
    const grid = C("--grid", "#1e242a"), surface = C("--surface", "#121619");
    const s1 = C("--s1", "#3987e5"), s3 = C("--s3", "#199e70");
    const s6 = C("--s6", "#008300"), s7 = C("--s7", "#9085e9");
    const crit = C("--critical", "#d03b3b");
    const resolve = (vv: string) => vv.startsWith("var(")
      ? C(vv.slice(4, -1), "#888") : vv;

    const laneY = (i: number) => RULER + i * (ROW + GAPY);
    const mins = day.minutes;

    // ---- ruler -----------------------------------------------------------
    ctx.font = "9px system-ui"; ctx.textBaseline = "middle";
    const stepChoices = [60, 300, 900, 1800, 3600, 7200, 14400];
    const stepS = stepChoices.find((s) => (s / (v1 - v0)) * (w - LABEL_W) > 54) ?? 14400;
    ctx.textAlign = "center";
    for (let s = Math.ceil(v0 / stepS) * stepS; s <= v1; s += stepS) {
      const x = toX(s);
      ctx.strokeStyle = grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, RULER - 4); ctx.lineTo(x, H - 4); ctx.stroke();
      ctx.fillStyle = muted;
      ctx.fillText(stepS < 3600 ? hhmmss(s).slice(0, 8) : hhmm(s), x, RULER / 2);
    }

    // ---- lane labels -----------------------------------------------------
    ctx.textAlign = "left";
    LANES.forEach((l, i) => {
      ctx.fillStyle = l.key === "reason" ? ink : muted;
      ctx.font = l.key === "reason" ? "600 10px system-ui" : "10px system-ui";
      ctx.fillText(l.label, 4, laneY(i) + ROW / 2);
    });

    const bar = (i: number, a: number, b: number, color: string, hgt = ROW - 6, alpha = 1) => {
      const x0 = Math.max(LABEL_W, toX(a)), x1 = Math.min(w - 8, toX(b));
      if (x1 <= x0) return;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.fillRect(x0, laneY(i) + (ROW - hgt) / 2, Math.max(1, x1 - x0), hgt);
      ctx.globalAlpha = 1;
    };

    // ---- 1 PLC status blocks --------------------------------------------
    day.blocks.forEach((b) => {
      bar(LI.plc, b.m0 * 60, (b.m1 + 1) * 60, resolve(PLC_STATUS_COLOR[b.st] ?? "var(--muted)"), ROW - 6, 0.92);
    });

    // ---- 2 CV operator presence (grey = NO COVERAGE, never zero) ---------
    mins.forEach((m) => {
      if (m.present === null) { bar(LI.op, m.m * 60, (m.m + 1) * 60, grid, 6, 0.5); return; }
      bar(LI.op, m.m * 60, (m.m + 1) * 60, m.present > 40 ? s6 : crit, 6, 0.9);
    });

    // ---- 3 CV strokes (density) ------------------------------------------
    day.strokes.forEach((s) => {
      const x = toX(s.t);
      if (x < LABEL_W || x > w - 8) return;
      ctx.strokeStyle = s1; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, laneY(LI.stroke) + 4); ctx.lineTo(x, laneY(LI.stroke) + ROW - 4); ctx.stroke();
    });

    // ---- 4 sheets / 5 die change ----------------------------------------
    mins.forEach((m) => {
      if (m.sin === null) { bar(LI.sheet, m.m * 60, (m.m + 1) * 60, grid, 4, 0.4); return; }
      bar(LI.sheet, m.m * 60, (m.m + 1) * 60, s3, 6, 0.85);
      if (m.die) bar(LI.die, m.m * 60, (m.m + 1) * 60, s7, ROW - 8, 0.9);
      else bar(LI.die, m.m * 60, (m.m + 1) * 60, grid, 3, 0.5);
    });

    // ---- 6 REASONS — the lane the whole screen exists for ----------------
    day.gaps.forEach((g) => {
      bar(LI.reason, g.t0, g.t1, resolve(CAUSE_COLOR[g.cause]), ROW - 4, 0.9);
    });

    // ---- camera coverage underline --------------------------------------
    const cx0 = toX(day.camera.start_min * 60), cx1 = toX(day.camera.end_min * 60);
    if (cx1 > LABEL_W) {
      ctx.strokeStyle = s3; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(Math.max(LABEL_W, cx0), H - 2); ctx.lineTo(Math.min(w - 8, cx1), H - 2); ctx.stroke();
    }

    // ---- crosshair + cursor (instant, no easing) ------------------------
    const drawLine = (s: number, color: string, wd: number) => {
      const x = toX(s);
      if (x < LABEL_W || x > w - 8) return;
      ctx.strokeStyle = color; ctx.lineWidth = wd;
      ctx.beginPath(); ctx.moveTo(x, RULER - 6); ctx.lineTo(x, H - 4); ctx.stroke();
    };
    if (hoverT !== null) drawLine(hoverT, C("--hair-strong", "#fff3"), 1);
    drawLine(t, ink, 1.5);
  }, [day, w, H, t, span, hoverT, toX, v0, v1]);

  const hit = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return toT(clientX - r.left);
  };

  return (
    <div ref={wrap} className="w-full select-none">
      <canvas
        ref={ref} width={w} height={H} style={{ width: "100%", height: H, cursor: drag.current ? "grabbing" : "crosshair" }}
        onPointerMove={(e) => {
          setHoverT(hit(e.clientX));
          if (drag.current) {
            const r = ref.current!.getBoundingClientRect();
            const dx = e.clientX - r.left - drag.current.x;
            setT(drag.current.t0 - (dx / (w - LABEL_W - 8)) * (v1 - v0));
          }
        }}
        onPointerLeave={() => { setHoverT(null); drag.current = null; }}
        onPointerDown={(e) => {
          const r = ref.current!.getBoundingClientRect();
          drag.current = { x: e.clientX - r.left, t0: t };
          (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
        }}
        onPointerUp={(e) => {
          const r = ref.current!.getBoundingClientRect();
          const moved = drag.current && Math.abs(e.clientX - r.left - drag.current.x) > 3;
          drag.current = null;
          if (!moved) {
            const s = hit(e.clientX);
            setT(s);
            const g = day.gaps.find((x) => s >= x.t0 && s < x.t1);
            openInspector(g ? g.id : null);
          }
        }}
        onWheel={(e) => { e.preventDefault(); setSpan(span * (e.deltaY > 0 ? 1.25 : 0.8)); }}
        aria-label="Day timeline — six lanes. Click to seek, scroll to zoom, drag to pan."
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-[10px] text-[var(--muted)]">
        <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: "var(--grid)" }} /> no camera coverage</span>
        <span className="flex items-center gap-1"><i className="w-4 h-0.5 inline-block" style={{ background: "var(--s3)" }} /> camera window</span>
      </div>
    </div>
  );
}

export { LANES };
