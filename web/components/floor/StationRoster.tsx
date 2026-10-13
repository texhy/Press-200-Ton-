"use client";
import Link from "next/link";
import { useMemo } from "react";
import type { Day } from "@/lib/types";
import type { FloorData } from "@/lib/floor";
import { allStatuses, bySeverity } from "@/lib/floorStatus";
import { STATUS_COLOR, STATUS_ICON } from "@/lib/palette";
import { StatusPill, TrustChip } from "@/components/ui";
import { useCursor } from "@/lib/cursor";

/** The table twin of the map — and the keyboard path, since 3D pick proxies
 *  are not focusable. House rule 6 applied to a spatial view. Worst first. */
export function StationRoster({ floor, day, t, selected, onSelect }: {
  floor: FloorData; day: Day | null; t: number;
  selected: string | null; onSelect: (id: string | null) => void;
}) {
  const { hovered, setHovered } = useCursor();
  const rows = useMemo(() => {
    const st = allStatuses(floor, day, t);
    return floor.stations
      .map((s) => ({ s, st: st.get(s.id)! }))
      .sort((a, b) => bySeverity(a.st, b.st));
  }, [floor, day, t]);

  return (
    <div className="flex flex-col">
      {rows.map(({ s, st }) => {
        const on = hovered === s.id || selected === s.id;
        return (
          <button key={s.id}
                  onPointerEnter={() => setHovered(s.id)}
                  onPointerLeave={() => setHovered(null)}
                  onFocus={() => setHovered(s.id)}
                  onBlur={() => setHovered(null)}
                  onClick={() => onSelect(selected === s.id ? null : s.id)}
                  className="flex items-center gap-2.5 px-2 py-1.5 text-left rounded-[var(--r-ctl)]
                             transition-colors w-full"
                  style={{ background: on ? "var(--raised)" : "transparent" }}>
            <span aria-hidden className="w-[9px] h-[9px] rounded-sm shrink-0"
                  style={{ background: st.severity ? STATUS_COLOR[st.severity] : "var(--grid)" }} />
            <span className="flex flex-col min-w-0 flex-1">
              <span className="text-[12px] truncate"
                    style={{ color: on ? "var(--ink)" : "var(--ink-2)", fontWeight: s.instrumented ? 650 : 450 }}>
                {s.label}
                <span className="text-[var(--muted)] font-[400]"> · {s.tonnage}T</span>
              </span>
              <span className="text-[10px] text-[var(--muted)] truncate">
                {st.severity ? STATUS_ICON[st.severity] : "—"} {st.state}
              </span>
            </span>
            {s.instrumented
              ? <TrustChip trust="measured" />
              : <TrustChip trust="simulated" />}
          </button>
        );
      })}
    </div>
  );
}

/** Detail panel for the selected station — the end of the click-through.
 *
 *  An uninstrumented station says so in words BEFORE any number and offers no
 *  drill-through: `routes.primary` is null in the data, so the UI *cannot* link
 *  it to a dashboard describing a different machine.
 *
 *  The instrumented one is the opposite — it carries what the camera actually
 *  measured over the run, because "a station is red, I click it, I'm in the
 *  evidence" only works if the evidence is here rather than a link away. Every
 *  figure below comes from floor.json's precomputed `measured` block, which
 *  43_build_floor.py derives from the complete CV run; the landing page never
 *  parses cv.json. */
