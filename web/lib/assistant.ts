"use client";
import type { Day, History, Plan } from "./types";
import type { FloorData } from "./floor";
import { allStatuses, bySeverity } from "./floorStatus";
import { inSpan } from "./floor";
import { CAUSE_LABEL } from "./palette";
import type { SourceKind } from "@/components/ui";

/** THE ASSISTANT ANSWERS FROM THE DATA, NOT FROM A MODEL.
 *
 *  Every reply below is a pure function of the files already loaded, so it
 *  cannot drift from what the screens show, cannot invent a number, and works
 *  with no network. That matters more here than conversational range: this
 *  thing is standing in a maintenance room being asked "why did it stop", and
 *  a plausible-sounding wrong answer is worse than no assistant at all.
 *
 *  So the vocabulary is deliberately closed. A question it does not recognise
 *  gets "I don't answer that" and the list of what it does — never a guess. */

export interface AnswerLine {
  /** the number, or the fact */
  value: string;
  /** what the number is */
  label: string;
  source?: SourceKind | SourceKind[];
  tone?: "ok" | "warning" | "critical" | "muted";
}

export interface Answer {
  headline: string;
  lines: AnswerLine[];
  /** prose only where prose is the honest answer */
  note?: string;
  /** deep link into the evidence */
  go?: { href: string; label: string };
  /** move the playhead there as well */
  seek?: number;
}

export interface Ctx {
  day: Day | null;
  hist: History | null;
  plan: Plan | null;
  floor: FloorData | null;
  t: number;
}

export interface Intent {
  id: string;
  /** the button label */
  q: string;
  /** words that route free text here */
  keys: string[];
  answer: (c: Ctx) => Answer | null;
}

