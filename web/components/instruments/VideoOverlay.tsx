"use client";
import { useEffect, useRef } from "react";
import type { CvTimeline } from "@/lib/types";
import { cvIndex, lerp } from "@/lib/data";
import { partLabel } from "@/lib/format";

export interface Layers {
  worker: boolean; people: boolean; wrists: boolean; parts: boolean;
  motion: boolean; rois: boolean; sheets: boolean; die: boolean;
  stack: boolean; state: boolean; stock: boolean;
}
export const DEFAULT_LAYERS: Layers = {
  worker: true, people: true, wrists: true, parts: true, motion: false,
  rois: true, sheets: true, die: true, stack: true, state: true, stock: true,
};

/** INSTRUMENT IV — overlays drawn on canvas above the plain H.264 video.
 *
 *  THE IMPORTANT BIT: cv.json is 5 Hz and the video runs at 25 fps. Drawn
 *  straight from the nearest sample the boxes visibly stutter, so box GEOMETRY
 *  is interpolated between the two neighbouring samples on every frame. State
 *  that is discrete — part class, banners, counters — snaps instead, because
 *  interpolating a class label is meaningless.
 *
 *  Client-side rather than burnt in: layers toggle, text stays crisp at any
 *  zoom, and overlays land on the full-resolution frame. */
