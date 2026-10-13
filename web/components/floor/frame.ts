"use client";
import type { Day, Pulse } from "@/lib/types";
import type { FloorData } from "@/lib/floor";
import { allStatuses, type StationStatus } from "@/lib/floorStatus";
import { inSpan } from "@/lib/floor";
import { useCursor } from "@/lib/cursor";

/** PER-FRAME DERIVED STATE, COMPUTED ONCE.
 *
 *  Twelve statuses, the slide signal, operator presence and the forklift are
 *  all needed by several useFrame callbacks in the same frame. Recomputing per
 *  consumer is waste; ordering the callbacks is a trap —
 *    - useFrame(cb, priority > 0) DISABLES R3F's automatic render, so priority
 *      cannot be used merely for ordering;
 *    - useFrame subscribes in a layout effect and child layout effects run
 *      BEFORE the parent's, so tree order is the reverse of intuition.
 *
 *  So: a lazy cache keyed on the frame's stable clock value. Whichever consumer
 *  runs first pays; the rest get it free, in any order. */
export interface FloorFrame {
  /** clock seconds (seconds since midnight) */
  t: number;
  /** seconds into the recording, or -1 outside camera coverage */
  vt: number;
  /** the measured slide signal at the playhead; 0 when not covered */
  vy: number;
  /** the monitor's slide state: 0 NO SIGNAL, 1 rise, 2 still, 3 down */
  ps: 0 | 1 | 2 | 3;
  /** is the operator at the instrumented press — a BINARY, never a position */
  operator: boolean;
  /** progress 0..1 through the active forklift visit, or -1 for none */
  forklift: number;
  dieChange: boolean;
  status: Map<string, StationStatus>;
}

let key = -1;
let cache: FloorFrame | null = null;
let src: { floor: FloorData; day: Day | null; pulse: Pulse | null } | null = null;

export function setFrameSource(floor: FloorData, day: Day | null, pulse: Pulse | null) {
  src = { floor, day, pulse };
  key = -1;              // force recompute on the next frame
}

const EMPTY: FloorFrame = {
  t: 0, vt: -1, vy: 0, ps: 0, operator: false, forklift: -1,
  dieChange: false, status: new Map(),
};

function compute(t: number): FloorFrame {
  if (!src) return { ...EMPTY, t };
  const { floor, day, pulse } = src;
  const ev = floor.events["s_press_1"];
  const covered = !!ev && inSpan(t, ev.coverage_s);

  let vt = -1, vy = 0, ps: 0 | 1 | 2 | 3 = 0;
  if (covered && day && pulse) {
    vt = t - day.camera.start_min * 60;
    if (vt >= 0 && vt <= pulse.video_s) {
      const i = Math.min(pulse.vy.length - 1, Math.round(vt * pulse.hz));
      vy = pulse.vy[i] ?? 0;
      // pulse.json carries no state channel, so it is derived from the signal
      // with the monitor's own --press-still-vy threshold. Outside coverage it
      // stays 0 = NO SIGNAL, which is the honest answer and parks the ram.
      ps = vy > 0.35 ? 3 : vy < -0.35 ? 1 : 2;
    } else {
      vt = -1;
    }
  }

  let forklift = -1;
  if (ev) {
    for (const [a, b] of ev.forklift_visits_s) {
      if (t >= a - FK_LEAD && t < b + FK_LEAD) {
        forklift = (t - (a - FK_LEAD)) / (b - a + 2 * FK_LEAD);
        break;
      }
    }
  }

  return {
    t, vt, vy, ps,
    operator: !!ev && covered && inSpan(t, ev.operator_present_s),
    forklift,
    dieChange: !!ev && inSpan(t, ev.die_change_s),
    status: allStatuses(floor, day, t),
  };
}

/** The detector sees the forklift for 1-2 s at each end of a visit. Driving the
 *  model off that alone would teleport it in and out, so each visit is padded
 *  by this much at both ends to cover the approach and the departure. The
 *  SIGHTINGS are measured; the drive in and out is inferred, and the floor map
 *  labels it as such. */
const FK_LEAD = 14;

export function floorFrame(elapsed: number): FloorFrame {
  if (elapsed !== key || !cache) {
    key = elapsed;
    // getState(), NOT useCursor() — a subscription here would re-render the
    // whole 3D tree 60 times a second
    cache = compute(useCursor.getState().t);
  }
  return cache;
}
