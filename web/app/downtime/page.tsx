"use client";
import { useMemo, useState } from "react";
import { Shell } from "@/components/shell/Shell";
import { GapCard } from "@/components/shell/Inspector";
import { Card, Source, StatTile, StatusPill, TableView, TrustChip } from "@/components/ui";
import { SmallMultiples, Empty } from "@/components/charts";
import { loadDay, loadHistory, useAsync } from "@/lib/data";
import { useCursor, hhmmss } from "@/lib/cursor";
import { CAUSE_COLOR, CAUSE_LABEL } from "@/lib/palette";
import { mins, n0, pkr } from "@/lib/format";
import type { Cause } from "@/lib/types";

export default function DowntimePage() {
  const { data: day } = useAsync(loadDay);
  const { data: hist } = useAsync(loadHistory);
  const { setT, openInspector, hovered } = useCursor();
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Cause | null>(null);

  const byCause = useMemo(() => {
    if (!day) return [];
    const m = new Map<Cause, { minutes: number; n: number; pkr: number; strokes: number }>();
    // scheduled breaks are PLANNED downtime — context, not loss
    for (const g of day.gaps.filter((x) => x.cause !== "break")) {
      const e = m.get(g.cause) ?? { minutes: 0, n: 0, pkr: 0, strokes: 0 };
      e.minutes += g.cost.minutes; e.n += 1; e.pkr += g.cost.pkr; e.strokes += g.cost.strokes;
      m.set(g.cause, e);
    }
    return [...m.entries()].sort((a, b) => b[1].minutes - a[1].minutes);
  }, [day]);


  const unexplained = (day?.gaps ?? []).filter((g) => g.cause === "unexplained" && !confirmed.has(g.id));
  const rows = (day?.gaps ?? [])
    .filter((g) => g.cause !== "break")
    .filter((g) => !filter || g.cause === filter);

  const weekly = useMemo(() => {
    if (!hist) return [];
    const causes = [...new Set(hist.rows.map((r) => r.top_cause))].slice(0, 6);
    return causes.map((c, i) => ({
      label: CAUSE_LABEL[c as Cause] ?? c,
      color: CAUSE_COLOR[c as Cause] ?? "var(--muted)",
      x: hist.rows.map((_, j) => j),
      values: hist.rows.map((r) => (r.top_cause === c ? r.top_cause_min : 0)),
    }));
  }, [hist]);

  if (!day) return <Shell day={null}><Card title="Loading…" /></Shell>;

  return (
    <Shell day={day}>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
        <Card><StatTile source="calc" sourceNote="gaps classified by the reason engine from PLC state + camera cadence" label="Downtime today" value={mins(day.totals.downtime_min)} /></Card>
        <Card><StatTile source="calc" label="Stops classified" value={n0(day.gaps.filter((g) => g.cause !== "break").length)}
                        sub={`+ ${mins(day.totals.break_min)} scheduled break`} /></Card>
        <Card edge={unexplained.length ? "critical" : undefined}>
          <StatTile source="calc" sourceNote="no PLC bit, no VFD fault and no camera evidence accounts for these" label="Unexplained" value={n0(unexplained.length)}
                    tone={unexplained.length ? "var(--critical)" : undefined}
                    sub={unexplained.length ? "needs a human" : "all accounted for"} />
        </Card>
        <Card><StatTile source={["vfd", "plc"]} sourceNote="drive power during motor-on minutes with no strokes" label="Idle burn" value={pkr(day.totals.idle_pkr)} tone="var(--s2)"
                        sub={`${mins(day.totals.idle_min)} motor on, no output`} /></Card>
      </div>

      {/* ---------- triage first: the only thing needing a decision ---------- */}
      {unexplained.length > 0 && (
        <Card title="Triage queue" sub="Nothing explains these — escalate or reclassify"
              edge="critical" className="mt-3">
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))" }}>
            {unexplained.map((g) => (
              <div key={g.id} className="p-3 rounded-[var(--r-ctl)]" style={{ border: "1px solid var(--hair)" }}>
                <GapCard gap={g} day={day}
                         onConfirm={(id) => setConfirmed((s) => new Set(s).add(id))} />
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ONE card, not two. "Where the time went" drew a bar per cause and
          "Cost of each cause" listed the same causes in the same order with
          the same colours — the reader had to look left, then right, and match
          rows by hue. A bar and its numbers belong on the same line. */}
      <Card title="Where the time went" className="mt-3"
            sub="every cause today, worst first · click a row to filter the log below"
            right={<Source from="calc" note="minutes attributed by the reason engine, costed at the measured cadence and tariff" />}>
        <div className="flex flex-col">
          <div className="grid gap-2 pb-1.5 text-[10px] text-[var(--muted)] uppercase tracking-wide"
               style={{ gridTemplateColumns: "160px 1fr 50px 66px 84px 70px",
                        borderBottom: "1px solid var(--hair)" }}>
            <span>Cause</span><span /><span className="text-right">Times</span>
            <span className="text-right">Minutes</span>
            <span className="text-right">Strokes lost</span>
            <span className="text-right">Idle cost</span>
          </div>
          {byCause.map(([c, v]) => {
            const on = filter === c;
            const pct = (v.minutes / Math.max(1, byCause[0][1].minutes)) * 100;
            return (
              <button key={c} onClick={() => setFilter(on ? null : c)}
                      className="grid gap-2 items-center py-2 text-[12px] text-left rounded-[var(--r-ctl)]
                                 transition-colors hover:bg-[var(--raised)]"
                      style={{ gridTemplateColumns: "160px 1fr 50px 66px 84px 70px",
                               borderBottom: "1px solid var(--hair)",
                               background: on ? "var(--raised)" : undefined }}>
                <span className="flex items-center gap-2 min-w-0">
                  <i aria-hidden className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: CAUSE_COLOR[c] }} />
                  <span className="truncate">{CAUSE_LABEL[c]}</span>
                </span>
                <span className="block h-[14px]">
                  <span className="block h-full rounded-[3px]"
                        style={{ width: `${pct}%`, background: CAUSE_COLOR[c],
                                 opacity: filter === null || on ? 1 : 0.35,
                                 transition: "width var(--t-slow) var(--e-out), opacity var(--t-base)" }} />
                </span>
                <span className="text-right tnum text-[var(--muted)]">{v.n}x</span>
                <span className="text-right tnum font-[600]">{mins(v.minutes)}</span>
                <span className="text-right tnum">{n0(v.strokes)}</span>
                <span className="text-right tnum" style={{ color: v.pkr > 0 ? "var(--s2)" : "var(--muted)" }}>
                  {pkr(v.pkr)}
                </span>
              </button>
            );
          })}
          {!byCause.length && <Empty msg="no stoppages classified" />}
        </div>
        <p className="m-0 mt-2 text-[10px] text-[var(--muted)]">
          Cause colours are entity-locked — the same hue here, on the timeline and on the spine.
          Scheduled breaks are excluded: planned downtime, not loss.
        </p>
      </Card>


      <Card title="Top cause per day" sub="Faceted — six series on one plot would be unreadable" className="mt-3"
            right={<Source from="calc" note="30-day history; days 2-30 are simulated" />}>
        {weekly.length
          ? <SmallMultiples panels={weekly} yFmt={(v) => `${v.toFixed(0)}m`} />
          : <Empty msg="no history" />}
      </Card>

      <Card title={filter ? `Stops — ${CAUSE_LABEL[filter]}` : "Every stop today"} className="mt-3"
            right={filter
              ? <button onClick={() => setFilter(null)} className="text-[10px] text-[var(--s1)]">clear filter</button>
              : <TrustChip trust="inferred" what="cause" />}>
        <TableView
          cols={["Start", "Duration", "Cause", "Confidence", "Camera", "Cost", ""]}
          rows={rows.map((g) => [
            <span key="t" className="readout">{hhmmss(g.t0).slice(0, 5)}</span>,
            mins(g.cost.minutes),
            <span key="c" className="flex items-center gap-1.5">
              <i className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: CAUSE_COLOR[g.cause] }} />
              {g.label}
            </span>,
            g.confidence === "none"
              ? <StatusPill key="s" severity="critical">none</StatusPill>
              : <span key="s" className="text-[var(--muted)]">{g.confidence}</span>,
            g.camera ? <span key="m" style={{ color: "var(--s3)" }}>measured</span>
                     : <span key="m" className="text-[var(--muted)]">no coverage</span>,
            pkr(g.cost.pkr),
            <button key="b" onClick={() => { setT(g.t0 + 1); openInspector(g.id); }}
                    className="text-[10px] text-[var(--s1)]">why ▸</button>,
          ])}
          caption="Every row is clickable back to the evidence and the footage."
        />
      </Card>
    </Shell>
  );
}