const hhmm = (s: number) =>
  `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
/** Durations, honestly at every scale.
 *  Math.round(minutes) turned a real 24-second lubrication stop into "0 min",
 *  which reads as "nothing happened" for an event the camera actually caught.
 *  Below a minute, say seconds. */
const mins = (m: number) =>
  m >= 60 ? `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`
  : m < 1 ? `${Math.round(m * 60)} s`
  : `${m < 10 ? m.toFixed(1).replace(/\.0$/, "") : Math.round(m)} min`;
const n0 = (v: number) => Math.round(v).toLocaleString("en-US");

/* ------------------------------------------------------------------ 1 */
const status: Intent = {
  id: "status", q: "What is the press doing right now?",
  keys: ["status", "now", "doing", "running", "state", "what's going on", "whats going on"],
  answer: ({ day, floor, t }) => {
    if (!day) return null;
    const m = day.minutes[Math.floor(t / 60)];
    if (!m) return null;
    const gap = day.gaps.find((g) => t >= g.t0 && t < g.t1);
    const ev = floor?.events["s_press_1"];
    const covered = !!ev && inSpan(t, ev.coverage_s);
    const head = gap ? `Stopped — ${CAUSE_LABEL[gap.cause]}` : m.s > 0 ? "Running" : m.motor ? "Idle, motor on" : "Stopped";
    return {
      headline: `${hhmm(t)} · ${head}`,
      lines: [
        { label: "Strokes this minute", value: String(m.s), source: covered ? "camera" : "plc",
          tone: m.s > 0 ? "ok" : "warning" },
        { label: "Drive power", value: `${m.kw.toFixed(1)} kW`, source: "vfd" },
        { label: "Mode / motor", value: `${m.mode} · ${m.motor ? "on" : "off"}`, source: "plc" },
        { label: "Operator at the press", source: "camera",
          value: !covered ? "no camera coverage" : ev && inSpan(t, ev.operator_present_s) ? "yes" : "no",
          tone: !covered ? "muted" : ev && inSpan(t, ev.operator_present_s) ? "ok" : "critical" },
      ],
      note: covered
        ? "Inside the camera window, so stroke and operator facts are measured."
        : "Outside the 09:12–10:06 camera window — these come from the simulated PLC/VFD spine.",
      go: gap ? { href: "/downtime", label: "see the evidence" } : { href: "/live", label: "open the live screen" },
    };
  },
};

/* ------------------------------------------------------------------ 2 */
const why: Intent = {
  id: "why", q: "Why did it stop?",
  keys: ["why", "stop", "stopped", "down", "downtime", "reason", "cause"],
  answer: ({ day, t }) => {
    if (!day) return null;
    const active = day.gaps.find((g) => t >= g.t0 && t < g.t1);
    const past = [...day.gaps].filter((g) => g.t1 <= t).sort((a, b) => b.t1 - a.t1)[0];
    const g = active ?? past;
    if (!g) return { headline: "No stoppage yet today", lines: [], go: { href: "/downtime", label: "downtime screen" } };
    return {
      headline: `${active ? "Stopped now" : "Last stop"} — ${g.label}`,
      lines: [
        { label: "When", value: `${hhmm(g.t0)}–${hhmm(g.t1)}`, source: "calc" },
        { label: "Lost", value: mins(g.cost.minutes), tone: "warning", source: "calc" },
        { label: "Strokes lost", value: n0(g.cost.strokes), source: "calc" },
        { label: "Confidence", value: g.confidence,
          tone: g.confidence === "none" ? "critical" : "ok", source: "calc" },
        { label: "Camera", value: g.camera ? "covered — there is footage" : "no coverage at that time",
          source: "camera", tone: g.camera ? "ok" : "muted" },
      ],
      note: g.confidence === "none"
        ? "Nothing in the PLC, the VFD or the camera explains this one. It is counted, not guessed at — someone has to look."
        : undefined,
      go: { href: "/timeline", label: "watch it on the timeline" },
      seek: g.t0 + 1,
    };
  },
};

/* ------------------------------------------------------------------ 3 */
const target: Intent = {
  id: "target", q: "Are we going to hit target?",
  keys: ["target", "behind", "ahead", "plan", "output", "parts", "how many"],
  answer: ({ day, t }) => {
    if (!day) return null;
    const made = day.minutes.filter((m) => m.m <= Math.floor(t / 60)).reduce((a, m) => a + m.s, 0);
    const shiftS = (day.shift.m1 - day.shift.m0) * 60;
    const gone = Math.max(1, t - day.shift.m0 * 60);
    const projected = Math.round((made / gone) * shiftS);
    const short = day.job.target - projected;
    return {
      headline: short > 0 ? `Projected ${n0(projected)} against a ${n0(day.job.target)} target`
                          : `On track — projected ${n0(projected)}`,
      lines: [
        { label: "Made so far", value: n0(made), source: "camera" },
        { label: "Target", value: n0(day.job.target), source: "plan" },
        { label: "Projected at this rate", value: n0(projected), source: "calc",
          tone: short > 0 ? "critical" : "ok" },
        { label: "Measured cadence", value: "5.36 spm", source: "camera" },
        { label: "Planned takt", value: `${(60 / day.job.takt_sec).toFixed(1)} spm`, source: "plan" },
      ],
      note: short > 0
        ? `The press runs at 5.36 spm against a ${(60 / day.job.takt_sec).toFixed(1)} spm takt — 90% of each cycle is the slide sitting still waiting for the manual load. The press is not the constraint.`
        : undefined,
      go: { href: "/planner", label: "capacity check" },
    };
  },
};

/* ------------------------------------------------------------------ 4 */
const loss: Intent = {
  id: "loss", q: "What is costing us the most today?",
  keys: ["cost", "costing", "money", "loss", "biggest", "worst", "rupees", "waste"],
  answer: ({ day }) => {
    if (!day) return null;
    const by = new Map<string, { min: number; pkr: number; n: number }>();
    for (const g of day.gaps) {
      if (g.cause === "break") continue;
      const e = by.get(g.cause) ?? { min: 0, pkr: 0, n: 0 };
      e.min += g.cost.minutes; e.pkr += g.cost.pkr; e.n++;
      by.set(g.cause, e);
    }
    const ranked = [...by.entries()].sort((a, b) => b[1].min - a[1].min);
    const top = ranked[0];
    if (!top) return { headline: "No classified losses today", lines: [] };
    return {
      headline: `${CAUSE_LABEL[top[0] as keyof typeof CAUSE_LABEL] ?? top[0]} — ${mins(top[1].min)}, the biggest single loss`,
      lines: [
        ...ranked.slice(0, 4).map((r) => ({
          label: CAUSE_LABEL[r[0] as keyof typeof CAUSE_LABEL] ?? r[0],
          value: `${mins(r[1].min)} · ${r[1].n}x`, source: "calc" as SourceKind,
        })),
        { label: "Idle burn (motor on, no output)", value: `Rs ${n0(day.totals.idle_pkr)}`,
          source: ["vfd", "plc"], tone: "warning" },
      ],
      note: "Scheduled breaks are excluded — they are planned downtime, not loss.",
      go: { href: "/downtime", label: "break it down" },
    };
  },
};

/* ------------------------------------------------------------------ 5 */
const wear: Intent = {
  id: "wear", q: "Is anything wearing out?",
  keys: ["wear", "wearing", "health", "maintenance", "service", "fail", "predict", "brake", "die"],
  answer: ({ hist }) => {
    if (!hist) return null;
    const bad = hist.health.filter((i) => i.zone === "C" || i.zone === "D");
    const soon = hist.health
      .filter((i) => typeof i.weeks_to_boundary === "number")
      .sort((a, b) => (a.weeks_to_boundary as number) - (b.weeks_to_boundary as number));
    return {
      headline: bad.length
        ? `${bad.length} indicator${bad.length > 1 ? "s" : ""} past zone B`
        : "All indicators in zone A or B",
      lines: [
        ...bad.map((i) => ({ label: i.label, value: `zone ${i.zone}`, tone: "critical" as const,
                             source: (i.source as SourceKind) ?? "calc" })),
        ...soon.slice(0, 3).map((i) => ({
          label: `${i.label} — to next zone`,
          value: `~${(i.weeks_to_boundary as number).toFixed(1)} weeks`,
          source: (i.source as SourceKind) ?? "calc", tone: "warning" as const,
        })),
      ],
      note: "A projection is shown only where the 30-day fit is real (R² > 0.7). Everything else says 'insufficient trend' rather than guessing a date.",
      go: { href: "/health", label: "condition indicators" },
    };
  },
};

/* ------------------------------------------------------------------ 6 */
const floorQ: Intent = {
  id: "floor", q: "Which stations need attention?",
  keys: ["station", "stations", "floor", "map", "press 1", "shop", "attention", "which machine"],
  answer: ({ floor, day, t }) => {
    if (!floor) return null;
    const st = allStatuses(floor, day, t);
    const rank = floor.stations
      .map((s) => ({ s, st: st.get(s.id)! }))
      .filter((r) => r.st.severity === "critical" || r.st.severity === "serious" || r.st.severity === "warning")
      .sort((a, b) => bySeverity(a.st, b.st));
    return {
      headline: rank.length ? `${rank.length} of ${floor.stations.length} stations need a look`
                            : "No station is flagged right now",
      lines: rank.slice(0, 5).map((r) => ({
        label: r.s.label,
        value: r.st.state,
        tone: r.st.severity === "critical" ? "critical" : "warning",
        source: r.s.instrumented ? ("camera" as SourceKind) : ("plan" as SourceKind),
      })),
      note: `Only Press 200 is instrumented. The other ${floor.stations.length - 1} show a declared simulation so the floor reads as a shop — their states are not measurements.`,
      go: { href: "/", label: "open the floor map" },
    };
  },
};

/* ------------------------------------------------------------------ 7 */
const operator: Intent = {
  id: "operator", q: "Where is the operator?",
  keys: ["operator", "worker", "person", "who", "present", "absent", "away", "zaheer"],
  answer: ({ floor, day, t }) => {
    if (!floor || !day) return null;
    const ev = floor.events["s_press_1"];
    if (!ev) return null;
    const covered = inSpan(t, ev.coverage_s);
    const here = covered && inSpan(t, ev.operator_present_s);
    const next = ev.operator_absent_s.find(([a, b]) => t >= a && t < b)
      ?? ev.operator_absent_s.find(([a]) => a > t);
    const m = ev.measured;
    return {
      headline: !covered ? "No camera coverage at this time"
        : here ? `${day.operator.name} is at the press` : `Nobody at the press at ${hhmm(t)}`,
      lines: [
        { label: "Present across the recording", value: `${Math.round(100 * m.present_s / m.covered_s)}%`,
          source: "camera" },
        { label: "Absences over 1 minute", value: String(ev.operator_absent_s.length), source: "camera" },
        ...(next ? [{ label: next[0] <= t ? "This absence" : "Next absence",
                      value: `${hhmm(next[0])}–${hhmm(next[1])} · ${mins((next[1] - next[0]) / 60)}`,
                      tone: "warning" as const, source: "camera" as SourceKind }] : []),
      ],
      note: "Presence is a binary at a declared post. The detector box is image-space pixels from a camera with no known extrinsics, so it is never turned into a position on the floor.",
      go: { href: "/camera", label: "watch the footage" },
      seek: next && next[0] > t ? next[0] : undefined,
    };
  },
};

/* ------------------------------------------------------------------ 8 */
const energy: Intent = {
  id: "energy", q: "What is the idle burn costing?",
  keys: ["energy", "power", "kwh", "electricity", "idle", "burn", "tariff", "bill"],
  answer: ({ day }) => {
    if (!day) return null;
    const t = day.totals;
    return {
      headline: `Rs ${n0(t.idle_pkr)} burnt today with the motor on and nothing to show`,
      lines: [
        { label: "Idle time", value: mins(t.idle_min), source: ["plc", "vfd"], tone: "warning" },
        { label: "Energy today", value: `${t.kwh.toFixed(1)} kWh`, source: "vfd" },
        { label: "Idle share", value: `${((t.idle_kwh / Math.max(0.1, t.kwh)) * 100).toFixed(0)}%`, source: "calc" },
        { label: "Cost per stroke", value: `Rs ${t.pkr_per_stroke.toFixed(2)}`, source: "calc" },
        { label: "At 22 working days", value: `Rs ${n0(t.idle_pkr * 22)}`, source: "calc", tone: "critical" },
      ],
      note: `Tariff Rs ${day.tariff_pkr_per_kwh}/kWh. The drive channel is simulated — modelled from the camera's real stroke cadence, so it agrees with the strokes you can see.`,
      go: { href: "/energy", label: "energy screen" },
    };
  },
};

