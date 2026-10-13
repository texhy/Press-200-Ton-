/** Number and duration formatting. Compact where it reads better; never lossy
 *  in a way that hides a real difference. */

export const n0 = (v: number) => Math.round(v).toLocaleString("en-US");
export const n1 = (v: number) => v.toFixed(1);
export const n2 = (v: number) => v.toFixed(2);

export const compact = (v: number) =>
  Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M`
  : Math.abs(v) >= 1e4 ? `${(v / 1e3).toFixed(1)}K`
  : n0(v);

/** 74 -> "1h 14m" · 9 -> "9 min" · 0.6 -> "38 s" */
export const mins = (m: number) => {
  if (m < 1) return `${Math.round(m * 60)} s`;
  if (m < 60) return `${Math.round(m)} min`;
  const h = Math.floor(m / 60), r = Math.round(m % 60);
  return r ? `${h}h ${r}m` : `${h}h`;
};

export const secs = (s: number) => {
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return `${m}m ${String(r).padStart(2, "0")}s`;
};

export const pkr = (v: number) =>
  v >= 1e5 ? `Rs ${(v / 1e5).toFixed(2)} L` : `Rs ${n0(v)}`;

export const pct = (v: number, d = 0) => `${v.toFixed(d)}%`;
export const signed = (v: number, d = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}`;

/** Part class from the detector -> a name a person uses. */
export const PART_LABEL: Record<string, string> = {
  part_draw: "Draw",
  part_bend: "Bend",
  part_form_left: "Form Left",
  part_form_right: "Form Right",
  part_collar: "Collar",
};
export const partLabel = (c: string | null) => (c ? PART_LABEL[c] ?? c : "—");
