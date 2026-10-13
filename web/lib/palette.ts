import type { Cause, Severity } from "./types";

/** ===========================================================================
 *  COLOUR IS ASSIGNED BY JOB, AND THE ASSIGNMENT IS PERMANENT.
 *
 *  Two separate token families that must never be swapped:
 *
 *   - CATEGORICAL (--s1..--s8) = IDENTITY. A downtime cause is an entity, so a
 *     "Breakdown" bar is categorical slot 8. Filtering never repaints it.
 *   - STATUS (--good/--warning/--serious/--critical) = STATE. A critical alarm
 *     chip is status-critical. It always ships with an icon + label.
 *
 *  Both want red. They get different reds. This is the easiest way to wreck a
 *  colour system, so the two maps live side by side here as a reminder.
 *  =========================================================================== */

/** Entity-locked. Slot order is the CVD-safety mechanism — do not reorder. */
export const CAUSE_COLOR: Record<Cause, string> = {
  production:      "var(--s1)",
  idle_burn:       "var(--s2)",
  changeover:      "var(--s2)",
  material:        "var(--s3)",
  feed_jam:        "var(--s4)",
  lubrication:     "var(--s5)",
  air:             "var(--s5)",
  operator_absent: "var(--s6)",
  die_tryout:      "var(--s7)",
  breakdown:       "var(--s8)",
  overload:        "var(--s8)",
  drive_trip:      "var(--s8)",
  micro_stop:      "var(--dim)",
  break:           "var(--dim)",
  unexplained:     "var(--muted)",
};

export const CAUSE_LABEL: Record<Cause, string> = {
  production: "Production",
  changeover: "Changeover",
  feed_jam: "Feed jam",
  lubrication: "Lubrication",
  air: "Pneumatics",
  overload: "Tonnage overload",
  drive_trip: "Drive trip",
  micro_stop: "Micro-stop",
  idle_burn: "Idle burn",
  break: "Break",
  material: "Material delivery",
  operator_absent: "Operator absent",
  die_tryout: "Die try-out",
  breakdown: "Breakdown",
  unexplained: "Unexplained",
};

export const STATUS_COLOR: Record<Severity, string> = {
  ok: "var(--good)",
  info: "var(--s1)",
  warning: "var(--warning)",
  serious: "var(--serious)",
  critical: "var(--critical)",
};

/** Status never carries meaning alone — every one ships with this glyph. */
export const STATUS_ICON: Record<Severity, string> = {
  ok: "✓", info: "ⓘ", warning: "▲", serious: "◆", critical: "■",
};

/** ISO 10816 vibration zones genuinely ARE severity states, so the status
 *  palette is the correct encoding here — the one place a severity ramp beats
 *  a categorical one. */
export const ZONE_COLOR = {
  A: "var(--good)", B: "var(--warning)", C: "var(--serious)", D: "var(--critical)",
} as const;

export const SERIES = ["var(--s1)","var(--s2)","var(--s3)","var(--s4)",
                       "var(--s5)","var(--s6)","var(--s7)","var(--s8)"] as const;

/** Sequential ramp for magnitude (heatmaps). One hue, light->dark. */
export const SEQ = ["var(--q100)","var(--q200)","var(--q300)","var(--q400)",
                    "var(--q500)","var(--q600)","var(--q700)"] as const;

export const PLC_STATUS_COLOR: Record<string, string> = {
  Production: "var(--s1)",
  "Die Try-out": "var(--s7)",
  "Machine Pause": "var(--dim)",
  "Machine Breakdown": "var(--s8)",
  "Break/Recess": "var(--dim)",
  Lifter: "var(--s3)",
  Others: "var(--muted)",
};
