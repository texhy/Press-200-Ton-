"use client";
import type { Day, Severity, Trust } from "./types";
import type { FloorData, Station } from "./floor";
import { inSpan } from "./floor";
import { CAUSE_LABEL } from "./palette";

/** One station's display state at a moment. Pure — no hooks, no three.js — so
 *  the 2D plan, the 3D scene and the roster table can never disagree. */
export interface StationStatus {
  id: string;
  /** null means NO COVERAGE — render grey and "—", never zero */
  severity: Severity | null;
  /** words, always; status colour must never carry meaning alone */
  state: string;
  detail: string | null;
  trust: Trust | "none";
  covered: boolean;
  /** drives the ram + flywheel */
  running: boolean;
  spm: number;
}

const SIM_STATE: Record<string, { sev: Severity; label: string; run: boolean }> = {
  running:    { sev: "ok",      label: "Running",    run: true },
  idle:       { sev: "warning", label: "Idle",       run: false },
  break:      { sev: "info",    label: "Break",      run: false },
  changeover: { sev: "warning", label: "Changeover", run: false },
  fault:      { sev: "critical", label: "Fault",     run: false },
};

/** The instrumented station. Everything here is measured or inferred from
 *  measurement — outside the camera window it is honestly "no coverage". */
function measured(s: Station, day: Day, floor: FloorData, t: number): StationStatus {
  const ev = floor.events[s.id];
  const covered = ev ? inSpan(t, ev.coverage_s) : false;
  if (!covered) {
    return { id: s.id, severity: null, state: "No camera coverage", detail: null,
             trust: "none", covered: false, running: false, spm: 0 };
  }
  const min = day.minutes[Math.floor(t / 60)];
  const gap = day.gaps.find((g) => t >= g.t0 && t < g.t1);
  const alarm = day.alarms.find((a) => t >= a.t && t < a.t + 120);

  if (ev && inSpan(t, ev.die_change_s)) {
    return { id: s.id, severity: "warning", state: "Die change", detail: "camera: bolster plate changed",
             trust: "measured", covered: true, running: false, spm: 0 };
  }
  if (alarm && (alarm.severity === "critical" || alarm.severity === "serious")) {
    return { id: s.id, severity: alarm.severity, state: alarm.label, detail: alarm.detail,
             trust: "measured", covered: true, running: false, spm: 0 };
  }
  if (gap) {
    const sev: Severity = gap.cause === "unexplained" ? "critical"
      : gap.cause === "break" ? "info" : "warning";
    return { id: s.id, severity: sev, state: CAUSE_LABEL[gap.cause], detail: gap.label,
             trust: gap.camera ? "measured" : "inferred", covered: true, running: false, spm: 0 };
  }
  const spm = min?.spm ?? 0;
  return {
    id: s.id,
    severity: spm > 0 ? "ok" : "warning",
    state: spm > 0 ? "Running" : "Idle — motor on",
    detail: spm > 0 ? `${spm.toFixed(0)} spm` : null,
    trust: "measured", covered: true, running: spm > 0, spm,
  };
}

/** The other eleven. Declared interval table — reviewable and reproducible,
 *  unlike a seeded PRNG, and labelled simulated everywhere it surfaces. */
function simulated(s: Station, t: number): StationStatus {
  const m = Math.floor(t / 60);
  const span = s.sim?.pattern.find((p) => m >= p.m0 && m < p.m1);
  if (!span) {
    return { id: s.id, severity: null, state: "Outside shift", detail: null,
             trust: "simulated", covered: false, running: false, spm: 0 };
  }
  const base = SIM_STATE[span.state] ?? SIM_STATE.idle;
  return {
    id: s.id,
    severity: span.severity ?? base.sev,
    state: span.label ?? base.label,
    detail: span.label ? base.label : null,
    trust: "simulated",
    covered: true,
    running: base.run,
    spm: base.run ? (s.sim?.spm ?? 0) : 0,
  };
}

export function stationStatus(s: Station, day: Day | null, floor: FloorData, t: number): StationStatus {
  if (s.instrumented && day) return measured(s, day, floor, t);
  return simulated(s, t);
}

export function allStatuses(floor: FloorData, day: Day | null, t: number): Map<string, StationStatus> {
  return new Map(floor.stations.map((s) => [s.id, stationStatus(s, day, floor, t)]));
}

/** Worst-first, for the roster and the "needs attention" strip. */
const RANK: Record<string, number> = { critical: 0, serious: 1, warning: 2, info: 3, ok: 4 };
export const bySeverity = (a: StationStatus, b: StationStatus) =>
  (RANK[a.severity ?? "zz"] ?? 9) - (RANK[b.severity ?? "zz"] ?? 9);
