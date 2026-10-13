"use client";
import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { Day, Pulse } from "@/lib/types";
import type { FloorData } from "@/lib/floor";
import { FloorPlan2D } from "./FloorPlan2D";
import { probeWebGL, resetWebGLProbe, type GlReport } from "@/lib/webgl";

/** R3F touches `window` on its initial render path, so the scene can never be
 *  server-rendered. The 2D plan is the loading state as well as the fallback —
 *  the front door must paint something real immediately. */
const FloorScene = dynamic(() => import("./FloorScene").then((m) => m.FloorScene), {
  ssr: false,
  loading: () => null,
});

type Mode = "probing" | "3d" | "2d";

/** A probe alone is not enough — context creation can also throw during
 *  <Canvas> init, which only a boundary catches. */
class SceneBoundary extends React.Component<
  { onError: () => void; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}

export function FloorView({ floor, day, pulse, t, selected, onSelect, view, force2d }: {
  floor: FloorData; day: Day | null; pulse: Pulse | null; t: number;
  selected: string | null; onSelect: (id: string | null) => void;
  view: { pos: number[]; target: number[]; zoom: number } | null;
  force2d?: boolean;
}) {
  const [mode, setMode] = useState<Mode>("probing");
  const [note, setNote] = useState<string | null>(null);
  /* Which GPU is actually drawing this. "Is WebGL even on?" is otherwise a
     question you can only answer by opening chrome://gpu, and when the answer
     is "yes" there is nothing on screen that says so — the 3D view and a
     software-rendered one look identical. */
  const [gpu, setGpu] = useState<GlReport | null>(null);

  useEffect(() => {
    if (force2d) { setMode("2d"); return; }
    // phones: after a 64px bar, 46px tabs and a 56px spine there is no usable
    // 3D viewport left, and it is the worst battery case we have
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    if (coarse && window.innerWidth < 768) {
      setMode("2d"); setNote("Simple view on small screens"); return;
    }
    if (localStorage.getItem("floor:simple") === "1") {
      setMode("2d"); setNote("Simple view (your preference)"); return;
    }
    const gl = probeWebGL();
    setGpu(gl);
    if (!gl.ok) { setMode("2d"); setNote(gl.reason); return; }
    setMode("3d");
  }, [force2d]);

  const fall = (why: string) => { setMode("2d"); setNote(why); };

  return (
    <div className="relative w-full h-full">
      {mode === "3d" ? (
        <SceneBoundary onError={() => fall("3D failed to start — showing the plan")}>
          <FloorScene floor={floor} day={day} pulse={pulse} onSelect={(id) => onSelect(id)}
                      view={view} selected={selected} />
        </SceneBoundary>
      ) : (
        <FloorPlan2D floor={floor} day={day} t={t}
                     selected={selected} onSelect={onSelect}
                     staticView={mode === "probing"} />
      )}
      {mode === "3d" && gpu?.renderer && (
        <span title={gpu.renderer}
              className="absolute bottom-2 left-2 flex items-center gap-1.5 text-[10px] px-1.5 py-[2px]
                         rounded pointer-events-none"
              style={{ background: "var(--raised)", color: "var(--muted)",
                       border: "1px solid var(--hair)" }}>
          <span aria-hidden className="w-[6px] h-[6px] rounded-full"
                style={{ background: "var(--good)" }} />
          3D on {shortGpu(gpu.renderer)}
        </span>
      )}
      {note && (
        <span className="absolute bottom-2 left-2 flex items-center gap-2 text-[10px] px-1.5 py-[2px] rounded"
              style={{ background: "var(--raised)", color: "var(--muted)",
                       border: "1px solid var(--hair)" }}>
          {note}
          {mode === "2d" && !force2d && (
            <button onClick={() => { resetWebGLProbe(); setNote(null); setMode("probing");
                                     requestAnimationFrame(() => {
                                       const g = probeWebGL();
                                       setGpu(g);
                                       if (g.ok) setMode("3d");
                                       else { setMode("2d"); setNote(g.reason); }
                                     }); }}
                    className="underline hover:text-[var(--ink)]">try 3D again</button>
          )}
        </span>
      )}
    </div>
  );
}

/** "ANGLE (AMD, AMD Radeon Graphics (radeonsi renoir ACO), OpenGL 4.6)" is the
 *  whole truth and far too long for a corner chip. Keep the part that answers
 *  the question — which device — and leave the rest in the title attribute.
 *  SwiftShader deliberately keeps its own name: software rendering is exactly
 *  the case someone needs to be able to see. */
function shortGpu(r: string): string {
  if (/swiftshader|llvmpipe|softwarerast/i.test(r)) return "software (no GPU)";
  const m = r.match(/ANGLE \(([^,]+),\s*([^,(]+)/);
  if (m) return m[2].trim();
  return r.length > 38 ? r.slice(0, 38) + "…" : r;
}

/** Lets anyone pin the cheap view — a wall display on weak hardware, or just
 *  someone who prefers the plan. */
export function SimpleViewToggle({ on, onToggle }: { on: boolean; onToggle: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-[10px] text-[var(--muted)] cursor-pointer select-none">
      <input type="checkbox" checked={on} className="accent-[var(--s1)]"
             onChange={(e) => {
               onToggle(e.target.checked);
               try { localStorage.setItem("floor:simple", e.target.checked ? "1" : "0"); } catch {}
             }} />
      Simple view
    </label>
  );
}
