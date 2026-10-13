"use client";
import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { easing } from "maath";
import type { FloorData } from "@/lib/floor";
import { advanceSlide, closedFormSlide, PARK } from "@/lib/slide";
import { tokenMaterial } from "@/lib/tokens3d";
import { UNIT_BOX, UNIT_CYL } from "./pressGeometry";
import { walkways } from "./paths";
import { floorFrame } from "./frame";
import type { PressRefs } from "./Press";

/** EVERYTHING THAT MOVES, ON ONE CLOCK AND ONE useFrame.
 *
 *  Press Play and the whole floor runs off the cursor store: twelve rams, eight
 *  flywheels, the operator at the instrumented press, the forklift's three
 *  measured visits and the ambient walkers. None of it subscribes to `t` —
 *  floorFrame() reads useCursor.getState() once per frame and everyone shares
 *  the result (see frame.ts).
 *
 *  What is measured and what is not:
 *    s_press_1's ram      MEASURED — the 25 Hz vy signal at the playhead
 *    the other 11 rams    SIMULATED — closed form from the declared spm/phase
 *    operator presence    MEASURED as a BINARY; the position is INFERRED
 *    the forklift         3 MEASURED visits; the drive in and out is INFERRED
 *    ambient walkers      INVENTED, and they carry no status or identity
 */

const _v2 = new THREE.Vector2();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Head height of the box avatars. Deliberately crude — these are markers for
 *  "a person is here", and a detailed figure would imply we know who. */
const BODY_H = 1.7;

