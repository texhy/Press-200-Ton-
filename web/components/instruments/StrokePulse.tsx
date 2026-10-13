"use client";
import { useEffect, useRef } from "react";

/** INSTRUMENT I — the machine's heartbeat, in the top bar on every screen.
 *
 *  Scrolls the real vy trace right-to-left. When strokes stop it FLATLINES and
 *  dims: the UI itself tells you the press died. That stillness is information,
 *  which is why this is data-driven motion rather than decoration. */
export function StrokePulse({ values, live, w = 180, h = 32 }: {
  values: number[]; live: boolean; w?: number; h?: number;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const reduce = useRef(false);

  // read AND watch: this used to sample the query once at mount, so toggling
  // the OS setting did nothing until a reload
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => { reduce.current = mq.matches; };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = w * dpr; cv.height = h * dpr;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue("--s1").trim() || "#3987e5";
    const dim = css.getPropertyValue("--dim").trim() || "#4a5560";

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const n = values.length;
      const flat = !live || n < 2;
      const col = flat ? dim : accent;
      const mid = h / 2;
      const amp = (h / 2) - 3;
      const peak = Math.max(0.4, ...values.map(Math.abs));

      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.strokeStyle = col;
      ctx.beginPath();
      if (flat) {
        ctx.moveTo(0, mid); ctx.lineTo(w, mid);
      } else {
        // Oldest sample at the left, newest at the right, and that is all.
        //
        // This used to rotate the window by a per-frame offset to "scroll" it,
        // which meant the trace wrapped around and moved even with the playhead
        // parked — motion that was not in the data, on the one instrument whose
        // whole job is that its stillness is information. The window now ends at
        // the playhead and advances because the playhead does.
        const step = w / (n - 1);
        for (let i = 0; i < n; i++) {
          const v = values[i] ?? 0;
          const x = i * step;
          const y = mid - (v / peak) * amp;
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
      }
      ctx.stroke();

      if (!flat) {
        // leading-edge glow + tip, at the playhead
        const lastV = values[n - 1] ?? 0;
        const ty = mid - (lastV / peak) * amp;
        ctx.globalAlpha = 0.25;
        ctx.beginPath(); ctx.arc(w - 1, ty, 5, 0, Math.PI * 2);
        ctx.fillStyle = col; ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(w - 1, ty, 2, 0, Math.PI * 2);
        ctx.fillStyle = col; ctx.fill();
      }

    };
    draw();
  }, [values, live, w, h]);

  return (
    <canvas ref={ref} width={w} height={h} style={{ width: w, height: h }}
            aria-label={live ? "Live stroke signal" : "Stroke signal — press stopped"} />
  );
}
