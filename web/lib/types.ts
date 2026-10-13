/** Shapes emitted by demo_200_press_machine/pipeline/*.py.
 *  Short keys on the per-frame file only — it carries one record per CV sample. */

export type Trust = "measured" | "inferred" | "simulated";
export type Severity = "ok" | "info" | "warning" | "serious" | "critical";

/** Downtime causes. Order is the fixed categorical slot order — entity-locked. */
export const CAUSES = [
  "production", "changeover", "feed_jam", "lubrication", "air",
  "overload", "drive_trip", "micro_stop", "idle_burn", "break",
  "material", "operator_absent", "die_tryout", "breakdown", "unexplained",
] as const;
export type Cause = (typeof CAUSES)[number];

export interface EvidenceStep {
  t: number;            // seconds into the day
  label: string;
  detail: string;
  /** "cause" marks the FIRST signal — the one that explains the gap. */
  kind: "cause" | "consequence" | "action" | "resume";
  src: "plc" | "vfd" | "cv" | "plan";
  seek?: number;        // video seconds, when the camera covered it
}

export interface Gap {
  id: string;
  m0: number; m1: number;          // minute-of-day span
  t0: number; t1: number;          // seconds-of-day span
  dur_s: number;
  cause: Cause;
  confidence: "certain" | "high" | "medium" | "none";
  label: string;
  why: string;
  evidence: EvidenceStep[];
  cost: { minutes: number; strokes: number; parts: number; pkr: number };
  motor_on: boolean;
  confirmed?: boolean;             // an admin agreed with the inferred cause
  camera: boolean;                 // did the camera cover this gap
}

export interface Alarm {
  id: string; t: number; m: number;
  severity: Severity;
  tag: string; label: string; detail: string;
  src: "plc" | "vfd" | "cv";
  cleared_t?: number;
}

export interface Minute {
  m: number;
  /** PLC — SIMULATED */
  s: number;                       // strokes from the hardware counter
  mode: "CONT" | "SINGLE" | "INCH" | "OFF";
  motor: 0 | 1;
  bits: string[];                  // alarm tags active in this minute
  st: string;                      // machine status as a person typed it
  /** VFD — SIMULATED */
  kw: number; amps: number; torque: number; hz: number;
  pf: number; dcbus: number; fault: number;
  /** CV — MEASURED where the camera covered, else null */
  present: 0 | 1 | null;
  working: 0 | 1 | null;
  cvs: number | null;              // strokes the camera counted
  sin: number | null; sout: number | null;
  part: string | null;
  stack: number | null;
  die: 0 | 1 | null;
  spm: number;
  trust: Trust;
}

export interface Block { st: string; m0: number; m1: number; min: number; strokes: number }

export interface Stroke {
  i: number; t: number;            // seconds of day
  period: number; spm: number;
  down_ms: number; up_ms: number; dwell_ms: number;
  amps: number; torque: number;
  part: string | null;
}

export interface Day {
  date: string;
  machine: string;
  real: boolean;
  note: string;
  shift: { label: string; m0: number; m1: number; breaks: [number, number][]; plan_min: number };
  job: { part: string; process: string; die: string; target: number; takt_sec: number };
  operator: { name: string; id: number; shift: string };
  camera: {
    start_min: number; end_min: number; video_url: string;
    fps: number; native: [number, number]; anchor: "confirmed" | "assumed"; anchor_note: string;
  };
  tariff_pkr_per_kwh: number;
  totals: Record<string, number>;
  oee: { availability: number; performance: number; quality: number | null; oee: number; quality_source: string };
  minutes: Minute[];
  blocks: Block[];
  gaps: Gap[];
  alarms: Alarm[];
  strokes: Stroke[];
}

/* ---------- per-frame CV file (short keys, 5 Hz) ---------- */

/** [tid, x1, y1, x2, y2, statusCode, simPct] in NATIVE px */
export type PersonTuple = [number, number, number, number, number, number, number];
/** [class, confPct, x1, y1, x2, y2] in NATIVE px */
export type DetTuple = [string, number, number, number, number, number];

export interface CvFrame {
  f: number;
  t: number;                       // seconds into the video
  vy: number;
  /** 0 = NO SIGNAL (the monitor's "----": the stroke ROI gave it nothing),
   *  1 = rise, 2 = still, 3 = down. 0 is not "idle" — the complete run has
   *  684 s of it across 407 dropouts, and painting that as a stopped press
   *  would invent 11 minutes of downtime. */
  ps: 0 | 1 | 2 | 3;
  op: 0 | 1;                       // press open (the load/unload window)
  c: number;                       // cumulative stroke count
  w: PersonTuple | null;           // the operator
  cf: 0 | 1;                       // confirmed (not provisional)
  d: DetTuple[];                   // part detections
  ev: "IN" | "OUT" | null;
  si: number; so: number;          // running IN / OUT counts
  dc: 0 | 1;                       // die change in progress
  /** the monitor's own die_change state: 0 unknown, 1 running, 2 idle, 3 die_change */
  dcs: 0 | 1 | 2 | 3;
  fk: 0 | 1;                       // forklift-sized motion
  pg: 0 | 1;                       // part gate satisfied
  sn: number;                      // how many STOCK-PILE detections this frame (see CvTimeline.stock)
  sk: [number, number, number, number, number] | null;   // steel-sheet stack box + confPct
}