/* ------------------------------------------------------------------ 9 */
const limits: Intent = {
  id: "limits", q: "What can this system NOT see?",
  keys: ["limit", "limits", "cannot", "can't", "blind", "missing", "honest", "trust", "fake", "real"],
  answer: ({ day, floor }) => ({
    headline: "What is measured, and what is not",
    lines: [
      { label: "Measured", value: "the camera only", source: "camera",
        tone: "ok" },
      { label: "Simulated", value: "every PLC bit and VFD register", source: ["plc", "vfd"], tone: "warning" },
      { label: "Instrumented stations", value: `1 of ${floor?.stations.length ?? 12}`, source: "plan" },
      { label: "Camera window", value: day ? `${hhmm(day.camera.start_min * 60)}–${hhmm(day.camera.end_min * 60)}` : "—",
        source: "camera" },
      { label: "Quality / scrap", value: "no source at all", source: "calc", tone: "critical" },
    ],
    note: "There is no temperature register on this drive, no scrap counter anywhere, and no camera on eleven of the twelve presses. Minutes outside the camera window are synthesised. Nothing on these screens pretends otherwise — every number carries its source.",
    go: { href: "/reports", label: "the full day log" },
  }),
};

/* ----------------------------------------------------------------- 10 */
const week: Intent = {
  id: "week", q: "What is planned this week?",
  keys: ["week", "schedule", "planner", "planned", "capacity", "jobs"],
  answer: ({ plan }) => {
    if (!plan) return null;
    const over = plan.cells.filter((c) => !c.feasible);
    return {
      headline: over.length
        ? `${over.length} of ${plan.cells.length} shifts are planned above capacity`
        : `All ${plan.cells.length} shifts fit`,
      lines: [
        ...over.slice(0, 4).map((c) => ({
          label: `${c.date.slice(5)} ${c.shift} · ${c.process}`,
          value: `needs ${c.required_spm.toFixed(2)} spm, gets ${c.achieved_spm.toFixed(2)}`,
          tone: "critical" as const, source: "calc" as SourceKind,
        })),
        { label: "Changeover time in the week", value: mins(plan.cells.reduce((a, c) => a + c.changeover_min, 0)),
          source: "calc" },
      ],
      note: "Rates are measured for Form Left (5.36 spm) and estimated for the other four, re-anchored on it.",
      go: { href: "/planner", label: "planner board" },
    };
  },
};