export function Movers({ floor, pressRefs, reduce }: {
  floor: FloorData;
  pressRefs: React.MutableRefObject<Record<string, PressRefs>>;
  reduce: boolean;
}) {
  const ways = useMemo(() => walkways(floor.paths), [floor]);
  const walkers = useRef<THREE.InstancedMesh>(null);
  const operator = useRef<THREE.Group>(null);
  const forklift = useRef<THREE.Group>(null);

  // normalised ram positions, carried between frames for the integrated one
  const ramPos = useRef<Record<string, number>>({});
  // the playhead at the previous frame, for integrating in VIDEO time
  const prevT = useRef<number | null>(null);
  // the ram group's authored rest height, captured once per station
  const ramY0 = useRef<Record<string, number>>({});

  const amb = floor.ambient?.walkers ?? [];
  const opPost = floor.stations.find((s) => s.id === "s_press_1")?.operator_post;

  /* Colour on this map means something, so the movers are kept out of the
     vocabulary that carries it:
       walkers  --dim, a neutral slate. They were --s5 (magenta #d55181), which
                against the dark floor reads as red and sits next to --critical
                #d03b3b and --s8 #e66767 — anonymous passers-by were showing up
                as a dozen alarms.
       operator --s3, the same aqua as the measured station's ground ring. Here
                the association is wanted: this is the one person we can see.
       forklift --s4, the CATEGORICAL yellow, not --warning. A yellow forklift
                is worth keeping, but not out of the status ramp. */
  const bodyMat = useMemo(() => tokenMaterial("--dim", "standard", { roughness: 0.85 }), []);
  const opMat = useMemo(() => tokenMaterial("--s3", "standard", { roughness: 0.7 }), []);
  const fkMat = useMemo(() => tokenMaterial("--s4", "standard", { roughness: 0.6 }), []);

  useFrame((state, delta) => {
    // R3F's getDelta() hands back the whole gap after a tab regains focus; an
    // unclamped dt teleports every mover across the floor in one frame
    const dt = Math.min(delta, 0.1);
    const F = floorFrame(state.clock.elapsedTime);

    /* The measured ram integrates a velocity signal, so it must integrate the
       time that SIGNAL moved through, not the time the wall clock moved
       through. They differ whenever the playhead is not at 1x: at 4x the
       recording advances four seconds per wall second, and integrating `delta`
       swept the ram through a quarter of its stroke — a twitch instead of a
       stroke, and a different twitch at every playback rate.

       A big jump is a scrub, not motion, so it is clamped: resync rather than
       integrate half a minute of signal in one frame. */
    const dtV = prevT.current === null ? 0
      : Math.min(0.25, Math.max(0, F.t - prevT.current));
    prevT.current = F.t;

    /* ---- rams ---------------------------------------------------------- */
    for (const st of floor.stations) {
      const refs = pressRefs.current[st.id];
      const ram = refs?.ram;
      if (!ram) continue;
      if (ramY0.current[st.id] === undefined) ramY0.current[st.id] = ram.position.y;

      let norm: number;
      if (st.instrumented) {
        // MEASURED: integrate the real signal, frame-rate independently
        norm = advanceSlide(ramPos.current[st.id] ?? PARK, F.vy, F.ps, dtV, reduce);
      } else {
        const sim = F.status.get(st.id);
        // SIMULATED: closed form, so scrubbing to t always shows the same
        // phase as playing to t. Gated by the declared interval table — a
        // press that the table says is idle does not stroke.
        norm = sim?.running
          ? closedFormSlide(F.t, st.sim?.spm ?? 0, st.sim?.phase ?? 0)
          : PARK;
        if (!sim?.running && !reduce) {
          // ease into the park rather than snapping when a run ends
          norm = THREE.MathUtils.damp(ramPos.current[st.id] ?? PARK, PARK, 2.5, dt);
        }
      }
      ramPos.current[st.id] = norm;
      ram.position.y = ramY0.current[st.id] - norm * st.ram.travel;

      /* ---- flywheels --------------------------------------------------- */
      const fw = refs?.flywheel;
      if (fw) {
        const spm = st.instrumented
          ? (F.ps === 0 ? 0 : (F.status.get(st.id)?.spm ?? 0))
          : (F.status.get(st.id)?.running ? st.sim?.spm ?? 0 : 0);
        if (spm > 0 && !reduce) {
          // A flywheel turns many times per stroke — it is geared down to the
          // crank, not locked to it. 8:1 keeps it visibly spinning at 5 spm
          // without strobing into a standstill at 60 fps.
          fw.rotateY((spm / 60) * 8 * Math.PI * 2 * dt);
        }
      }
    }

    /* ---- the operator at the instrumented press ------------------------ */
    // PRESENCE IS MEASURED, POSITION IS NOT. The detector box is image-space
    // pixels from a camera with no known extrinsics; projecting it to floor
    // coordinates would be invented precision. So: a binary at a declared post,
    // and any drift along it is a slow 1-D slide on a 2 m segment, labelled
    // inferred in the card and the legend.
    const op = operator.current;
    if (op && opPost) {
      const [a, b] = opPost.pts;
      const want = F.operator ? 1 : 0;
      const vis = THREE.MathUtils.damp(op.scale.y || 0.001, want, 6, dt);
      op.scale.setScalar(reduce ? want : Math.max(0.001, vis));
      op.visible = vis > 0.02;
      const k = reduce ? 0.5 : 0.5 + 0.5 * Math.sin(F.t * 0.09);
      op.position.set(a[0] + (b[0] - a[0]) * k, 0, a[1] + (b[1] - a[1]) * k);
    }

    /* ---- the forklift: three measured visits --------------------------- */
    const fk = forklift.current;
    const route = ways.get("fk_route");
    if (fk && route) {
      if (F.forklift < 0) {
        fk.visible = false;
      } else {
        fk.visible = true;
        // in (0 -> 0.38), stand at the press (0.38 -> 0.62), out (0.62 -> 1)
        const u = F.forklift < 0.38 ? F.forklift / 0.38
          : F.forklift < 0.62 ? 1
          : 1 - (F.forklift - 0.62) / 0.38;
        const head = route.at(THREE.MathUtils.clamp(u, 0, 1), _v2);
        fk.position.set(_v2.x, 0, _v2.y);
        easing.dampAngle(fk.rotation, "y", F.forklift < 0.62 ? head : head + Math.PI,
                         reduce ? 0 : 0.25, dt);
      }
    }

    /* ---- ambient walkers ----------------------------------------------- */
    // Raw instancedMesh and ONE loop: fifteen refs each doing identical maths
    // is the case the plan says to instance, and it is the only one here.
    const w = walkers.current;
    if (w && !reduce) {
      amb.forEach((a, i) => {
        const way = ways.get(a.path);
        if (!way) return;
        const u = way.loop(a.phase + (F.t * way.speed) / way.total);
        const head = way.at(u, _v2);
        _q.setFromAxisAngle(UP, head);
        _m.compose(_p.set(_v2.x, BODY_H / 2, _v2.y), _q, _s.set(0.46, BODY_H, 0.3));
        w.setMatrixAt(i, _m);
      });
      w.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group>
      {/* ambient people — no status, no identity, no label */}
      <instancedMesh ref={walkers} args={[UNIT_BOX, undefined, Math.max(1, amb.length)]}
                     material={bodyMat} frustumCulled={false} raycast={() => null} />

      {/* the operator at Press 200 */}
      <group ref={operator} visible={false}>
        <mesh geometry={UNIT_BOX} material={opMat} raycast={() => null}
              position-y={BODY_H * 0.55} scale={[0.5, BODY_H * 0.9, 0.34]} />
        <mesh geometry={UNIT_CYL} material={opMat} raycast={() => null}
              position-y={BODY_H * 1.06} scale={[0.17, 0.2, 0.17]} />
      </group>

      {/* the forklift */}
      <group ref={forklift} visible={false}>
        <mesh geometry={UNIT_BOX} material={fkMat} raycast={() => null}
              position-y={0.55} scale={[1.0, 0.9, 1.9]} />
        <mesh geometry={UNIT_BOX} material={fkMat} raycast={() => null}
              position={[0, 1.25, -0.2]} scale={[0.86, 0.5, 0.86]} />
        {/* forks, pointing the way it travels */}
        <mesh geometry={UNIT_BOX} material={fkMat} raycast={() => null}
              position={[0, 0.12, 1.5]} scale={[0.72, 0.1, 1.2]} />
      </group>
    </group>
  );
}
