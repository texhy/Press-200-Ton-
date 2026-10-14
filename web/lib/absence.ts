import type { CvTimeline, Day, Gap } from "./types";

/** OPERATOR ABSENCE, MEASURED.
 *
 *  Every other cause on the downtime screen is a label the mock PLC handed to a
 *  gap. This one is not: it is read straight off the vision pass, frame by
 *  frame, from whether the operator box exists at all (`w === null`).
 *
 *  Two things have to be handled or the number is wrong:
 *
 *  1. FLICKER. The detector drops the operator for a frame or two constantly —
 *     133 separate runs, median 0.4 s. Counting those would claim ~24 min of
 *     absence out of a 53 min recording, which is nonsense. Only runs of at
 *     least MIN_ABSENCE_S are real walk-aways: that cut leaves 4 runs.
 *
 *  2. DIE CHANGE. During a die swap the operator is away because the die is
 *     being swapped — that is changeover time, not an absent operator, and it
 *     is already on the board. The exclusion window comes from the CAMERA, not
 *     from day.json: the monitor's own `die_changes` episodes unioned with the
 *     per-frame `dc` flag. Three of the four runs fall entirely inside it.
 *
 *  3. DOUBLE COUNTING generally. Whatever survives is also checked against the
 *     remaining gaps, so absence can never be charged twice.
 *
 *  What survives all three in this recording is a single stretch,
 *  09:49–10:05, where the press is STILL, the stroke counter does not move and
 *  nobody is in frame. That is genuine unattended downtime and nothing else on
 *  the screen accounts for it. */

/** below this, an absence run is detector flicker rather than a walk-away */
const MIN_ABSENCE_S = 30;

type Run = { a: number; b: number };

/** Contiguous stretches the camera calls a die change, in video seconds.
 *
 *  Two sources, unioned because they disagree slightly: the episode record in
 *  `die_changes` (26.8–1316.0 s here) and the per-frame `dc` flag
 *  (509.3–1322.7 s). Taking both is the conservative read — any second either
 *  one calls a die change is excluded from absence. */
function dieChangeWindows(cv: CvTimeline): Run[] {
  const out: Run[] = (cv.die_changes ?? [])
    .filter((d) => typeof d.start_s === "number" && typeof d.end_s === "number")
    .map((d) => ({ a: d.start_s, b: d.end_s }));

  const fr = cv.frames ?? [];
  const dt = 1 / (cv.overlay_hz || 5);
  let start: number | null = null;
  for (let i = 0; i < fr.length; i++) {
    const on = fr[i].dc === 1;
    if (on && start === null) start = fr[i].t;
    if (!on && start !== null) { out.push({ a: start, b: fr[i - 1].t + dt }); start = null; }
  }
  if (start !== null) out.push({ a: start, b: fr[fr.length - 1].t + dt });
  return out;
}

/** Contiguous stretches with no operator box, in video seconds. */
function absenceRuns(cv: CvTimeline): Run[] {
  const fr = cv.frames;
  if (!fr?.length) return [];
  const dt = 1 / (cv.overlay_hz || 5);
  const out: Run[] = [];
  let start: number | null = null;
  for (let i = 0; i < fr.length; i++) {
    const gone = fr[i].w == null;
    if (gone && start === null) start = fr[i].t;
    if (!gone && start !== null) { out.push({ a: start, b: fr[i - 1].t + dt }); start = null; }
  }
  if (start !== null) out.push({ a: start, b: fr[fr.length - 1].t + dt });
  return out.filter((r) => r.b - r.a >= MIN_ABSENCE_S);
}

/** Cut every window out of a run, leaving only the parts nothing covers. */
function subtract(run: Run, windows: Run[]): Run[] {
  let pieces: Run[] = [run];
  for (const wdw of windows) {
    const next: Run[] = [];
    for (const p of pieces) {
      if (wdw.b <= p.a || wdw.a >= p.b) { next.push(p); continue; }  // no overlap
      if (wdw.a > p.a) next.push({ a: p.a, b: wdw.a });               // piece before
      if (wdw.b < p.b) next.push({ a: wdw.b, b: p.b });               // piece after
    }
    pieces = next;
  }
  return pieces;
}

const gapWindows = (gaps: Gap[]): Run[] => gaps.map((g) => ({ a: g.t0, b: g.t1 }));

/** Synthetic gaps for operator absence the rest of the board does not explain. */
export function operatorAbsenceGaps(cv: CvTimeline | null, day: Day | null): Gap[] {
  if (!cv || !day) return [];
  const camT0 = day.camera.start_min * 60;          // video t=0 in seconds-of-day
  const plan_spm = day.job?.takt_sec ? 60 / day.job.takt_sec : 0;

  // die-change windows are in VIDEO seconds; shift them onto the day clock
  const die = dieChangeWindows(cv).map((r) => ({ a: camT0 + r.a, b: camT0 + r.b }));
  const exclude = [...die, ...gapWindows(day.gaps)];

  const out: Gap[] = [];
  for (const run of absenceRuns(cv)) {
    const wall = { a: camT0 + run.a, b: camT0 + run.b };
    for (const p of subtract(wall, exclude)) {
      const dur = p.b - p.a;
      if (dur < MIN_ABSENCE_S) continue;
      const minutes = Math.round((dur / 60) * 10) / 10;
      const m0 = Math.floor(p.a / 60), m1 = Math.floor(p.b / 60);
      out.push({
        id: `oa${Math.round(p.a)}`,
        m0, m1, t0: p.a, t1: p.b, dur_s: dur,
        cause: "operator_absent",
        confidence: "certain",
        label: "Operator absent — press idle, nobody in frame",
        why: "camera: no operator detected and the stroke counter did not move",
        evidence: [
          { t: p.a, label: "Operator leaves frame", kind: "cause", src: "cv",
            detail: "vision pass: operator box lost for the whole stretch" },
          { t: p.b, label: "Coverage ends", kind: "resume", src: "cv",
            detail: "end of the recorded window" },
        ],
        cost: {
          minutes,
          strokes: Math.round(minutes * plan_spm),
          parts: Math.round(minutes * plan_spm),
          pkr: 0,                       // no VFD reading is attributed to this
        },
        motor_on: false,
        camera: true,                   // the only cause here that is measured
      });
    }
  }
  return out;
}

/** Minutes of absence that fall inside a die change or another stop — shown as
 *  context so the screen does not look like it lost time it already counted. */
export function absenceInsideOtherGaps(cv: CvTimeline | null, day: Day | null): number {
  if (!cv || !day) return 0;
  const camT0 = day.camera.start_min * 60;
  const exclude = [
    ...dieChangeWindows(cv).map((r) => ({ a: camT0 + r.a, b: camT0 + r.b })),
    ...gapWindows(day.gaps),
  ];
  let total = 0;
  for (const run of absenceRuns(cv)) {
    const wall = { a: camT0 + run.a, b: camT0 + run.b };
    const free = subtract(wall, exclude).reduce((s, p) => s + (p.b - p.a), 0);
    total += (wall.b - wall.a) - free;
  }
  return Math.round((total / 60) * 10) / 10;
}
