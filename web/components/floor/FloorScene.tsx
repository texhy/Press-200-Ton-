"use client";
import { useRef, useEffect, useMemo, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { MapControls, ContactShadows, PerformanceMonitor, AdaptiveDpr } from "@react-three/drei";
import * as THREE from "three";
import { easing } from "maath";
import type { Day, Pulse, Severity } from "@/lib/types";
import type { FloorData } from "@/lib/floor";
import { useCursor } from "@/lib/cursor";
import { tokenColor, tokenMaterial, watchTheme, watchReducedMotion } from "@/lib/tokens3d";
import { LabelLayer, LabelProjector, type LabelMap } from "./Labels";
import { floorFrame, setFrameSource } from "./frame";

import { Press, type PressRefs } from "./Press";
import { Movers } from "./Movers";
import { UNIT_BOX as BOX, RING, DASHED_RING, HALO_RING } from "./pressGeometry";

const SEV_TOKEN: Record<Severity, string> = {
  ok: "--good", info: "--s1", warning: "--warning", serious: "--serious", critical: "--critical",
};

/* ------------------------------------------------------------------ floor */
function FloorPlate({ floor }: { floor: FloorData }) {
  const grid = useMemo(() => {
    const g = new THREE.GridHelper(Math.max(floor.floor.w, floor.floor.d), 
                                   Math.max(floor.floor.w, floor.floor.d), 0x000000, 0x000000);
    (g.material as THREE.Material).opacity = 0.14;
    (g.material as THREE.Material).transparent = true;
    return g;
  }, [floor]);
  useEffect(() => {
    const c = tokenColor("--grid");
    const m = grid.material as THREE.LineBasicMaterial;
    m.color.copy(c);
  }, [grid]);

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.01} receiveShadow={false}
            geometry={BOX} scale={[floor.floor.w, floor.floor.d, 0.02]}
            material={tokenMaterial("--surface", "standard", { roughness: 0.95, metalness: 0 })}
            raycast={() => null} />
      <primitive object={grid} position-y={0.012} raycast={() => null} />
    </group>
  );
}

/* ------------------------------------------------------------- stations */

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);

const RING_Y = 0.02;
const ringRadius = (st: { dims: { w: number; d: number } }) =>
  Math.max(st.dims.w, st.dims.d) * 0.78;

