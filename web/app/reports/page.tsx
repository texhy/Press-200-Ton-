"use client";
import { useMemo, useState } from "react";
import { Shell } from "@/components/shell/Shell";
import { Card, StatTile, StatusPill, TableView, TrustChip, Reveal } from "@/components/ui";
import { Heatmap, Empty } from "@/components/charts";
import { loadDay, loadHistory, useAsync } from "@/lib/data";
import { useCursor, hhmmss, mLabel } from "@/lib/cursor";
import { CAUSE_COLOR, CAUSE_LABEL } from "@/lib/palette";
import { mins, n0, n1, pkr, partLabel, pct } from "@/lib/format";
import type { Cause } from "@/lib/types";

function csv(rows: (string | number)[][]) {
  return rows.map((r) => r.map((c) => {
    const s = String(c);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\n");
}

export default function ReportsPage() {
  const { data: day } = useAsync(loadDay);
  const { data: hist } = useAsync(loadHistory);
  const { setT, openInspector } = useCursor();
  const [q, setQ] = useState("");
  const [onlyEvents, setOnlyEvents] = useState(false);

  /* hour x 10-min grid of strokes — magnitude on a grid is a heatmap,
     sequential, ONE hue. Null cells render as "no coverage", not zero. */
  const heat = useMemo(() => {
    if (!day) return null;
    const h0 = Math.floor(day.shift.m0 / 60), h1 = Math.ceil(day.shift.m1 / 60);
    const rows = Array.from({ length: h1 - h0 }, (_, i) => `${String(h0 + i).padStart(2, "0")}:00`);
    const cols = Array.from({ length: 6 }, (_, i) => `:${String(i * 10).padStart(2, "0")}`);
    const vals = rows.map((_, ri) => cols.map((_, ci) => {
      const m0 = (h0 + ri) * 60 + ci * 10;
      const slice = day.minutes.filter((m) => m.m >= m0 && m.m < m0 + 10);
      if (!slice.length) return null;
      return slice.reduce((a, m) => a + m.s, 0);
    }));
    return { rows, cols, vals };
  }, [day]);

  const log = useMemo(() => {
    if (!day) return [];
    const ql = q.trim().toLowerCase();
    return day.minutes
      .filter((m) => m.m >= day.shift.m0 && m.m < day.shift.m1)
      .filter((m) => !onlyEvents || m.bits.length > 0 || m.fault > 0 || m.s === 0)
      .filter((m) => !ql || [mLabel(m.m), m.st, m.mode, m.part ?? "", ...m.bits]
        .join(" ").toLowerCase().includes(ql));
  }, [day, q, onlyEvents]);

  const download = (name: string, text: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    a.download = name; a.click(); URL.revokeObjectURL(a.href);
  };

  if (!day) return <Shell day={null}><Card title="Loading…" /></Shell>;

  return (
    <Shell day={day} wide>
      <Card edge="warning" className="mb-3">
        <p className="m-0 text-[11px] text-[var(--ink-2)] leading-relaxed">{day.note}</p>
        <p className="m-0 mt-1.5 text-[11px] text-[var(--muted)]">{hist?.note}</p>
      </Card>

      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
        <Card><StatTile source="camera" sourceNote="the monitor\u2019s own stroke counter inside the camera window; PLC spine outside it" label="Strokes" value={n0(day.totals.strokes)} /></Card>
        <Card><StatTile source="camera" sourceNote="min(IN, OUT) per press window \u2014 a cross-check, never the count" label="Parts (camera est.)" value={n0(day.totals.parts_est)}
                        sub={`min(IN,OUT) over ${day.camera.end_min - day.camera.start_min} covered min`} /></Card>
        <Card><StatTile source="calc" sourceNote="A from PLC run minutes, P from camera strokes vs takt, Q has no source" label="OEE" value={pct(day.oee.oee, 1)} sub="A × P only" /></Card>
        <Card><StatTile source="calc" label="Downtime" value={mins(day.totals.downtime_min)} /></Card>
        <Card><StatTile source="vfd" label="Energy" value={n1(day.totals.kwh)} unit="kWh" /></Card>
        <Card><StatTile source="calc" sourceNote="drive energy x tariff" label="Cost" value={pkr(day.totals.pkr)} /></Card>
      </div>

      <Card title="Hour by hour" className="mt-3"
            sub="Strokes per 10 minutes · dashed cells are outside the shift, not zero">
        {heat ? <Heatmap rows={heat.rows} cols={heat.cols} values={heat.vals} fmt={(v) => `${v}`} />
              : <Empty msg="no data" />}
      </Card>

      {/* ---------------- the audit trail ---------------- */}
      <Card title="Day log — every minute" className="mt-3" pad={false}
            sub="When someone disputes a number, you show them the signal"
            right={
              <span className="flex items-center gap-2">
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search…"
                       className="h-[24px] px-2 w-[140px] rounded-[var(--r-ctl)] text-[11px] bg-[var(--plane)]
                                  border border-[var(--hair-strong)] outline-none" />
                <label className="flex items-center gap-1 text-[10px] cursor-pointer">
                  <input type="checkbox" checked={onlyEvents} onChange={(e) => setOnlyEvents(e.target.checked)}
                         className="accent-[var(--s1)]" />
                  events only
                </label>
                <button onClick={() => download(`press200_${day.date}_minutes.csv`, csv([
                  ["minute", "clock", "status", "mode", "motor", "strokes", "kw", "amps", "torque", "hz", "pf", "dcbus", "fault", "bits", "present", "part", "trust"],
                  ...log.map((m) => [m.m, mLabel(m.m), m.st, m.mode, m.motor, m.s, m.kw, m.amps, m.torque, m.hz, m.pf, m.dcbus, m.fault, m.bits.join("|"), m.present ?? "", m.part ?? "", m.trust]),
                ]))} className="h-[24px] px-2 rounded-[var(--r-ctl)] text-[10px] border border-[var(--hair-strong)] hover:bg-[var(--raised)]">
                  ↓ CSV
                </button>
              </span>
            }>
        <div className="px-4 pb-4 max-h-[420px] overflow-y-auto">
          <TableView
            cols={["Clock", "Status", "Mode", "Motor", "Strokes", "kW", "A", "Torque", "Bits", "Operator", "Part", "Source"]}
            rows={log.map((m) => [
              <span key="t" className="readout">{mLabel(m.m)}</span>,
              m.st, m.mode,
              m.motor ? "run" : <span key="x" className="text-[var(--muted)]">stop</span>,
              m.s || <span key="z" className="text-[var(--muted)]">0</span>,
              m.kw ? m.kw.toFixed(1) : "—", m.amps ? m.amps.toFixed(1) : "—",
              m.torque ? `${m.torque.toFixed(0)}%` : "—",
              m.bits.length
                ? <span key="b" style={{ color: "var(--serious)" }}>{m.bits.join(", ")}</span>
                : <span key="b" className="text-[var(--muted)]">—</span>,
              m.present === null
                ? <span key="p" className="text-[var(--muted)]">no coverage</span>
                : `${m.present}%`,
              partLabel(m.part),
              <TrustChip key="tr" trust={m.trust} />,
            ])}
            caption={`${log.length} minutes shown. Every value carries its source.`}
          />
        </div>
      </Card>

      <div className="grid gap-3 mt-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))" }}>
        <Card title="Stoppage log" sub="Classified, with the evidence behind each one">
          <TableView
            cols={["Start", "Dur", "Cause", "Conf.", ""]}
            rows={day.gaps.map((g) => [
              <span key="t" className="readout">{hhmmss(g.t0).slice(0, 5)}</span>,
              mins(g.cost.minutes),
              <span key="c" className="flex items-center gap-1.5">
                <i className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: CAUSE_COLOR[g.cause] }} />
                {CAUSE_LABEL[g.cause]}
              </span>,
              g.confidence,
              <button key="b" onClick={() => { setT(g.t0 + 1); openInspector(g.id); }}
                      className="text-[10px] text-[var(--s1)]">why ▸</button>,
            ])}
          />
        </Card>

        <Card title="Alarm log" sub="Every bit transition, in order">
          {day.alarms.length ? (
            <TableView
              cols={["Clock", "Severity", "Tag", "Detail", "Source"]}
              rows={day.alarms.map((a) => [
                <span key="t" className="readout">{hhmmss(a.t).slice(0, 5)}</span>,
                <StatusPill key="s" severity={a.severity}>{a.severity}</StatusPill>,
                a.tag, a.detail, a.src.toUpperCase(),
              ])}
            />
          ) : <p className="m-0 text-[11px] text-[var(--muted)]">No alarms today.</p>}
        </Card>
      </div>

      <Card title="30-day history" className="mt-3"
            right={
              <button onClick={() => hist && download("press200_history.csv", csv([
                ["date", "part", "operator", "target", "produced", "strokes", "oee", "downtime_min", "unexplained_min", "kwh", "pkr", "top_cause"],
                ...hist.rows.map((r) => [r.date, r.part, r.operator, r.target, r.produced, r.strokes, r.oee, r.downtime_min, r.unexplained_min, r.kwh, r.pkr, r.top_cause]),
              ]))} className="h-[24px] px-2 rounded-[var(--r-ctl)] text-[10px] border border-[var(--hair-strong)] hover:bg-[var(--raised)]">
                ↓ CSV
              </button>
            }>
        {hist ? (
          <TableView
            cols={["Date", "Part", "Operator", "Target", "Made", "Strokes", "OEE", "Downtime", "Unexpl.", "kWh", "Cost", "Top cause", "Source"]}
            rows={[...hist.rows].reverse().map((r) => [
              r.date, partLabel(r.part), r.operator, n0(r.target), n0(r.produced), n0(r.strokes),
              `${r.oee}%`, mins(r.downtime_min),
              r.unexplained_min ? <span key="u" style={{ color: "var(--critical)" }}>{mins(r.unexplained_min)}</span> : "—",
              n1(r.kwh), pkr(r.pkr),
              CAUSE_LABEL[r.top_cause as Cause] ?? r.top_cause,
              <TrustChip key="t" trust="simulated" />,
            ])}
          />
        ) : <Empty msg="no history" />}
      </Card>
    </Shell>
  );
}
