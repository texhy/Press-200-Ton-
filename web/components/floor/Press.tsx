"use client";
import { forwardRef, useRef } from "react";
import * as THREE from "three";
import type { Station } from "@/lib/floor";
import { UNIT_BOX, UNIT_CYL, cProfile, columnOffsets } from "./pressGeometry";

/** Procedural presses.
 *
 *  Two silhouettes that must be tellable apart from across a room:
 *    hydraulic  — tall, four visible tie-rod columns, HPU beside the frame
 *    mechanical — squat, solid C-frame, a flywheel on the side
 *
 *  Bodies carry NO status colour, ever. Status tokens were contrast-validated
 *  as flat fills; a lit surface multiplies them by an arbitrary N·L term and
 *  the guarantee stops holding. Status lives on the unlit beacon and the floor
 *  decal, both owned by FloorScene. */

export interface PressRefs {
  ram: THREE.Group | null;
  flywheel: THREE.Mesh | null;
}

interface Props {
  station: Station;
  body: THREE.Material;
  dark: THREE.Material;
  accent: THREE.Material;
  onRefs: (r: PressRefs) => void;
}

/* ------------------------------------------------------------- hydraulic */
function Hydraulic({ station: s, body, dark, accent, onRefs }: Props) {
  const { w, h, d } = s.dims;
  const colR = s.dims.col_r ?? 0.14;
  const inset = s.dims.col_inset ?? 0.3;
  // ONE object for the lifetime of the press. A fresh literal per render means
  // the parent can be holding a stale record whose meshes have been unmounted,
  // and the ram animation silently drives nothing.
  const refs = useRef<PressRefs>({ ram: null, flywheel: null }).current;

  const bedH = 0.22 * h;
  const crownH = 0.16 * h;
  const colH = h - bedH - crownH;

  return (
    <group>
      {/* bed */}
      <mesh geometry={UNIT_BOX} material={body} raycast={() => null}
            position-y={bedH / 2} scale={[w, bedH, d]} />
      {/* bolster plate — the die sits on this */}
      <mesh geometry={UNIT_BOX} material={dark} raycast={() => null}
            position-y={bedH + 0.03 * h} scale={[w * 1.05, 0.06 * h, d * 1.05]} />
      {/* four tie-rod columns: the hydraulic tell */}
      {columnOffsets(w, d, inset).map(([x, z], i) => (
        <mesh key={i} geometry={UNIT_CYL} material={dark} raycast={() => null}
              position={[x, bedH + colH / 2, z]} scale={[colR, colH, colR]} />
      ))}
      {/* crown */}
      <mesh geometry={UNIT_BOX} material={body} raycast={() => null}
            position-y={h - crownH / 2} scale={[w, crownH, d]} />
      {/* actuator barrel hanging from the crown */}
      <mesh geometry={UNIT_CYL} material={dark} raycast={() => null}
            position-y={h - crownH - 0.10 * h} scale={[0.15 * w, 0.22 * h, 0.15 * w]} />
      {/* the ram — the only animated transform on the press */}
      <group ref={(el) => { refs.ram = el; onRefs(refs); }}
             userData={{ ram: s.id }}
             position-y={bedH + colH * 0.62}>
        <mesh geometry={UNIT_BOX} material={accent} raycast={() => null}
              scale={[w * 0.62, 0.10 * h, d * 0.62]} />
      </group>
      {/* HPU alongside — reads instantly as "this one is hydraulic" */}
      <mesh geometry={UNIT_BOX} material={body} raycast={() => null}
            position={[w * 0.82, 0.30 * h, -d * 0.22]}
            scale={[w * 0.42, 0.60 * h, d * 0.5]} />
    </group>
  );
}

/* ------------------------------------------------------------ mechanical */
function Mechanical({ station: s, body, dark, accent, onRefs }: Props) {
  const { w, h, d } = s.dims;
  const t = s.dims.frame_t ?? 0.34;
  const fw = s.flywheel;
  const refs = useRef<PressRefs>({ ram: null, flywheel: null }).current;

  const bedH = 0.2 * h;

  return (
    <group>
      {/* bed — wider than the frame, as a press bed is */}
      <mesh geometry={UNIT_BOX} material={body} raycast={() => null}
            position-y={bedH / 2} scale={[w * 1.15, bedH, d * 1.1]} />
      {/* the C-frame itself, one shared extruded profile */}
      <mesh geometry={cProfile(t)} material={body} raycast={() => null}
            position-y={bedH} scale={[w, h - bedH, d]} />
      {/* die shoe on the bolster */}
      <mesh geometry={UNIT_BOX} material={dark} raycast={() => null}
            position={[w * 0.16, bedH + 0.06 * h, 0]}
            scale={[w * 0.5, 0.1 * h, d * 0.62]} />
      {/* flywheel — the mechanical tell, spun from stroke rate by Movers */}
      {fw && (
        <mesh ref={(el) => { refs.flywheel = el; onRefs(refs); }}
              geometry={UNIT_CYL} material={dark} raycast={() => null}
              userData={{ flywheel: s.id }}
              rotation-z={Math.PI / 2}
              position={[-w * 0.52, bedH + (h - bedH) * 0.72, 0]}
              scale={[fw.r, fw.t, fw.r]} />
      )}
      {/* motor behind the flywheel */}
      <mesh geometry={UNIT_CYL} material={dark} raycast={() => null}
            rotation-z={Math.PI / 2}
            position={[-w * 0.52, bedH + (h - bedH) * 0.42, d * 0.1]}
            scale={[0.18 * w, 0.5 * w, 0.18 * w]} />
      {/* ram, sliding in the throat */}
      <group ref={(el) => { refs.ram = el; onRefs(refs); }}
             userData={{ ram: s.id }}
             position={[w * 0.16, bedH + (h - bedH) * 0.58, 0]}>
        <mesh geometry={UNIT_BOX} material={accent} raycast={() => null}
              scale={[w * 0.46, 0.12 * h, d * 0.58]} />
      </group>
    </group>
  );
}

export const Press = forwardRef<THREE.Group, Props>(function Press(props, ref) {
  const { station } = props;
  return (
    <group ref={ref} position={[station.pos[0], 0, station.pos[2]]} rotation-y={station.rot}>
      {station.kind === "hydraulic_4col" ? <Hydraulic {...props} /> : <Mechanical {...props} />}
    </group>
  );
});
