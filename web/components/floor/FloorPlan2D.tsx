"use client";
import { useMemo } from "react";
import type { Day } from "@/lib/types";
import type { FloorData, Station } from "@/lib/floor";
import { allStatuses, type StationStatus } from "@/lib/floorStatus";
import { STATUS_COLOR, STATUS_ICON } from "@/lib/palette";
import { useCursor } from "@/lib/cursor";

/** Top-down SVG floor plan.
 *
 *  This is NOT a consolation prize for the 3D view — it is the no-WebGL
 *  fallback, the reduced-motion view, the mobile view, the dynamic-import
 *  loading state and the printable plan. It is built first and on its own is
 *  enough to ship the page.
 *
 *  GREYSCALE RULE: someone will screenshot this and show it to a customer, so
 *  measured / simulated / no-coverage must stay distinguishable without hue.
 *  Solid fill = measured · diagonal hatch = simulated · dotted grey = no coverage. */
export function FloorPlan2D({ floor, day, t, selected, onSelect, staticView }: {
  floor: FloorData;
  day: Day | null;
  t: number;
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  staticView?: boolean;
}) {
  const { hovered, setHovered } = useCursor();
  const status = useMemo(() => allStatuses(floor, day, t), [floor, day, t]);

  const PAD = 2;
  const { w, d } = floor.floor;
  const vb = `${-w / 2 - PAD} ${-d / 2 - PAD} ${w + PAD * 2} ${d + PAD * 2}`;

  const fill = (s: StationStatus) =>
    s.severity === null ? "var(--grid)" : STATUS_COLOR[s.severity];

  return (
    <svg viewBox={vb} className="w-full h-full block" role="img"
         aria-label="Press shop floor plan"
         style={{ background: "var(--plane)" }}>
      <defs>
        {/* the simulated texture — survives greyscale, unlike a colour alone */}
        <pattern id="sim-hatch" width="0.55" height="0.55" patternTransform="rotate(45)"
                 patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="0" y2="0.55" stroke="var(--plane)" strokeWidth="0.17"
                opacity="0.55" />
        </pattern>
      </defs>

      {/* floor slab + 1 m grid */}
      <rect x={-w / 2} y={-d / 2} width={w} height={d} fill="var(--surface)"
            stroke="var(--hair-strong)" strokeWidth={0.08} />
      <g opacity={0.5}>
        {Array.from({ length: Math.floor(w) + 1 }, (_, i) => -w / 2 + i).map((x) => (
          <line key={`vx${x}`} x1={x} y1={-d / 2} x2={x} y2={d / 2}
                stroke="var(--grid)" strokeWidth={0.03} />
        ))}
        {Array.from({ length: Math.floor(d) + 1 }, (_, i) => -d / 2 + i).map((z) => (
          <line key={`hz${z}`} x1={-w / 2} y1={z} x2={w / 2} y2={z}
                stroke="var(--grid)" strokeWidth={0.03} />
        ))}
      </g>

      {/* aisles */}
      {floor.aisles.map((a) => (
        <polyline key={a.id} fill="none" stroke="var(--grid)" strokeWidth={a.w}
                  strokeLinejoin="round" strokeLinecap="round" opacity={0.3}
                  points={a.pts.map((p) => `${p[0]},${p[1]}`).join(" ")} />
      ))}

      {/* maintenance room */}
      <g>
        <rect x={floor.room.pos[0] - floor.room.dims.w / 2}
              y={floor.room.pos[1] - floor.room.dims.d / 2}
              width={floor.room.dims.w} height={floor.room.dims.d}
              rx={0.3} fill="var(--raised)" stroke="var(--hair-strong)" strokeWidth={0.12} />
        <text x={floor.room.pos[0]} y={floor.room.pos[1]} textAnchor="middle"
              dominantBaseline="middle" fill="var(--ink-2)"
              style={{ fontSize: 0.9, fontWeight: 600 }}>Maintenance</text>
      </g>

      {/* stations */}
      {floor.stations.map((s) => {
        const st = status.get(s.id)!;
        const on = hovered === s.id || selected === s.id;
        const [x, , z] = s.pos;
        const { w: sw, d: sd } = s.dims;
        return (
          <g key={s.id}
             onPointerEnter={() => !staticView && setHovered(s.id)}
             onPointerLeave={() => !staticView && setHovered(null)}
             onClick={() => !staticView && onSelect?.(s.id)}
             style={{ cursor: staticView ? "default" : "pointer" }}>
            <rect x={x - sw / 2} y={z - sd / 2} width={sw} height={sd} rx={0.18}
                  fill={fill(st)} fillOpacity={st.severity === null ? 0.5 : 0.82}
                  stroke={on ? "var(--ink)" : "var(--hair-strong)"}
                  strokeWidth={on ? 0.18 : 0.08}
                  strokeDasharray={st.severity === null ? "0.4 0.3" : undefined} />
            {/* simulated stations carry a texture, not just a different hue */}
            {!s.instrumented && (
              <rect x={x - sw / 2} y={z - sd / 2} width={sw} height={sd} rx={0.18}
                    fill="url(#sim-hatch)" pointerEvents="none" />
            )}
            {/* the one measured station gets a ring so it reads differently at a glance */}
            {s.instrumented && (
              <rect x={x - sw / 2 - 0.45} y={z - sd / 2 - 0.45}
                    width={sw + 0.9} height={sd + 0.9} rx={0.4}
                    fill="none" stroke="var(--s3)" strokeWidth={0.1} opacity={0.9} />
            )}
            {/* label sits in the margin beside the row, never on top of the mark */}
            <text x={x + (x < 0 ? -sw / 2 - 0.6 : sw / 2 + 0.6)} y={z - 0.42}
                  textAnchor={x < 0 ? "end" : "start"} dominantBaseline="middle"
                  fill={on ? "var(--ink)" : "var(--ink-2)"}
                  style={{ fontSize: 0.78, fontWeight: s.instrumented ? 700 : 500 }}>
              {s.label}
            </text>
            <text x={x + (x < 0 ? -sw / 2 - 0.6 : sw / 2 + 0.6)} y={z + 0.52}
                  textAnchor={x < 0 ? "end" : "start"} dominantBaseline="middle"
                  fill="var(--muted)" style={{ fontSize: 0.6, fontWeight: 500 }}>
              {s.instrumented ? "● LIVE" : "SIM"} · {st.state}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Compact legend. Stated, not implied. */
export function FloorLegend({ floor }: { floor: FloorData }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] text-[var(--muted)]">
      <span className="flex items-center gap-1.5">
        <i className="w-3 h-3 rounded-sm inline-block"
           style={{ background: "var(--good)", outline: "1.5px solid var(--s3)", outlineOffset: 1 }} />
        measured — {floor.legend.instrumented} station
      </span>
      <span className="flex items-center gap-1.5">
        <i className="w-3 h-3 rounded-sm inline-block"
           style={{ background: "repeating-linear-gradient(45deg,var(--warning),var(--warning) 2px,var(--plane) 2px,var(--plane) 3px)" }} />
        simulated — {floor.legend.total - floor.legend.instrumented} stations
      </span>
      <span className="flex items-center gap-1.5">
        <i className="w-3 h-3 rounded-sm inline-block border border-dashed border-[var(--muted)]"
           style={{ background: "var(--grid)" }} />
        no coverage
      </span>
      <span className="ml-auto">{floor.provenance.layout} layout · dimensions {floor.provenance.dimensions}</span>
    </div>
  );
}