export function VideoOverlay({ cv, video, layers, onTime }: {
  cv: CvTimeline;
  video: React.RefObject<HTMLVideoElement | null>;
  layers: Layers;
  onTime?: (t: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const idx = useRef(cvIndex(cv));
  const raf = useRef(0);

  useEffect(() => { idx.current = cvIndex(cv); }, [cv]);

  useEffect(() => {
    const cvs = ref.current, vid = video.current;
    if (!cvs || !vid) return;
    const ctx = cvs.getContext("2d");
    if (!ctx) return;
    const [NW, NH] = cv.native;
    let stop = false;

    const paint = () => {
      if (stop) return;
      const rect = cvs.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (cvs.width !== Math.round(rect.width * dpr)) {
        cvs.width = Math.round(rect.width * dpr);
        cvs.height = Math.round(rect.height * dpr);
      }
      const W = cvs.width, H = cvs.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // map native video coords onto the canvas, letterboxed like object-fit:contain
      const sc = Math.min(W / NW, H / NH);
      const ox = (W - NW * sc) / 2, oy = (H - NH * sc) / 2;
      ctx.setTransform(sc, 0, 0, sc, ox, oy);
      const u = dpr / sc;                     // keep strokes/text a constant on-screen size

      const t = vid.currentTime;
      onTime?.(t);
      const pair = idx.current.at(t);
      if (!pair) { raf.current = requestAnimationFrame(paint); return; }
      const { a, b, uu } = { ...pair, uu: pair.u };

      const css = getComputedStyle(document.documentElement);
      const C = (v: string, f: string) => css.getPropertyValue(v).trim() || f;
      const s1 = C("--s1", "#3987e5"), s3 = C("--s3", "#199e70"), s7 = C("--s7", "#9085e9");
      const good = C("--good", "#0ca30c"), warn = C("--warning", "#fab219");
      const serious = C("--serious", "#ec835a"), ink = "#ffffff";

      const box = (x: number, y: number, x2: number, y2: number, color: string, lw = 3) => {
        ctx.strokeStyle = color; ctx.lineWidth = lw * u;
        ctx.strokeRect(x, y, x2 - x, y2 - y);
      };
      const chip = (x: number, y: number, text: string, color: string) => {
        ctx.font = `${600} ${13 * u}px system-ui, sans-serif`;
        const pad = 5 * u, tw = ctx.measureText(text).width, hh = 19 * u;
        const yy = Math.max(hh, y) - hh;
        ctx.fillStyle = color;
        ctx.fillRect(x, yy, tw + pad * 2, hh);
        ctx.fillStyle = "#0a0c0f";
        ctx.textBaseline = "middle";
        ctx.fillText(text, x + pad, yy + hh / 2);
      };

      /* ---- ROIs: thin guides, drawn first so data sits on top ---------- */
      if (layers.rois) {
        const [sx, sy, sw, sh] = cv.stroke_roi;
        ctx.setLineDash([6 * u, 5 * u]);
        box(sx, sy, sx + sw, sy + sh, warn, 1.5);
        ctx.setLineDash([]);
      }
      if (layers.die) {
        const [bx, by, bw, bh] = cv.bolster_roi;
        const changing = (a.dc || b.dc) === 1;
        box(bx, by, bx + bw, by + bh, changing ? serious : s7, changing ? 3 : 1.5);
      }

      /* ---- the stock tray: ONE declared region, not eleven boxes ------- */
      // The detector fires part_collar 429,989 times over this run — eleven at
      // once, every frame, inside a patch that never moves. Those are collar
      // parts sitting in a tray in shot, so they are NOT in frames[].d and are
      // not counted as production; cv.stock declares the envelope and frames[].sn
      // carries the live count. Drawing the region keeps the detector's work
      // visible and says what it is, which eleven unlabelled boxes would not.
      if (layers.stock) {
        for (const sp of cv.stock ?? []) {
          // only while the tray is actually in frame. The collar stock does not
          // appear until the die change ends at 22:00, and an empty region
          // captioned "0x Collar" is a label for something that is not there.
          if (!a.sn) continue;
          const [x1, y1, x2, y2] = sp.envelope;
          ctx.setLineDash([3 * u, 4 * u]);
          box(x1, y1, x2, y2, s7, 1.5);
          ctx.setLineDash([]);
          chip(x1, y1 - 2 * u,
               `STOCK  ${a.sn}x ${partLabel(sp.class)}  not counted`, s7);
        }
      }

      /* ---- the operator: GEOMETRY INTERPOLATED ------------------------- */
      if (layers.worker && a.w) {
        const wa = a.w, wb = b.w && b.w[0] === a.w[0] ? b.w : a.w;
        const x1 = lerp(wa[1], wb[1], uu), y1 = lerp(wa[2], wb[2], uu);
        const x2 = lerp(wa[3], wb[3], uu), y2 = lerp(wa[4], wb[4], uu);
        const confirmed = a.cf === 1;
        const col = confirmed ? good : warn;
        box(x1, y1, x2, y2, col, confirmed ? 3 : 2);
        chip(x1, y1 - 2 * u,
             `${confirmed ? "OPERATOR" : "OPERATOR?"} id${wa[0]}${wa[6] ? `  ${(wa[6] / 100).toFixed(2)}` : ""}`,
             col);
      }

      /* ---- part detections: boxes lerp, the CLASS snaps ---------------- */
      if (layers.parts) {
        for (const d of a.d) {
          const m = b.d.find((x) => x[0] === d[0]);
          const x1 = lerp(d[2], m ? m[2] : d[2], uu), y1 = lerp(d[3], m ? m[3] : d[3], uu);
          const x2 = lerp(d[4], m ? m[4] : d[4], uu), y2 = lerp(d[5], m ? m[5] : d[5], uu);
          box(x1, y1, x2, y2, s1, 2);
          chip(x1, y1 - 2 * u, `${partLabel(d[0])}  ${(d[1] / 100).toFixed(2)}`, s1);
        }
      }

      /* ---- steel-sheet stack ------------------------------------------- */
      if (layers.stack && a.sk) {
        const k = a.sk;
        box(k[0], k[1], k[2], k[3], s3, 2);
        chip(k[0], k[1] - 2 * u, `STACK ${(k[4] / 100).toFixed(2)}`, s3);
      }

      /* ---- discrete state: snaps, never interpolated ------------------- */
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const PADX = 12 * dpr, LH = 22 * dpr;
      if (layers.state) {
        ctx.font = `${600} ${13 * dpr}px system-ui, sans-serif`;
        ctx.textBaseline = "top";
        // ps 0 is the monitor's "----" — the stroke ROI returned nothing. It is
        // NOT idle: there are 684 s of it across 407 dropouts in this run, and
        // calling that "IDLE" asserts a stopped press 11 minutes a day.
        const PS = ["NO SIGNAL", "RISING", "STILL", "DESCENDING"][a.ps];
        const lines: [string, string][] = [
          [`strokes ${a.c}`, ink],
          [`press ${PS}   vy ${a.vy >= 0 ? "+" : ""}${a.vy.toFixed(2)}`, a.ps === 0 ? C("--muted", "#8b949e") : s1],
          [`IN ${a.si}   OUT ${a.so}`, s3],
        ];
        lines.forEach(([txt, col], i) => {
          ctx.fillStyle = "rgba(10,12,15,0.62)";
          const tw = ctx.measureText(txt).width;
          ctx.fillRect(PADX - 5 * dpr, PADX + i * LH - 2 * dpr, tw + 10 * dpr, LH - 2 * dpr);
          ctx.fillStyle = col;
          ctx.fillText(txt, PADX, PADX + i * LH);
        });
        const parts = a.d.length ? a.d.map((d) => partLabel(d[0])).join(", ") : "NOT PRESENT";
        ctx.fillStyle = a.d.length ? s1 : serious;
        ctx.fillText(`part: ${parts}`, PADX, PADX + 3 * LH);
      }

      /* ---- banners ------------------------------------------------------ */
      if (layers.die && a.dc) {
        ctx.font = `${700} ${22 * dpr}px system-ui, sans-serif`;
        const txt = "DIE CHANGE IN PROGRESS";
        const tw = ctx.measureText(txt).width;
        ctx.fillStyle = "rgba(10,12,15,0.7)";
        ctx.fillRect((W - tw) / 2 - 12 * dpr, 46 * dpr, tw + 24 * dpr, 34 * dpr);
        ctx.fillStyle = serious;
        ctx.textBaseline = "middle";
        ctx.fillText(txt, (W - tw) / 2, 63 * dpr);
      }
      // a sheet event flashes for ~1 s after it fires
      const ev = [a, b].find((r) => r.ev);
      if (layers.sheets && ev?.ev && Math.abs(t - ev.t) < 1.0) {
        ctx.font = `${700} ${30 * dpr}px system-ui, sans-serif`;
        const txt = `SHEET ${ev.ev}`;
        const tw = ctx.measureText(txt).width;
        ctx.globalAlpha = Math.max(0, 1 - Math.abs(t - ev.t));
        ctx.fillStyle = ev.ev === "IN" ? good : serious;
        ctx.textBaseline = "middle";
        ctx.fillText(txt, (W - tw) / 2, H / 2);
        ctx.globalAlpha = 1;
      }
      if (layers.die && a.fk) {
        ctx.font = `${600} ${13 * dpr}px system-ui, sans-serif`;
        ctx.fillStyle = warn; ctx.textBaseline = "top";
        ctx.fillText("FORKLIFT-SIZED MOTION", PADX, H - 28 * dpr);
      }

      raf.current = requestAnimationFrame(paint);
    };

    paint();
    return () => { stop = true; cancelAnimationFrame(raf.current); };
  }, [cv, video, layers, onTime]);

  return <canvas ref={ref} className="absolute inset-0 w-full h-full pointer-events-none" />;
}