export function StationCard({ floor, day, t, id, onClose }: {
  floor: FloorData; day: Day | null; t: number; id: string; onClose: () => void;
}) {
  const s = floor.stations.find((x) => x.id === id);
  const st = useMemo(() => (s ? allStatuses(floor, day, t).get(id) : undefined), [floor, day, t, id, s]);
  const ev = floor.events[id];
  const m = ev?.measured;

  // the absence the shift lead is standing in, or the next one coming
  const absence = useMemo(() => {
    if (!ev) return null;
    const now = ev.operator_absent_s.find(([a, b]) => t >= a && t < b);
    if (now) return { span: now, current: true };
    const next = ev.operator_absent_s.find(([a]) => a > t);
    return next ? { span: next, current: false } : null;
  }, [ev, t]);

  if (!s || !st) return null;

  const row = (k: string, v: React.ReactNode, title?: string) => (
    <div key={k} className="flex justify-between gap-2 min-w-0" title={title}>
      <dt className="text-[var(--muted)] m-0 shrink-0">{k}</dt>
      <dd className="m-0 truncate text-right tabular-nums">{v}</dd>
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="m-0 text-[15px] font-[650] truncate">{s.label}</h3>
          <p className="m-0 text-[11px] text-[var(--muted)]">
            {s.kind === "hydraulic_4col" ? "Hydraulic" : "Mechanical"} · {s.tonnage} ton
          </p>
        </div>
        <button onClick={onClose} aria-label="Close"
                className="text-[var(--muted)] hover:text-[var(--ink)] text-[14px] leading-none">×</button>
      </header>

      {!s.instrumented ? (
        <div className="flex flex-col gap-2 p-2.5 rounded-[var(--r-ctl)]"
             style={{ background: "color-mix(in oklab, var(--muted) 10%, transparent)",
                      border: "1px dashed var(--hair-strong)" }}>
          <TrustChip trust="simulated" what="This station" />
          <p className="m-0 text-[11px] text-[var(--ink-2)] leading-snug">
            <b>No instrumentation on this press.</b> There is no camera, no PLC tap and no
            drive link here, so the state shown is a declared simulation for layout
            purposes — not a measurement. No dashboard exists for it.
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <StatusPill severity={st.severity ?? "info"}>{st.state}</StatusPill>
          <TrustChip trust={st.trust === "none" ? "simulated" : st.trust} />
        </div>
      )}

      {s.instrumented && (
        <>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 m-0 text-[11px]">
            {row("State", st.state)}
            {row("Detail", st.detail ?? "—")}
            {row("Camera", st.covered ? "covering" : "no coverage now")}
            {row("Sources", s.sources.join(", ").toUpperCase() || "—")}
          </dl>

          {absence && (
            <div className="flex flex-col gap-1 p-2 rounded-[var(--r-ctl)]"
                 style={{ background: "color-mix(in oklab, var(--warning) 12%, transparent)",
                          border: "1px solid color-mix(in oklab, var(--warning) 40%, transparent)" }}>
              <span className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
                {absence.current ? "Nobody at the press right now" : "Next operator absence"}
              </span>
              <span className="text-[12px] tabular-nums">
                {hhmm(absence.span[0])} – {hhmm(absence.span[1])}
                <span className="text-[var(--muted)]">
                  {" "}· {Math.round((absence.span[1] - absence.span[0]) / 60)} min
                </span>
              </span>
            </div>
          )}

          {m && (
            <section className="flex flex-col gap-1.5">
              <h4 className="m-0 text-[10px] uppercase tracking-wide text-[var(--muted)]">
                Measured over the recording
              </h4>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 m-0 text-[11px]">
                {row("Strokes counted", m.strokes)}
                {row("Running rate", `${m.running_spm} spm`,
                     `median ${m.running_period_s}s between strokes`)}
                {row("Down / up", `${m.down_ms} / ${m.up_ms} ms`)}
                {row("Dwell", `${m.dwell_pct}% of cycle`,
                     "the slide is stationary for this share of every cycle — "
                     + "the press is not the constraint, the manual load is")}
                {row("Sheets in / out", `${m.sheet_in} / ${m.sheet_out}`)}
                {row("Operator present", `${Math.round(100 * m.present_s / m.covered_s)}%`,
                     `${Math.round(m.present_s / 60)} of ${Math.round(m.covered_s / 60)} min covered`)}
                {row("Signal lost", `${Math.round(m.no_signal_s)} s`,
                     "frames where the stroke ROI returned nothing — not counted as downtime")}
                {row("Uncounted jogs", m.setup_jogs,
                     "slide movements during the die change that the stroke counter did not count")}
              </dl>
              {m.stock.map((sp) => (
                <p key={sp.class} className="m-0 text-[10px] text-[var(--muted)] leading-snug">
                  <b>Stock in view:</b> {sp.typical_n}× {sp.class} — {sp.why}.
                </p>
              ))}
              <p className="m-0 text-[10px] text-[var(--muted)] leading-snug">
                {m.video.frames.toLocaleString()} frames at {m.video.signal_hz} Hz
                ({Math.round(m.video.seconds / 60)} min). {ev.provenance.operator_position}
              </p>
            </section>
          )}

          <div className="flex gap-1.5 flex-wrap">
            {([["Dashboard", s.routes.primary], ["Camera", s.routes.camera],
               ["Timeline", s.routes.timeline]] as [string, string | undefined | null][])
              .filter(([, href]) => !!href)
              .map(([label, href]) => (
                <Link key={label} href={href!}
                      className="h-[26px] px-2.5 grid place-items-center rounded-[var(--r-ctl)] text-[11px]
                                 border border-[var(--hair-strong)] text-[var(--s1)] hover:bg-[var(--raised)]">
                  {label} →
                </Link>
              ))}
          </div>
        </>
      )}
    </div>
  );
}

const hhmm = (sec: number) => {
  const h = Math.floor(sec / 3600), mi = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
};
