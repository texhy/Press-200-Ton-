import * as THREE from "three";
import type { FloorPath } from "@/lib/floor";

/** Arc-length parameterisation of a floor path.
 *
 *  Walking a polyline by segment index moves fast down long legs and crawls
 *  around corners, which reads as broken rather than as a person. Precomputing
 *  cumulative length lets u be real distance, so speed is the declared
 *  speed_mps everywhere on the path. */
export class Walkway {
  readonly pts: [number, number][];
  readonly closed: boolean;
  readonly speed: number;
  readonly total: number;
  private cum: number[] = [];

  constructor(p: FloorPath) {
    this.pts = p.closed ? [...p.pts, p.pts[0]] : p.pts;
    this.closed = p.closed;
    this.speed = p.speed_mps;
    let acc = 0;
    this.cum.push(0);
    for (let i = 1; i < this.pts.length; i++) {
      acc += Math.hypot(this.pts[i][0] - this.pts[i - 1][0],
                        this.pts[i][1] - this.pts[i - 1][1]);
      this.cum.push(acc);
    }
    this.total = acc || 1;
  }

  /** @param u 0..1 along the path. Writes into `out` (x, z) and returns the
   *  heading in radians so a body can face where it is going. */
  at(u: number, out: THREE.Vector2): number {
    const d = THREE.MathUtils.clamp(u, 0, 1) * this.total;
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < d) i++;
    const a = this.pts[i - 1], b = this.pts[i];
    const seg = this.cum[i] - this.cum[i - 1] || 1;
    const k = (d - this.cum[i - 1]) / seg;
    out.set(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k);
    return Math.atan2(b[0] - a[0], b[1] - a[1]);
  }

  /** Ping-pong for open paths, wrap for closed ones, so an open aisle does not
   *  teleport its walkers back to the start. */
  loop(u: number): number {
    if (this.closed) return u - Math.floor(u);
    const m = u - Math.floor(u / 2) * 2;
    return m > 1 ? 2 - m : m;
  }
}

export function walkways(paths: FloorPath[]): Map<string, Walkway> {
  return new Map(paths.map((p) => [p.id, new Walkway(p)]));
}
