import type { CvTimeline, Day } from "./types";

/** WHAT ONLY THE CAMERA CAUGHT.
 *
 *  Everything else in the report could have come off a PLC. This is the part
 *  that could not, and it is the part worth paying for — so it has to be
 *  genuinely derived, never asserted. Each finding below is computed from the
 *  5 Hz vision pass and carries the window it was observed in, so anyone can
 *  scrub the footage and check it.
 *
 *  Two rules kept throughout:
 *
 *  - Production is judged by the STROKE COUNTER, not by the slide-state signal.
 *    `ps` is 0 ("no signal") for 21% of frames — 407 dropouts where the ROI
 *    gave the monitor nothing. Reading that as a stopped press would invent
 *    eleven minutes of downtime that never happened.
 *  - Die-change time is excluded everywhere. The press is meant to be stopped
 *    during a changeover; counting it as lost would be dishonest and would
 *    swamp the findings that matter.
 */

export type Severity = "high" | "medium" | "info";

export interface Finding {
  id: string;
  title: string;
  /** the headline number, already formatted */
  value: string;
  /** clock window it was observed in, or null for whole-window statistics */
  when: string | null;
  /** minutes of the watched window this consumed; null for ratio statistics
   *  like cycle dwell, which describe every cycle rather than a slice of time */
  minutes: number | null;
  detail: string;
  /** why a PLC could not have told you this */
  onlyCamera: string;
  severity: Severity;
}

const fmtMin = (m: number) => {
  const r = Math.round(m);
  return r >= 60 ? `${Math.floor(r / 60)}h ${String(r % 60).padStart(2, "0")}m` : `${r} min`;
};