function Stations({ floor, selected, onRefs }: {
  floor: FloorData; selected: string | null;
  onRefs: (map: Record<string, PressRefs>) => void;
}) {
  const n = floor.stations.length;
  const beacons = useRef<THREE.InstancedMesh>(null);
  const solid = useRef<THREE.InstancedMesh>(null);
  const dashed = useRef<THREE.InstancedMesh>(null);
  const halo = useRef<THREE.Mesh>(null);
  const press = useRef<Record<string, PressRefs>>({});
  const lastSev = useRef<string[]>([]);
  const lastHidden = useRef<boolean[]>([]);
  const sel = useRef<string | null>(null);
  useEffect(() => { sel.current = selected; }, [selected]);

  /* Rings are split by PROVENANCE, not by status: measured stations get a solid
     decal, simulated ones a dashed one. Two geometries means two instanced
     meshes instead of one, which is the price of the rule that the three
     classes survive a greyscale screenshot — see DASHED_RING. */
  const solidIdx = useMemo(
    () => floor.stations.map((s, i) => [s, i] as const).filter(([s]) => s.instrumented),
    [floor]);
  const dashedIdx = useMemo(
    () => floor.stations.map((s, i) => [s, i] as const).filter(([s]) => !s.instrumented),
    [floor]);
  // station index -> [which instanced mesh, slot in it]
  const ringSlot = useMemo(() => {
    const m = new Map<number, [0 | 1, number]>();
    solidIdx.forEach(([, i], k) => m.set(i, [0, k]));
    dashedIdx.forEach(([, i], k) => m.set(i, [1, k]));
    return m;
  }, [solidIdx, dashedIdx]);

  // three shared materials cover all twelve presses
  const body = tokenMaterial("--muted", "standard", { roughness: 0.62, metalness: 0.22 });
  const dark = tokenMaterial("--axis", "standard", { roughness: 0.5, metalness: 0.35 });
  const accent = tokenMaterial("--ink-2", "standard", { roughness: 0.45, metalness: 0.4 });

  const setRing = (st: (typeof floor.stations)[number], i: number, show: boolean) => {
    const slot = ringSlot.get(i);
    if (!slot) return;
    const mesh = (slot[0] === 0 ? solid : dashed).current;
    if (!mesh) return;
    const rad = show ? ringRadius(st) : 0;
    _q.setFromAxisAngle(AXIS_X, -Math.PI / 2);
    _m.compose(_p.set(st.pos[0], RING_Y, st.pos[2]), _q, _s.set(rad, rad, 1));
    mesh.setMatrixAt(slot[1], _m);
    mesh.instanceMatrix.needsUpdate = true;
  };

  /* The beacons and decal rings were 24 separate meshes, each with a ref, all
     running the same material swap every frame — 22 draw calls spent on
     identical work. Instanced, they cost three, and the per-station colour
     rides in instanceColor. This is the instancing criterion from the plan: not
     the count, but holding N refs for one loop of identical maths. */
  useEffect(() => {
    const b = beacons.current;
    if (!b) return;
    floor.stations.forEach((st, i) => {
      const [x, , z] = st.pos;
      const { w, h, d } = st.dims;
      // the measured station's beacon is taller as well as differently ringed,
      // so the one real station is findable without reading a chip
      // A LAMP ON A MAST, not a painted roof. At w*0.64 x d*0.5 the beacon
      // covered most of the crown, and from the overview — which is close to a
      // plan view — the press simply read as a green slab: the status became
      // the building. Small, lifted clear of the crown, and the floor ring does
      // the heavy lifting at low zoom.
      const bh = st.instrumented ? 0.42 : 0.3;
      _q.setFromAxisAngle(AXIS_Y, st.rot);
      _m.compose(_p.set(x, h + 0.55 + bh / 2, z), _q,
                 _s.set(Math.min(w * 0.3, 0.55), bh, Math.min(d * 0.3, 0.55)));
      b.setMatrixAt(i, _m);
      setRing(st, i, true);
      lastHidden.current[i] = false;
    });
    b.instanceMatrix.needsUpdate = true;
    b.computeBoundingSphere();
    solid.current?.computeBoundingSphere();
    dashed.current?.computeBoundingSphere();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor, ringSlot]);

  useFrame((state) => {
    const F = floorFrame(state.clock.elapsedTime);
    const b = beacons.current;
    if (!b) return;
    let changed = false;
    floor.stations.forEach((st, i) => {
      const sev = F.status.get(st.id)?.severity ?? "none";
      if (lastSev.current[i] !== sev) {
        lastSev.current[i] = sev;
        changed = true;
        // NO COVERAGE is not a status: the beacon goes to grid grey and the
        // decal disappears entirely, so "we are not watching this" can never be
        // mistaken for "this is fine".
        const none = sev === "none";
        _c.copy(none ? tokenColor("--grid") : tokenColor(SEV_TOKEN[sev as Severity]));
        b.setColorAt(i, _c);
        const slot = ringSlot.get(i);
        if (slot) (slot[0] === 0 ? solid : dashed).current?.setColorAt(slot[1], _c);
        if (lastHidden.current[i] !== none) {
          lastHidden.current[i] = none;
          setRing(st, i, !none);
        }
      }
    });
    if (changed) {
      if (b.instanceColor) b.instanceColor.needsUpdate = true;
      if (solid.current?.instanceColor) solid.current.instanceColor.needsUpdate = true;
      if (dashed.current?.instanceColor) dashed.current.instanceColor.needsUpdate = true;
    }

    // hover/selection halo: ONE mesh moved to the active station rather than
    // twelve that spend a draw call each waiting to be needed
    const h = halo.current;
    if (h) {
      const id = useCursor.getState().hovered ?? sel.current;
      const st = id ? floor.stations.find((x) => x.id === id) : undefined;
      h.visible = !!st;
      if (st) {
        const rad = ringRadius(st);
        h.position.set(st.pos[0], RING_Y + 0.01, st.pos[2]);
        h.scale.set(rad, rad, 1);
      }
    }
  });

  return (
    <group>
      {floor.stations.map((st) => (
        <Press key={st.id} station={st} body={body} dark={dark} accent={accent}
               onRefs={(x) => { press.current[st.id] = x; onRefs(press.current); }} />
      ))}
      {/* unlit — a status colour on a LIT surface is multiplied by N·L and the
          validated contrast stops being true */}
      <instancedMesh ref={beacons} args={[BOX, undefined, n]} frustumCulled={false} raycast={() => null}>
        <meshBasicMaterial />
      </instancedMesh>
      <instancedMesh ref={solid} args={[RING, undefined, Math.max(1, solidIdx.length)]}
                     frustumCulled={false} raycast={() => null}>
        <meshBasicMaterial side={THREE.DoubleSide} />
      </instancedMesh>
      <instancedMesh ref={dashed} args={[DASHED_RING, undefined, Math.max(1, dashedIdx.length)]}
                     frustumCulled={false} raycast={() => null}>
        <meshBasicMaterial side={THREE.DoubleSide} />
      </instancedMesh>
      <mesh ref={halo} geometry={HALO_RING} rotation-x={-Math.PI / 2} visible={false}
            material={tokenMaterial("--ink", "basic")} raycast={() => null} />
      {/* the one measured station keeps its own aqua ground ring */}
      {floor.stations.filter((st) => st.instrumented).map((st) => (
        <mesh key={st.id} geometry={RING} rotation-x={-Math.PI / 2}
              position={[st.pos[0], 0.03, st.pos[2]]}
              scale={Math.max(st.dims.w, st.dims.d) * 0.95}
              material={tokenMaterial("--s3", "basic")} raycast={() => null} />
      ))}
    </group>
  );
}

