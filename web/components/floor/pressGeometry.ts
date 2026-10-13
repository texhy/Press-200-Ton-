import * as THREE from "three";

/** MODULE-SINGLETON GEOMETRY.
 *
 *  Four buffers serve the whole scene: a unit box and a unit cylinder scaled
 *  per part, one extruded C-profile shared by all eight mechanical presses,
 *  and a ring for the floor decals.
 *
 *  NEVER dispose these in a component cleanup. reactStrictMode double-mounts,
 *  and a cleanup that frees a shared geometry leaves the second mount drawing
 *  nothing — the scene renders once and then goes black. */

export const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
export const UNIT_CYL = new THREE.CylinderGeometry(1, 1, 1, 12);
export const RING = new THREE.RingGeometry(0.98, 1, 48);

/** The C-frame, as one extruded profile.
 *
 *  Three stacked boxes would be cheaper to write and leaves visible corner
 *  seams under flat shading. One ExtrudeGeometry is ~200 triangles, shared
 *  eight times, and has a continuous silhouette — which is the whole point,
 *  since the C is what makes a mechanical press read as a mechanical press.
 *
 *  Profile is built on a unit square so one geometry serves every size:
 *  scale non-uniformly at the mesh. Opens toward +X (the operator side). */
function buildCProfile(t: number): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(1, 0);          // bottom arm, forward
  s.lineTo(1, t);
  s.lineTo(t, t);          // back under the throat
  s.lineTo(t, 1 - t);      // up the spine
  s.lineTo(1, 1 - t);      // top arm, forward
  s.lineTo(1, 1);
  s.lineTo(0, 1);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, curveSegments: 1 });
  // centre on X and Z, sit on Y=0, so the mesh can be scaled by [w, h, d]
  g.translate(-0.5, 0, -0.5);
  return g;
}

/** Throat thickness varies little between our presses; one profile is enough.
 *  Keyed anyway, so a station can opt into a different wall thickness without
 *  anyone reaching for a second geometry by hand. */
const profiles = new Map<number, THREE.ExtrudeGeometry>();
export function cProfile(frameT = 0.34): THREE.ExtrudeGeometry {
  const k = Math.round(frameT * 50) / 50;
  let g = profiles.get(k);
  if (!g) { g = buildCProfile(k); profiles.set(k, g); }
  return g;
}

/** Tie-rod column positions for a 4-column hydraulic frame. */
export function columnOffsets(w: number, d: number, inset: number): [number, number][] {
  const x = w / 2 - inset, z = d / 2 - inset;
  return [[-x, -z], [x, -z], [-x, z], [x, z]];
}

/** A RING OF ARC SEGMENTS — the "simulated" decal.
 *
 *  The page's real failure mode is someone screenshotting it for a customer,
 *  so measured / simulated / no-coverage must stay separable with the colour
 *  thrown away. Colour cannot carry it: a simulated station is allowed its full
 *  status colour, so a red simulated press and a red measured press are the
 *  same pixel value. Form carries it instead:
 *
 *      measured      solid ring
 *      simulated     dashed ring
 *      no coverage   no ring at all, dimmed beacon
 *
 *  Built as one geometry rather than N meshes so both ring sets stay instanced,
 *  which is what keeps the draw-call budget.
 */
function buildDashedRing(segs: number, duty: number, r0: number, r1: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const step = (Math.PI * 2) / segs;
  for (let i = 0; i < segs; i++) {
    const a0 = i * step;
    const a1 = a0 + step * duty;
    const c0 = Math.cos(a0), s0 = Math.sin(a0);
    const c1 = Math.cos(a1), s1 = Math.sin(a1);
    // two triangles per dash, in the XY plane like RingGeometry
    const ix0 = c0 * r0, iy0 = s0 * r0, ox0 = c0 * r1, oy0 = s0 * r1;
    const ix1 = c1 * r0, iy1 = s1 * r0, ox1 = c1 * r1, oy1 = s1 * r1;
    pos.push(ix0, iy0, 0, ox0, oy0, 0, ox1, oy1, 0);
    pos.push(ix0, iy0, 0, ox1, oy1, 0, ix1, iy1, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** 16 dashes at 55% duty: unmistakably broken at overview zoom, still reads as
 *  a ring rather than a dotted circle when you lean in. */
export const DASHED_RING = buildDashedRing(16, 0.55, 0.9, 1);

/** A thicker ring for the hover/selection highlight — one shared mesh moved to
 *  whichever station is active, so hover costs no per-station state. */
export const HALO_RING = new THREE.RingGeometry(1.04, 1.16, 48);