/** A class the detector sees as a stationary tray of parts rather than
 *  production. On this run `part_collar` fires 429,989 times — eleven at once,
 *  in a patch that never moves. Counting detections as parts made would read
 *  ~5,000 parts/minute off a press doing five strokes a minute, so the pile is
 *  declared once here and its per-frame count rides in CvFrame.sn. */
export interface StockPile {
  class: string;
  envelope: [number, number, number, number];
  typical_n: number; max_n: number;
  frames_seen: number; frame_share: number; conf_median: number;
  first_s: number; last_s: number;
  why: string;
}

/** Stroke count is the monitor's own counter; phase timing is measured from the
 *  40 ms vy signal and matched to each counted stroke by nearest TDC. */
export interface StrokeStats {
  counted: number; timed: number; motions: number; setup_jogs: number;
  running_period_s: number | null;
  down_ms: number | null; up_ms: number | null; dwell_ms: number | null;
  note: string;
}

export interface CvTimeline {
  video: string;
  video_url: string;
  fps: number;
  native: [number, number];
  stroke_roi: number[];
  bolster_roi: number[];
  machine_roi: number[];
  classes: string[];
  /** the classes kept per frame; the rest are stock piles */
  job_classes: string[];
  stock: StockPile[];
  /** cadence of frames[] after decimation, vs the native signal rate in pulse.json */
  overlay_hz: number;
  signal_hz: number;
  /** false while the CV pass over the full recording is still running */
  complete: boolean;
  totals: Record<string, number>;
  stroke_stats: StrokeStats;
  /** slide motion during the die change that the stroke counter did not count */
  setup_jogs: { t: number; down_ms: number; up_ms: number; dwell_ms: number; why: string }[];
  die_changes: Record<string, unknown>[];
  frames: CvFrame[];
}

/** The raw vy trace on its own — small enough to load on every screen so the
 *  top-bar pulse shows the real signal rather than a synthetic wave. */
export interface Pulse {
  t0: number; hz: number; video_s: number;
  vy: number[];
  c: number[];
}

export interface PlanCell {
  date: string; shift: string;
  part: string; process: string; die: string;
  qty: number;
  required_spm: number;
  achieved_spm: number;
  /** measured | estimated | user — only part_form_left is measured */
  spm_trust?: string;
  planned_load_pct?: number;
  /** true when a local planner edit is layered over the generated baseline */
  edited?: boolean;
  feasible: boolean;
  shortfall_pct: number;
  overtime_min: number;
  realistic_qty: number;
  changeover_from: string | null;
  changeover_min: number;
  energy_kwh: number;
  energy_pkr: number;
  operator: string;
}

export interface Plan {
  note: string;
  week_of: string;
  cells: PlanCell[];
  parts: { part: string; process: string; die: string; achieved_spm: number;
           kwh_per_1000: number; spm_trust?: string }[];
}

export interface ReportRow {
  date: string; real: boolean;
  part: string; process: string; operator: string;
  target: number; produced: number; strokes: number; efficiency: number;
  plan_min: number; running_min: number; production_min: number;
  idle_min: number; downtime_min: number; unexplained_min: number;
  kwh: number; idle_kwh: number; pkr: number;
  oee: number;
  top_cause: string; top_cause_min: number;
}

export interface History {
  note: string;
  real_dates: string[];
  rows: ReportRow[];
  health: HealthRow[];
  /** stated, never hidden: the VFD-B has no temperature register */
  thermal_limit: string;
}

export interface HealthRow {
  key: string; label: string; unit: string;
  value: number; ewma: number;
  zone: "A" | "B" | "C" | "D";
  bands: { A: number; B: number; C: number };
  direction: "up-bad" | "down-bad";
  spark: number[];
  r2: number;
  /** only meaningful where r2 > 0.7 — the UI must not render it otherwise */
  weeks_to_boundary: number | null;
  note?: string;
  /** which channel this indicator is derived from — camera | vfd | plc.
   *  Up-stroke time and dwell exist only because the camera resolves 40 ms;
   *  torque and bus volts only because the drive is on Modbus. */
  source?: "camera" | "vfd" | "plc";
}

export const STATUS_LABEL = ["calibrating", "pending", "passerby", "operator"] as const;
export const PRESS_STATE = ["idle", "rising", "still", "descending"] as const;