/* --------------------------------------------------------- maintenance room */
/** The room this screen lives in, so the floor has a "you are here".
 *
 *  It was one box in `--axis` (#2b333b), which is within a few percent of the
 *  floor plate's own tone: the geometry was there, correctly sized, and simply
 *  could not be seen. A building needs a value step from its ground, so this is
 *  walls in `--raised`, a lighter roof slab reading as a lid, and a door on the
 *  face the aisle approaches. It carries no status colour — it is not a station. */
function Room({ floor }: { floor: FloorData }) {
  const { pos, dims } = floor.room;
  const [x, z] = pos;
  const wall = tokenMaterial("--raised", "standard", { roughness: 0.9, metalness: 0.02 });
  const roof = tokenMaterial("--surface", "standard", { roughness: 0.8, metalness: 0.04 });
  const trim = tokenMaterial("--axis", "standard", { roughness: 0.7, metalness: 0.1 });
  return (
    <group position={[x, 0, z]}>
      <mesh geometry={BOX} position-y={dims.h / 2} raycast={() => null}
            scale={[dims.w, dims.h, dims.d]} material={wall} />
      <mesh geometry={BOX} position-y={dims.h + 0.07} raycast={() => null}
            scale={[dims.w * 1.06, 0.14, dims.d * 1.06]} material={roof} />
      {/* door on the aisle side (-z), where floor.room.door approaches from */}
      <mesh geometry={BOX} position={[0, 1.05, -dims.d / 2 - 0.02]} raycast={() => null}
            scale={[1.5, 2.1, 0.08]} material={trim} />
    </group>
  );
}