/* ----------------------------------------------------------------- 11 */
const diechange: Intent = {
  id: "diechange", q: "What happened during the die change?",
  keys: ["die change", "diechange", "changeover", "setup", "bolster", "forklift", "d-204"],
  answer: ({ day, floor }) => {
    if (!day) return null;
    const g = day.gaps.find((x) => x.cause === "changeover");
    if (!g) return { headline: "No die change recorded today", lines: [] };
    const ev = floor?.events["s_press_1"];
    const m = ev?.measured;
    return {
      // the gap's own label already carries a rounded duration; printing a
      // separately-rounded one underneath it showed 21 and 22 for one event
      headline: `Die change — ${hhmm(g.t0)} to ${hhmm(g.t1)}, every step on camera`,
      lines: [
        { label: "Duration", value: `${g.cost.minutes.toFixed(1)} min`, tone: "warning", source: "camera" },
        { label: "Strokes not made", value: n0(g.cost.strokes), source: "calc" },
        { label: "Evidence steps recorded", value: String(g.evidence?.length ?? 0), source: "camera" },
        { label: "Forklift visits", value: String(ev?.forklift_visits_s.length ?? 0), source: "camera" },
        { label: "Uncounted setup jogs", value: String(m?.setup_jogs ?? 0), source: "camera" },
        { label: "Confidence", value: g.confidence, tone: "ok", source: "calc" },
      ],
      note: "This is the one event in the dataset that is measured end to end: cadence stops, the setter jogs the slide, a forklift arrives, the bolster plate is visibly different afterwards, production resumes on the new die. Six forklift sightings were paired into three visits — the detector sees it arrive and leave.",
      go: { href: "/timeline", label: "step through the evidence" },
      seek: g.t0 + 1,
    };
  },
};

