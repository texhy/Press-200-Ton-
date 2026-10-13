"use client";
import { useRef, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { FloorData } from "@/lib/floor";
import { STATUS_COLOR, STATUS_ICON } from "@/lib/palette";
import { useCursor } from "@/lib/cursor";
import { floorFrame } from "./frame";

/** Labels live in a DOM overlay, not in the scene.
 *
 *  drei <Text> pulls troika (~100 KB), renders glyphs that will not match Inter
 *  at 9-11 px, and cannot do tabular-nums — which breaks "numbers are
 *  instruments" outright. drei <Html transform> scales type by camera distance,
 *  so a 9 px scale becomes fractional and blurry.
 *
 *  An overlay gives exact typography, real :focus-visible, free theme
 *  switching, and costs 12 style.transform writes per frame with no React. */

export type LabelMap = Map<string, HTMLElement>;

export function LabelLayer({ floor, labels, onSelect }: {
  floor: FloorData; labels: React.MutableRefObject<LabelMap>; onSelect: (id: string) => void;
}) {
  const { hovered } = useCursor();
  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden>
      {/* the maintenance room — the one place on this map that is not a press,
          and the room the screen itself lives in */}
      <div ref={(el) => { if (el) labels.current.set("__room", el); else labels.current.delete("__room"); }}
           className="absolute top-0 left-0 will-change-transform">
        <div className="flex flex-col items-center gap-0.5 -translate-x-1/2 -translate-y-full">
          <span className="px-1.5 py-[2px] rounded text-[10px] whitespace-nowrap leading-tight uppercase tracking-wide"
                style={{ background: "color-mix(in oklab, var(--surface) 88%, transparent)",
                         border: "1px dashed var(--hair-strong)", color: "var(--muted)" }}>
            {floor.room.label}
          </span>
          <span className="w-px" style={{ background: "var(--hair-strong)", height: 10 }} />
        </div>
      </div>
      {floor.stations.map((s) => (
        <div key={s.id}
             ref={(el) => { if (el) labels.current.set(s.id, el); else labels.current.delete(s.id); }}
             className="absolute top-0 left-0 will-change-transform"
             style={{ transition: "opacity var(--t-fast) var(--e-out)" }}>
          <div className="flex flex-col items-center gap-0.5 -translate-x-1/2 -translate-y-full">
            <span className="px-1.5 py-[2px] rounded text-[11px] whitespace-nowrap leading-tight"
                  style={{
                    background: "color-mix(in oklab, var(--surface) 88%, transparent)",
                    border: `1px solid ${hovered === s.id ? "var(--ink)" : "var(--hair-strong)"}`,
                    color: "var(--ink)",
                    fontWeight: s.instrumented ? 650 : 450,
                  }}>
              {s.label}
              <span data-state className="text-[var(--muted)] font-[400]" />
            </span>
            <span data-leader className="w-px" style={{ background: "var(--hair-strong)", height: 10 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

const v = new THREE.Vector3();

/** Projects each station anchor to screen space once per frame. */
export function LabelProjector({ floor, labels }: {
  floor: FloorData; labels: React.MutableRefObject<LabelMap>;
}) {
  const { camera, size } = useThree();
  const anchors = useRef(new Map<string, THREE.Vector3>());
  const meta = useRef(new Map<string, { instrumented: boolean }>());

  useEffect(() => {
    // stagger the anchor height by row parity — adjacent stations in the
    // 8-press column are 2.6 m apart and their chips collide at overview zoom
    const byCol = new Map<number, number>();
    anchors.current = new Map(floor.stations.map((s) => {
      const n = (byCol.get(s.pos[0]) ?? 0); byCol.set(s.pos[0], n + 1);
      const lift = s.instrumented ? 1.5 : 0.75 + (n % 2) * 1.25;
      meta.current.set(s.id, { instrumented: s.instrumented });
      return [s.id, new THREE.Vector3(s.pos[0], s.dims.h + lift, s.pos[2])];
    }));
    anchors.current.set("__room", new THREE.Vector3(
      floor.room.pos[0], floor.room.dims.h + 0.9, floor.room.pos[1]));
  }, [floor]);

  useFrame((state) => {
    const F = floorFrame(state.clock.elapsedTime);
    // Zoomed out there is not enough screen space between stations for twelve
    // chips, so show only the ones that earn it: the measured station and
    // anything needing attention. Everything reappears as you zoom in.
    const zoom = (camera as THREE.OrthographicCamera).zoom ?? 1;
    const dense = zoom < 30;
    const hov = useCursor.getState().hovered;
    for (const [id, a] of anchors.current) {
      const el = labels.current.get(id);
      if (!el) continue;
      const st0 = F.status.get(id);
      const keep = id === "__room" || !dense || id === hov
        || meta.current.get(id)?.instrumented
        || st0?.severity === "critical" || st0?.severity === "serious";
      if (!keep) { el.style.opacity = "0"; continue; }
      v.copy(a).project(camera);
      const x = (v.x * 0.5 + 0.5) * size.width;
      const y = (-v.y * 0.5 + 0.5) * size.height;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      el.style.opacity = v.z > 1 ? "0" : "1";
      const st = F.status.get(id);
      const span = el.querySelector<HTMLElement>("[data-state]");
      if (span && st) {
        const txt = ` · ${st.severity ? STATUS_ICON[st.severity] : "—"} ${st.state}`;
        if (span.textContent !== txt) span.textContent = txt;
        span.style.color = st.severity ? STATUS_COLOR[st.severity] : "var(--muted)";
      }
    }
  });
  return null;
}