/* ------------------------------------------------------------ pick proxies */
function PickProxies({ floor, onPick }: { floor: FloorData; onPick: (id: string) => void }) {
  const { setHovered } = useCursor();
  // 13 invisible boxes are the ONLY raycast targets; every decorative mesh
  // carries raycast={() => null}. Takes the raycast set from ~105 to 13.
  return (
    <group
      onPointerOver={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        const id = e.object.userData.station as string | undefined;
        if (id) { setHovered(id); document.body.style.cursor = "pointer"; }
      }}
      onPointerOut={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation(); setHovered(null); document.body.style.cursor = "";
      }}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        const id = e.object.userData.station as string | undefined;
        if (id) onPick(id);
      }}>
      {floor.stations.map((s) => (
        <mesh key={s.id} geometry={BOX} userData={{ station: s.id }}
              position={[s.pos[0], s.dims.h / 2, s.pos[2]]}
              scale={[s.dims.w * 1.15, s.dims.h, s.dims.d * 1.15]}>
          {/* kept visible — three's raycaster SKIPS visible === false */}
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------ camera rig */
function Rig({ view, reduce }: { view: { pos: number[]; target: number[]; zoom: number } | null; reduce: boolean }) {
  const { camera, controls } = useThree() as { camera: THREE.OrthographicCamera; controls: { target: THREE.Vector3; update: () => void } | null };
  const want = useRef<typeof view>(null);
  useEffect(() => { want.current = view; }, [view]);

  useFrame((_, delta) => {
    const w = want.current;
    if (!w || !controls) return;
    const d = Math.min(delta, 0.1);
    if (reduce) {
      camera.position.set(w.pos[0], w.pos[1], w.pos[2]);
      controls.target.set(w.target[0], w.target[1], w.target[2]);
      camera.zoom = w.zoom;
    } else {
      easing.damp3(camera.position, [w.pos[0], w.pos[1], w.pos[2]], 0.35, d);
      easing.damp3(controls.target, [w.target[0], w.target[1], w.target[2]], 0.35, d);
      easing.damp(camera, "zoom", w.zoom, 0.35, d);
    }
    camera.updateProjectionMatrix();
    controls.update();
  });
  return null;
}

/* ----------------------------------------------------------------- scene */
export function FloorScene({ floor, day, pulse, onSelect, view, selected }: {
  floor: FloorData; day: Day | null; pulse: Pulse | null;
  onSelect: (id: string) => void;
  view: { pos: number[]; target: number[]; zoom: number } | null;
  selected: string | null;
}) {
  const labels = useRef<LabelMap>(new Map());
  const pressRefs = useRef<Record<string, PressRefs>>({});
  const [dpr, setDpr] = useState(1.5);
  const [reduce, setReduce] = useState(false);
  const { playing } = useCursor();

  useEffect(() => setFrameSource(floor, day, pulse), [floor, day, pulse]);
  useEffect(() => watchReducedMotion(setReduce), []);

  return (
    <div className="relative w-full h-full">
      <Canvas
        flat                                   /* R3F defaults to ACESFilmic tone mapping,
                                                  which would hue-shift every token */
        orthographic
        dpr={dpr}
        camera={{ position: [0, 34, 28], zoom: 23, near: 0.1, far: 400 }}
        gl={{ antialias: true, powerPreference: "default" }}
        frameloop={playing || !reduce ? "always" : "demand"}
        onCreated={({ gl, scene, camera }) => {
          // allow the browser to restore rather than kill the context
          gl.domElement.addEventListener("webglcontextlost", (e) => e.preventDefault());
          // dev-only handle so the perf budget (draw calls, geometry count) is
          // actually measurable from outside; R3F v9 no longer puts its store
          // on the DOM node
          if (process.env.NODE_ENV === "development") {
            const w = window as unknown as Record<string, unknown>;
            w.__floorGL = gl;
            w.__floorScene = scene;
            w.__floorCam = camera;
          }
        }}>
        <PerformanceMonitor onDecline={() => setDpr(1)} />
        <AdaptiveDpr pixelated={false} />
        <ThemeBridge />
        <hemisphereLight intensity={0.85} groundColor={0x1a1f24} />
        <directionalLight position={[14, 24, 12]} intensity={1.0} castShadow={false} />
        <directionalLight position={[-12, 14, -8]} intensity={0.3} castShadow={false} />
        <FloorPlate floor={floor} />
        <Stations floor={floor} selected={selected}
                  onRefs={(m) => { pressRefs.current = m; }} />
        <Room floor={floor} />
        <Movers floor={floor} pressRefs={pressRefs} reduce={reduce} />
        <PickProxies floor={floor} onPick={onSelect} />
        <ContactShadows frames={1} resolution={512} scale={52} blur={2.4}
                        opacity={0.3} far={9} position-y={0.015} />
        <LabelProjector floor={floor} labels={labels} />
        <MapControls makeDefault
                     /* rotation ON as asked, but polar-clamped so the floor
                        can never be viewed from underneath or dead-on top */
                     enableRotate
                     minPolarAngle={0.22} maxPolarAngle={Math.PI / 2 - 0.12}
                     minZoom={12} maxZoom={110}
                     enableDamping dampingFactor={0.08}
                     screenSpacePanning={false} />
        <Rig view={view} reduce={reduce} />
      </Canvas>
      <LabelLayer floor={floor} labels={labels} onSelect={onSelect} />
    </div>
  );
}

/** Repaints shared materials on theme change without a single React render. */
function ThemeBridge() {
  const { invalidate } = useThree();
  useEffect(() => watchTheme(invalidate), [invalidate]);
  return null;
}
