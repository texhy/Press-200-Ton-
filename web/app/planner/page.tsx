"use client";
import React, { useMemo, useState } from "react";
import { Shell } from "@/components/shell/Shell";
import { Card, Source, StatTile, StatusPill, TableView } from "@/components/ui";
import { DivergingBars, Empty } from "@/components/charts";
import { loadDay, loadHistory, loadPlan, useAsync } from "@/lib/data";
import { usePlanner, type CustomPart } from "@/lib/plannerStore";
import { mins, n0, partLabel, pkr } from "@/lib/format";
import type { PlanCell } from "@/lib/types";

const DAY_NAME = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function PlannerPage() {
  const { data: day } = useAsync(loadDay);
  const { data: plan } = useAsync(loadPlan);
  const { data: hist } = useAsync(loadHistory);
  const P = usePlanner(plan ?? null);
  const [sel, setSel] = useState<{ date: string; shift: string } | null>(null);
  const [showParts, setShowParts] = useState(false);

  const dates = useMemo(
    () => [...new Set((plan?.cells ?? []).map((c) => c.date))].sort(), [plan]);

  /** Baseline cells with local edits layered on, recomputed. */
  const cells = useMemo(
    () => (plan?.cells ?? []).map(P.resolve), [plan, P]);

  const cell = sel ? cells.find((c) => c.date === sel.date && c.shift === sel.shift) ?? null : null;

  /* PLAN vs ACTUAL over the history. `produced` is what the day actually made
     against the `target` it was given, so the variance is the plan's error,
     not the machine's — which is the number a planner can act on. */
  const variance = useMemo(() => {
    if (!hist || !day) return [];
    return hist.rows
      // TODAY IS NOT COMPARABLE and must not be plotted. Its `produced` is the
      // camera's parts cross-check over the 54 minutes it covered, while its
      // `target` is the whole shift — the subtraction invents a 3,538-piece
      // miss out of two numbers that measure different spans. A plan-vs-actual
      // chart only means anything over days that have finished.
      .filter((r) => r.date !== day.date)
      .map((r) => ({
        label: r.date,
        value: (r.produced ?? 0) - (r.target ?? 0),
        sub: `${n0(r.produced ?? 0)} made vs ${n0(r.target ?? 0)} planned · ${partLabel(r.part)}`,
      }));
  }, [hist, day]);

  const vstat = useMemo(() => {
    if (!variance.length) return null;
    const miss = variance.filter((v) => v.value < 0);
    const tot = variance.reduce((a, v) => a + v.value, 0);
    const absMean = variance.reduce((a, v) => a + Math.abs(v.value), 0) / variance.length;
    const plannedTot = (hist?.rows ?? [])
      .filter((r) => r.date !== day?.date)
      .reduce((a, r) => a + (r.target ?? 0), 0);
    return {
      hit: Math.round(100 * (variance.length - miss.length) / variance.length),
      missDays: miss.length, days: variance.length,
      net: tot, absMean: Math.round(absMean),
      biasPct: plannedTot ? +(100 * tot / plannedTot).toFixed(1) : 0,
    };
  }, [variance, hist]);

  if (!day || !plan) return <Shell day={null}><Card title="Loading…" /></Shell>;

  const infeasible = cells.filter((c) => !c.feasible);
  const totalCo = cells.reduce((a, c) => a + c.changeover_min, 0);

  return (
    <Shell day={day} wide>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
        <Card><StatTile source="plan" label="Week of" value={plan.week_of.slice(5)} /></Card>
        <Card><StatTile source="plan" label="Jobs planned" value={n0(cells.length)} /></Card>
        <Card edge={infeasible.length ? "warning" : undefined}>
          <StatTile source="calc" sourceNote="planned quantity against the part's achievable rate"
                    label="Over capacity" value={n0(infeasible.length)}
                    tone={infeasible.length ? "var(--warning)" : undefined} />
        </Card>
        <Card><StatTile source="calc" label="Changeover time" value={mins(totalCo)} /></Card>
        {vstat && (
          <Card><StatTile source="calc" sourceNote="days that met or beat their target, over the 30-day history"
                          label="Plan hit rate" value={`${vstat.hit}%`}
                          tone={vstat.hit < 60 ? "var(--warning)" : undefined} /></Card>
        )}
      </div>

      {/* ------------------------------------------------ the week grid */}
      <Card title="Weekly plan" className="mt-3" pad={false}
            sub="Click a cell to change the part or the quantity. Amber edge = the plan asks for more than the part's proven rate."
            right={
              <span className="flex items-center gap-2">
                {P.editCount > 0 && (
                  <>
                    <span className="text-[10px]" style={{ color: "var(--s1)" }}>
                      {P.editCount} edited
                    </span>
                    <button onClick={P.resetAll}
                            className="text-[10px] underline hover:text-[var(--ink)]">reset all</button>
                  </>
                )}
                <button onClick={() => setShowParts((v) => !v)}
                        className="h-[22px] px-2 rounded-[var(--r-ctl)] text-[10px]"
                        style={{ border: "1px solid var(--hair-strong)", color: "var(--ink-2)" }}>
                  {showParts ? "Hide parts" : "Edit parts"}
                </button>
              </span>
            }>
        <div className="px-4 pb-4 overflow-x-auto">
          <div className="grid gap-2 min-w-[880px]"
               style={{ gridTemplateColumns: `62px repeat(${dates.length}, minmax(104px,1fr))` }}>
            <span />
            {dates.map((d) => (
              <span key={d} className="text-[11px] font-[600] text-center">
                {DAY_NAME[new Date(d).getDay()]}
                <span className="block text-[9px] text-[var(--muted)] tnum">{d.slice(5)}</span>
              </span>
            ))}
            {["A", "B"].map((sh) => (
              <React.Fragment key={sh}>
                <span className="text-[11px] text-[var(--muted)] self-center">Shift {sh}</span>
                {dates.map((d) => {
                  const c = cells.find((x) => x.date === d && x.shift === sh);
                  if (!c) return <span key={`${d}${sh}`} />;
                  const on = sel?.date === d && sel?.shift === sh;
                  const load = Math.min(140, Math.round(100 * c.required_spm / Math.max(0.01, c.achieved_spm)));
                  return (
                    <button key={`${d}${sh}`}
                            onClick={() => setSel(on ? null : { date: d, shift: sh })}
                            className="relative text-left p-2 rounded-[var(--r-ctl)] overflow-hidden
                                       transition-[background,border-color,transform] hover:-translate-y-[1px]"
                            style={{ background: on ? "var(--raised)" : "var(--surface)",
                                     border: `1px solid ${on ? "var(--s1)" : "var(--hair)"}` }}>
                      {!c.feasible && (
                        <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[3px]"
                              style={{ background: "var(--warning)" }} />
                      )}
                      {c.edited && (
                        <span aria-hidden title="locally edited"
                              className="absolute right-1.5 top-1.5 w-[5px] h-[5px] rounded-full"
                              style={{ background: "var(--s1)" }} />
                      )}
                      <span className="block text-[11px] font-[600] truncate">{partLabel(c.part)}</span>
                      <span className="block text-[10px] text-[var(--muted)] tnum">{n0(c.qty)} pcs · {c.die}</span>
                      {/* load against the proven rate, as a bar not a number */}
                      <span className="block mt-1.5 h-[4px] rounded-full overflow-hidden"
                            style={{ background: "var(--track)" }}>
                        <span className="block h-full rounded-full"
                              style={{ width: `${Math.min(100, load)}%`,
                                       background: c.feasible ? "var(--good)" : "var(--warning)" }} />
                      </span>
                      <span className="flex items-baseline justify-between mt-0.5">
                        <span className="text-[9px] text-[var(--muted)] tnum">{load}% load</span>
                        {c.changeover_min > 0 && (
                          <span className="text-[9px]" style={{ color: "var(--s2)" }}>↻{c.changeover_min}m</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      </Card>

      {showParts && <PartsEditor P={P} />}

      <div className="grid gap-3 mt-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))" }}>
        {cell && <CellEditor cell={cell} P={P} onClose={() => setSel(null)} />}

        {/* -------------------------------------- plan vs actual history */}
        <Card title="Plan vs actual" sub="pieces made minus pieces planned, per day"
              right={<Source from="calc" note="history.json: produced against the target that day was given" />}>
          {variance.length ? (
            <div className="flex flex-col gap-2.5">
              <DivergingBars data={variance} height={190}
                             xFmt={(d) => d.slice(5)} />
              {vstat && (
                <div className="grid gap-x-4 gap-y-2 pt-2.5"
                     style={{ gridTemplateColumns: "repeat(auto-fit,minmax(118px,1fr))",
                              borderTop: "1px solid var(--hair)" }}>
                  {([
                    ["Met plan", `${vstat.days - vstat.missDays}/${vstat.days}`, undefined],
                    ["Avg miss", `${n0(vstat.absMean)} pcs`, undefined],
                    ["Net", `${vstat.net > 0 ? "+" : ""}${n0(vstat.net)}`,
                      vstat.net < 0 ? "var(--dv-pos)" : "var(--dv-neg)"],
                    ["Planning bias", `${vstat.biasPct > 0 ? "+" : ""}${vstat.biasPct}%`,
                      Math.abs(vstat.biasPct) > 5 ? "var(--warning)" : undefined],
                  ] as [string, string, string | undefined][]).map(([k, v, tone]) => (
                    <div key={k} className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-[10px] text-[var(--muted)] truncate">{k}</span>
                      <span className="text-[16px] font-[620] tnum" style={tone ? { color: tone } : undefined}>{v}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="m-0 text-[10px] text-[var(--muted)] leading-snug">
                A consistent negative bias means the targets are set above what this
                press has ever produced, not that the shift underperformed. Today is
                excluded — it is still running. The 29 days shown are simulated.
              </p>
            </div>
          ) : <Empty msg="no history" />}
        </Card>
      </div>

      <Card title="Proven rate per part" className="mt-3"
            sub="the rate each part is planned against"
            right={<Source from={["camera", "calc"]} note="Form Left is measured from the camera run; the rest are estimates anchored on it" />}>
        <TableView
          cols={["Part", "Process", "Die", "Rate (spm)", "Trust", "kWh / 1,000"]}
          rows={P.parts.map((p) => [
            partLabel(p.part), p.process, p.die, p.achieved_spm.toFixed(2),
            <span key="t" className="text-[10px]"
                  style={{ color: p.spm_trust === "measured" ? "var(--s3)"
                         : p.spm_trust === "user" ? "var(--s1)" : "var(--muted)" }}>
              {p.spm_trust === "user" ? "YOUR ESTIMATE" : p.spm_trust.toUpperCase()}
            </span>,
            p.kwh_per_1000.toFixed(1),
          ])}
        />
      </Card>
    </Shell>
  );
}

/* ------------------------------------------------------------ cell editor */
function CellEditor({ cell, P, onClose }: {
  cell: PlanCell; P: ReturnType<typeof usePlanner>; onClose: () => void;
}) {
  const worst = Math.max(cell.required_spm, cell.achieved_spm);
  return (
    <Card title="Capacity check" edge={cell.feasible ? undefined : "warning"}
          sub={`${cell.date} · Shift ${cell.shift}`}
          right={<button onClick={onClose} aria-label="Close"
                         className="text-[var(--muted)] hover:text-[var(--ink)] text-[14px] leading-none">×</button>}>
      <div className="flex flex-col gap-3">
        <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 108px" }}>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-[var(--muted)]">Part</span>
            <select value={cell.part}
                    onChange={(e) => P.setCell(cell.date, cell.shift, { part: e.target.value })}
                    className="h-[30px] px-2 rounded-[var(--r-ctl)] text-[12px] bg-transparent"
                    style={{ border: "1px solid var(--hair-strong)", color: "var(--ink)" }}>
              {P.parts.map((p) => (
                <option key={p.part} value={p.part}>{partLabel(p.part)} · {p.die}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-[var(--muted)]">Pieces</span>
            <input type="number" min={0} step={50} value={cell.qty}
                   onChange={(e) => P.setCell(cell.date, cell.shift, { qty: Math.max(0, +e.target.value) })}
                   className="h-[30px] px-2 rounded-[var(--r-ctl)] text-[12px] bg-transparent tnum"
                   style={{ border: "1px solid var(--hair-strong)", color: "var(--ink)" }} />
          </label>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between text-[11px]">
            <span className="text-[var(--muted)]">This plan requires</span>
            <span className="readout">{cell.required_spm.toFixed(2)} spm</span>
          </div>
          <div className="h-[6px] rounded-full overflow-hidden" style={{ background: "var(--track)" }}>
            <div className="h-full rounded-full" style={{ width: `${(cell.required_spm / worst) * 100}%`, background: "var(--s1)" }} />
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-[var(--muted)]">The part has proven</span>
            <span className="readout">{cell.achieved_spm.toFixed(2)} spm</span>
          </div>
          <div className="h-[6px] rounded-full overflow-hidden" style={{ background: "var(--track)" }}>
            <div className="h-full rounded-full"
                 style={{ width: `${(cell.achieved_spm / worst) * 100}%`,
                          background: cell.feasible ? "var(--good)" : "var(--warning)" }} />
          </div>
        </div>

        {cell.feasible ? (
          <StatusPill severity="ok">Fits the shift</StatusPill>
        ) : (
          <div className="flex flex-col gap-1.5">
            <StatusPill severity="warning">
              {cell.shortfall_pct}% over what this part has ever run
            </StatusPill>
            <p className="m-0 text-[11px] text-[var(--ink-2)] leading-snug">
              Realistic for this shift: <b>{n0(cell.realistic_qty)} pcs</b>.
              {" "}To hold {n0(cell.qty)} you need <b>{mins(cell.overtime_min)}</b> of overtime.
            </p>
          </div>
        )}

        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 m-0 text-[11px]">
          {[["Energy", `${cell.energy_kwh} kWh`], ["Cost", pkr(cell.energy_pkr)],
            ["Changeover in", cell.changeover_min ? mins(cell.changeover_min) : "none"],
            ["Operator", cell.operator]].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2">
              <dt className="m-0 text-[var(--muted)]">{k}</dt><dd className="m-0 tnum truncate">{v}</dd>
            </div>
          ))}
        </dl>

        {cell.edited && (
          <button onClick={() => P.clearCell(cell.date, cell.shift)}
                  className="self-start text-[10px] underline text-[var(--muted)] hover:text-[var(--ink)]">
            revert this cell to the generated plan
          </button>
        )}
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------- parts editor */
function PartsEditor({ P }: { P: ReturnType<typeof usePlanner> }) {
  const [f, setF] = useState<CustomPart>({
    part: "", process: "", die: "", achieved_spm: 5, kwh_per_1000: 12, spm_trust: "user",
  });
  const ok = f.part.trim().length > 1 && f.achieved_spm > 0;
  return (
    <Card title="Your parts" className="mt-3"
          sub="Added here, they appear in every cell's part list. Stored in this browser only — there is no backend in this demo."
          right={<Source from="plan" note="your own entries; nothing measured them" />}>
      <div className="flex flex-col gap-3">
        <div className="grid gap-2" style={{ gridTemplateColumns: "1.4fr 1.2fr .8fr .8fr .9fr auto" }}>
          {([["part", "Part name", "text"], ["process", "Process", "text"], ["die", "Die", "text"],
             ["achieved_spm", "Rate (spm)", "number"], ["kwh_per_1000", "kWh / 1,000", "number"]] as const).map(
            ([k, label, type]) => (
              <label key={k} className="flex flex-col gap-1 min-w-0">
                <span className="text-[10px] text-[var(--muted)]">{label}</span>
                <input type={type} step={type === "number" ? 0.1 : undefined}
                       value={String(f[k])}
                       onChange={(e) => setF({ ...f,
                         [k]: type === "number" ? +e.target.value : e.target.value } as CustomPart)}
                       className="h-[30px] px-2 rounded-[var(--r-ctl)] text-[12px] bg-transparent min-w-0"
                       style={{ border: "1px solid var(--hair-strong)", color: "var(--ink)" }} />
              </label>
            ))}
          <button disabled={!ok}
                  onClick={() => { P.addPart({ ...f, part: f.part.trim() });
                                   setF({ part: "", process: "", die: "", achieved_spm: 5, kwh_per_1000: 12, spm_trust: "user" }); }}
                  className="h-[30px] px-3 self-end rounded-[var(--r-ctl)] text-[11px] font-[600] disabled:opacity-40"
                  style={{ background: "var(--s1)", color: "#fff" }}>Add</button>
        </div>

        {P.custom.length > 0 && (
          <TableView
            cols={["Part", "Process", "Die", "Rate", "kWh / 1,000", ""]}
            rows={P.custom.map((p) => [
              p.part, p.process || "—", p.die || "—", p.achieved_spm.toFixed(2), p.kwh_per_1000.toFixed(1),
              <button key="x" onClick={() => P.removePart(p.part)}
                      className="text-[10px] text-[var(--muted)] hover:text-[var(--critical)]">remove</button>,
            ])}
          />
        )}
      </div>
    </Card>
  );
}