export function detectFindings(cv: CvTimeline | null, day: Day | null): Finding[] {
  if (!cv?.frames?.length || !day) return [];
  const fr = cv.frames;
  const dt = 1 / (cv.overlay_hz || 5);
  const camT0 = day.camera.start_min * 60;
  const clock = (vs: number) => {
    const s = Math.round(camT0 + vs);
    return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}`;
  };

  /** the stroke counter has not moved in the next 5 s — the press is not making
   *  parts right now, whatever the slide-state signal happens to say */
  const stalled = fr.map((f, i) => fr[Math.min(i + 25, fr.length - 1)].c === f.c);

  const spans = (ok: (f: typeof fr[number], i: number) => boolean, minS: number) => {
    const out: { a: number; b: number }[] = [];
    let s: number | null = null;
    fr.forEach((f, i) => {
      const v = ok(f, i);
      if (v && s === null) s = f.t;
      if (!v && s !== null) { out.push({ a: s, b: fr[i - 1].t + dt }); s = null; }
    });
    if (s !== null) out.push({ a: s, b: fr[fr.length - 1].t + dt });
    return out.filter((r) => r.b - r.a >= minS);
  };
  const total = (rs: { a: number; b: number }[]) => rs.reduce((n, r) => n + (r.b - r.a), 0) / 60;

  const out: Finding[] = [];

  /* ---- 1. work staged, nobody attending ------------------------------- */
  const waiting = spans(
    (f, i) => (f.sn ?? 0) > 0 && f.w == null && stalled[i] && f.dc !== 1, 60);
  if (waiting.length) {
    const stock = cv.stock?.[0];
    const pieces = stock?.typical_n;
    out.push({
      id: "material-waiting",
      title: "Material staged, nobody at the press",
      value: fmtMin(total(waiting)),
      minutes: total(waiting),
      when: waiting.map((r) => `${clock(r.a)}–${clock(r.b)}`).join(", "),
      detail: `${pieces ? `${pieces} blanks` : "Work"} sat in the tray with the stroke counter `
        + `frozen and no operator in frame. Not a changeover — the press was ready and the `
        + `work was waiting.`,
      onlyCamera: "A PLC sees a stopped press. It cannot see that the material was already there, or that nobody was.",
      severity: "high",
    });
  }

  /* ---- 2. operator present, nothing produced -------------------------- */
  const attended = spans((f, i) => f.w != null && stalled[i] && f.dc !== 1, 120);
  if (attended.length) {
    out.push({
      id: "attended-idle",
      title: "Operator at the press, press not running",
      value: fmtMin(total(attended)),
      minutes: total(attended),
      when: attended.map((r) => `${clock(r.a)}–${clock(r.b)}`).join(", "),
      detail: "Someone was in frame for the whole stretch but no stroke was counted.",
      onlyCamera: "Indistinguishable from a break on any signal the machine produces by itself.",
      severity: "medium",
    });
  }

  /* ---- 3. the cycle is mostly waiting --------------------------------- */
  const ss = cv.stroke_stats;
  if (ss?.dwell_ms && ss.down_ms != null && ss.up_ms != null) {
    const cycle = ss.down_ms + ss.up_ms + ss.dwell_ms;
    const pct = (ss.dwell_ms / cycle) * 100;
    const takt = day.job?.takt_sec ? 60 / day.job.takt_sec : 0;
    out.push({
      id: "cycle-dwell",
      title: "The slide spends most of every cycle standing still",
      value: `${pct.toFixed(0)}%`,
      minutes: null,
      when: null,
      detail: `Down ${ss.down_ms} ms, up ${ss.up_ms} ms, then ${(ss.dwell_ms / 1000).toFixed(1)} s `
        + `waiting to be loaded. Measured ${cv.totals.running_spm} spm against a `
        + `${takt.toFixed(2)} spm takt — the press is not the constraint, the manual load is.`,
      onlyCamera: `At a 200 ms poll a ${ss.down_ms} ms down-stroke is three samples. Phase timing this fine only exists because the camera runs at 25 Hz.`,
      severity: "high",
    });
  }

  /* ---- 4. production stopped before the window did --------------------- */
  let lastStroke = 0;
  for (let i = 1; i < fr.length; i++) if (fr[i].c > fr[i - 1].c) lastStroke = i;
  const tailMin = (fr[fr.length - 1].t - fr[lastStroke].t) / 60;
  if (tailMin >= 5) {
    out.push({
      id: "early-stop",
      title: "Production stopped before the window closed",
      value: fmtMin(tailMin),
      minutes: tailMin,
      when: `last stroke ${clock(fr[lastStroke].t)}`,
      detail: `The final part was pressed at ${clock(fr[lastStroke].t)} and nothing ran `
        + `again before coverage ended at ${clock(fr[fr.length - 1].t)}.`,
      onlyCamera: "The counter simply stops. Only the footage shows whether anyone was there, and whether there was work left to do.",
      severity: "high",
    });
  }

  return out;
}

/* ------------------------------------------------------------- measured */

export interface TimeSlice {
  label: string;
  minutes: number;
  color: string;
  note?: string;
  /** clock window, when the slice is a single observed stretch */
  when?: string;
  /** set when no PLC or drive register could have produced this row — the
   *  sentence that justifies the camera. Absent on ordinary slices. */
  cameraOnly?: string;
}

export interface MeasuredWindow {
  date: string;
  from: string; to: string;
  minutes: number;
  operator: string;
  shift: string;
  part: string; process: string; die: string;
  strokes: number;
  /** min(in, out). You cannot have made more parts than you fed blanks in, so
   *  the lower of the two crossings is the count that survives a challenge. */
  partsMade: number;
  spm: number;
  cycleS: number;
  dieChanges: number;
  sheetEvents: number;
  slices: TimeSlice[];
  /** of the window, the share that actually produced parts */
  productivePct: number;
}

/** The report, built only from what the camera actually saw.
 *
 *  history.json is thirty simulated days; using it to fill a report puts
 *  invented numbers in front of a client. This builds the same document from
 *  the one window that is real — 53 minutes of footage — and says so. Smaller
 *  numbers, but every one of them survives being asked where it came from. */
export function measuredWindow(cv: CvTimeline | null, day: Day | null): MeasuredWindow | null {
  if (!cv?.frames?.length || !day) return null;
  const fr = cv.frames;
  const dt = 1 / (cv.overlay_hz || 5);
  const T = cv.totals;
  const ss = cv.stroke_stats;
  const minutes = (T.seconds ?? 0) / 60;
  if (!minutes) return null;

  const hhmm = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

  const stalled = fr.map((f, i) => fr[Math.min(i + 25, fr.length - 1)].c === f.c);
  const spanMin = (ok: (f: typeof fr[number], i: number) => boolean, minS: number) => {
    const out: number[] = [];
    let s: number | null = null;
    fr.forEach((f, i) => {
      const v = ok(f, i);
      if (v && s === null) s = f.t;
      if (!v && s !== null) { if (fr[i - 1].t + dt - s >= minS) out.push(fr[i - 1].t + dt - s); s = null; }
    });
    if (s !== null && fr[fr.length - 1].t + dt - s >= minS) out.push(fr[fr.length - 1].t + dt - s);
    return out.reduce((a, b) => a + b, 0) / 60;
  };

  const camT0 = day.camera.start_min * 60;
  const clock = (vs: number) => {
    const t = Math.round(camT0 + vs);
    return `${String(Math.floor(t / 3600)).padStart(2, "0")}:${String(Math.floor(t / 60) % 60).padStart(2, "0")}`;
  };
  /** the windows themselves, so a row can say when it happened */
  const windows = (ok: (f: typeof fr[number], i: number) => boolean, minS: number) => {
    const out: { a: number; b: number }[] = [];
    let s2: number | null = null;
    fr.forEach((f, i) => {
      const v = ok(f, i);
      if (v && s2 === null) s2 = f.t;
      if (!v && s2 !== null) { out.push({ a: s2, b: fr[i - 1].t + dt }); s2 = null; }
    });
    if (s2 !== null) out.push({ a: s2, b: fr[fr.length - 1].t + dt });
    return out.filter((r) => r.b - r.a >= minS);
  };
  const label = (ws: { a: number; b: number }[]) =>
    ws.map((w) => `${clock(w.a)}–${clock(w.b)}`).join(", ");

  const dieW = (cv.die_changes ?? []).map((d) => ({ a: d.start_s, b: d.end_s }));
  const absentW = windows((f, i) => (f.sn ?? 0) > 0 && f.w == null && stalled[i] && f.dc !== 1, 60);
  const attendedW = windows((f, i) => f.w != null && stalled[i] && f.dc !== 1, 120);

  const dieMin = dieW.reduce((a, d) => a + (d.b - d.a), 0) / 60;
  const absentMin = absentW.reduce((a, d) => a + (d.b - d.a), 0) / 60;
  const attendedMin = attendedW.reduce((a, d) => a + (d.b - d.a), 0) / 60;
  const dieWhen = label(dieW), absentWhen = label(absentW), attendedWhen = label(attendedW);
  const stockN = cv.stock?.[0]?.typical_n;
  let lastIdx = 0;
  for (let i = 1; i < fr.length; i++) if (fr[i].c > fr[i - 1].c) lastIdx = i;
  const lastStrokeAt = clock(fr[lastIdx].t);
  const producingMin = Math.min(minutes, (T.strokes ?? 0) * (ss?.running_period_s ?? 0) / 60);
  const rest = Math.max(0, minutes - producingMin - dieMin - absentMin - attendedMin);

  return {
    date: day.date,
    from: hhmm(day.camera.start_min),
    to: hhmm(day.camera.end_min),
    minutes,
    operator: day.operator?.name ?? "—",
    shift: day.shift?.label ?? "—",
    part: day.job?.part ?? "", process: day.job?.process ?? "", die: day.job?.die ?? "",
    strokes: T.strokes ?? 0,
    partsMade: Math.min(T.sheet_in ?? 0, T.sheet_out ?? 0),
    spm: T.running_spm ?? 0,
    cycleS: ss?.running_period_s ?? 0,
    dieChanges: (cv.die_changes ?? []).length,
    sheetEvents: (cv.events ?? []).length,
    productivePct: (producingMin / minutes) * 100,
    slices: [
      { label: "Producing parts", minutes: producingMin, color: "#1f5fa8",
        note: `${T.strokes} strokes at ${(ss?.running_period_s ?? 0).toFixed(1)} s each` },
      { label: "Die change", minutes: dieMin, color: "#6c5bbd",
        note: "planned changeover — the press is meant to be down",
        when: dieWhen },
      { label: "Material staged, nobody at the press", minutes: absentMin, color: "#b4472f",
        when: absentWhen,
        note: `${stockN ? `${stockN} blanks ` : "Work "}in the tray, stroke counter frozen, no `
          + `operator in frame. Not a changeover. The last part was pressed at ${lastStrokeAt} `
          + `and nothing ran again before coverage ended.`,
        cameraOnly: "A PLC sees a stopped press. It cannot see that the material was already there, or that nobody was." },
      { label: "Operator present, press not running", minutes: attendedMin, color: "#9a5b00",
        when: attendedWhen,
        note: "Someone in frame for the whole stretch, no stroke counted.",
        cameraOnly: "Indistinguishable from a break on any signal the machine produces by itself." },
      ...(rest > 0.5
        ? [{ label: "Unattributed", minutes: rest, color: "#9aa3ac",
             note: "nothing in the footage explains this" } as TimeSlice]
        : []),
    ].filter((s) => s.minutes > 0.05),
  };
}
