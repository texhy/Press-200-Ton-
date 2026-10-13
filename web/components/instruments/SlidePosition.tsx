"use client";
import { useEffect, useRef } from "react";
import { advanceSlide } from "@/lib/slide";

/** INSTRUMENT II — the slide block physically rides up and down with the real
 *  vy signal, TDC/BDC marked. Nothing else makes people understand at a glance
 *  that they are watching a real press.
 *
 *  The motion model is lib/slide.ts, shared with the 3D ram on the floor map so
 *  the two can never disagree about where the slide is. */
export function SlidePosition({ vy, state, h = 150, w = 56 }: {
  vy: number; state: 0 | 1 | 2 | 3; h?: number; w?: number;
}) {
  const pos = useRef(0.5);          // 0 = TDC (top), 1 = BDC (bottom)
  const ref = useRef<HTMLCanvasElement | null>(null);
  const raf = useRef(0);
  const reduce = useRef(false);

  // read AND watch: sampling the query once at mount meant toggling the OS
  // setting did nothing until a reload
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
    const s1 = css.getPropertyValue("--s1").trim() || "#3987e5";
    const axis = css.getPropertyValue("--axis").trim() || "#2b333b";
    const muted = css.getPropertyValue("--muted").trim() || "#8b949e";

    let last = performance.now();
    const tick = (now?: number) => {
      // Real elapsed seconds, clamped. The old model advanced a fixed 25% of
      // the remaining gap PER FRAME, so the slide moved visibly faster on a
      // 144 Hz monitor than on a 60 Hz one — the same recording, two different
      // stroke speeds. A tab that loses focus then returns hands back a gap of
      // seconds, hence the clamp.
      const t = now ?? last;
      const dt = Math.min(0.1, Math.max(0, (t - last) / 1000));
      last = t;
      pos.current = advanceSlide(pos.current, vy, state, dt, reduce.current);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const top = 16, bot = h - 16, trackX = w / 2;

      ctx.strokeStyle = axis; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(trackX, top); ctx.lineTo(trackX, bot); ctx.stroke();
      ctx.fillStyle = muted; ctx.font = "9px system-ui"; ctx.textAlign = "center";
      [["TDC", top], ["BDC", bot]].forEach(([l, y]) => {
        ctx.beginPath(); ctx.moveTo(trackX - 14, y as number); ctx.lineTo(trackX + 14, y as number); ctx.stroke();
        ctx.fillText(l as string, trackX, (y as number) + ((l === "TDC") ? -5 : 11));
      });

      const bh = 26, bw = 30;
      const y = top + pos.current * (bot - top - bh);
      ctx.fillStyle = s1;
      ctx.globalAlpha = state === 0 ? 0.45 : 1;   // dimmed: no signal, not a reading
      ctx.beginPath();
      ctx.roundRect(trackX - bw / 2, y, bw, bh, 3);
      ctx.fill();
      ctx.globalAlpha = 1;

      if (!reduce.current) raf.current = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf.current);
  }, [vy, state, h, w]);

  return <canvas ref={ref} width={w} height={h} style={{ width: w, height: h }} aria-label="Slide position" />;
}