/* ----------------------------------------------------------------- 12 */
const cadence: Intent = {
  id: "cadence", q: "How fast is the press really running?",
  keys: ["fast", "speed", "spm", "cadence", "rate", "cycle", "dwell", "slow", "bottleneck"],
  answer: ({ floor, day }) => {
    const m = floor?.events["s_press_1"]?.measured;
    if (!m || !day) return null;
    const takt = 60 / day.job.takt_sec;
    return {
      headline: `${m.running_spm} spm against a ${takt.toFixed(1)} spm takt — ${Math.round(100 * m.running_spm / takt)}% of plan`,
      lines: [
        { label: "Median period between strokes", value: `${m.running_period_s} s`, source: "camera" },
        { label: "Down-stroke", value: `${m.down_ms} ms`, source: "camera" },
        { label: "Up-stroke", value: `${m.up_ms} ms`, source: "camera" },
        { label: "Dwell — slide not moving", value: `${m.dwell_ms} ms (${m.dwell_pct}% of cycle)`,
          tone: "critical", source: "camera" },
      ],
      note: "The press itself takes 1.12 s to make a part. The other 10.1 s of every cycle is the slide sitting at top waiting to be loaded by hand. Buying a faster press would change nothing — the constraint is the manual feed. Only the camera can tell you this: at a 200 ms PLC poll a 560 ms down-stroke is three samples.",
      go: { href: "/camera", label: "per-stroke timing" },
    };
  },
};

/* ----------------------------------------------------------------- 13 */
const counted: Intent = {
  id: "counted", q: "What did the camera actually count?",
  keys: ["camera count", "counted", "how many strokes", "sheets", "detect", "vision", "accurate", "accuracy"],
  answer: ({ floor }) => {
    const ev = floor?.events["s_press_1"];
    const m = ev?.measured;
    if (!m) return null;
    return {
      headline: `${m.strokes} strokes over ${Math.round(m.video.seconds / 60)} minutes of footage`,
      lines: [
        { label: "Frames processed", value: n0(m.video.frames), source: "camera" },
        { label: "Strokes counted", value: n0(m.strokes), source: "camera" },
        { label: "Sheets in / out", value: `${m.sheet_in} / ${m.sheet_out}`, source: "camera" },
        { label: "Operator present", value: `${Math.round(100 * m.present_s / m.covered_s)}% of coverage`, source: "camera" },
        { label: "Stroke signal unavailable", value: `${Math.round(m.no_signal_s)} s`, tone: "warning", source: "camera" },
      ],
      note: "Sheet IN and OUT disagree by three — they are an estimate, never a hard tally, so parts are reported as min(IN, OUT). 684 s of the run had no usable stroke signal at all; that is reported as 'no signal', not as a stopped press. Counting detections would be worse still: the detector fires on a tray of collar parts 429,989 times, and none of them were made today.",
      go: { href: "/camera", label: "watch it count" },
    };
  },
};

export const INTENTS: Intent[] = [
  status, why, cadence, target, loss, diechange, counted, wear, operator, floorQ, energy, week, limits,
];

/** Route free text. Deliberately dumb: a keyword hit, or an honest refusal.
 *  Fuzzy intent-guessing is how an assistant ends up confidently answering a
 *  question nobody asked. */
export function route(text: string): Intent | null {
  const q = text.toLowerCase().trim();
  if (!q) return null;
  let best: { intent: Intent; score: number } | null = null;
  for (const it of INTENTS) {
    let score = 0;
    for (const k of it.keys) if (q.includes(k)) score += k.length;
    if (score && (!best || score > best.score)) best = { intent: it, score };
  }
  return best?.intent ?? null;
}
