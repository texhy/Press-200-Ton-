"use client";
import { useMemo } from "react";
import { Shell } from "@/components/shell/Shell";
import { Card, StatTile, TrustChip, TableView, Source } from "@/components/ui";
import { LineChart, BarChart, Empty } from "@/components/charts";
import { loadDay, loadHistory, useAsync } from "@/lib/data";
import { hhmmss } from "@/lib/cursor";
import { mins, n0, n1, pkr, partLabel } from "@/lib/format";

export default function EnergyPage() {
  const { data: day } = useAsync(loadDay);
  const { data: hist } = useAsync(loadHistory);

  const shift = useMemo(
    () => day ? day.minutes.filter((m) => m.m >= day.shift.m0 && m.m < day.shift.m1) : [],
    [day]);

  /* The money chart: production power vs IDLE power, stacked, with a rupee
     figure on the shaded part. Idle = motor spinning with nothing to show.

     BINNED TO 5 MINUTES, deliberately. At one point per minute this is 510
     samples across ~1500 px — three samples per pixel — and since the VFD
     model carries a +/-0.2 kW jitter, every one of those samples is a tooth
     on a comb. The result read as grass: visually loud, and it advertised a
     precision the simulated drive channel does not have. Five-minute means
     keep the only two things the chart is for — WHEN the motor was burning
     with nothing to show, and HOW MUCH — and drop the fake detail.
     Peak demand is unaffected: it comes from the unbinned totals. */
  const BIN_MIN = 5;
  const area = useMemo(() => {
    const x: number[] = [], prod: number[] = [], idle: number[] = [];
    for (let i = 0; i < shift.length; i += BIN_MIN) {
      const bin = shift.slice(i, i + BIN_MIN);
      if (!bin.length) break;
      const mean = (f: (m: typeof bin[number]) => number) =>
        bin.reduce((a, m) => a + f(m), 0) / bin.length;
      x.push(bin[0].m * 60);
      prod.push(+mean((m) => (m.s > 0 ? m.kw : 0)).toFixed(2));
      idle.push(+mean((m) => (m.s === 0 && m.motor ? m.kw : 0)).toFixed(2));
    }
    return { x, prod, idle };
  }, [shift]);

  const perPart = useMemo(() => {
    if (!hist) return [];
    const m = new Map<string, { kwh: number; strokes: number }>();
    for (const r of hist.rows) {
      const e = m.get(r.part) ?? { kwh: 0, strokes: 0 };
      e.kwh += r.kwh; e.strokes += r.strokes; m.set(r.part, e);
    }
    return [...m.entries()]
      .map(([p, v]) => ({ label: partLabel(p), value: +(v.kwh / Math.max(1, v.strokes) * 1000).toFixed(2) }))
      .sort((a, b) => b.value - a.value);
  }, [hist]);

  if (!day) return <Shell day={null}><Card title="Loading…" /></Shell>;
  const t = day.totals;

  return (
    <Shell day={day}>
      <div className="flex items-center gap-2 mb-3">
        <TrustChip trust="simulated" what="All energy" />
        <span className="text-[10px] text-[var(--muted)]">
          VFD registers are modelled from the camera's real stroke cadence. Tariff Rs {day.tariff_pkr_per_kwh}/kWh.
        </span>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
        <Card><StatTile source="vfd" label="Energy today" value={n1(t.kwh)} unit="kWh" /></Card>
        <Card><StatTile source={["vfd", "camera"]} sourceNote="drive energy over camera-counted strokes" label="kWh per 1,000 strokes" value={t.kwh_per_1000.toFixed(2)} /></Card>
        <Card edge="warning"><StatTile source={["vfd", "plc"]} sourceNote="drive power during minutes the PLC says the motor ran with no strokes" label="Idle energy" value={n1(t.idle_kwh)} unit="kWh"
                        tone="var(--s2)" sub={`${((t.idle_kwh / Math.max(0.1, t.kwh)) * 100).toFixed(0)}% of total`} /></Card>
        <Card><StatTile source="calc" sourceNote="energy x tariff / strokes" label="Cost per stroke" value={`Rs ${t.pkr_per_stroke.toFixed(2)}`} /></Card>
        <Card><StatTile source="vfd" sourceNote="highest 1-minute kW, unbinned" label="Peak demand" value={n1(t.peak_kw)} unit="kW" /></Card>
        <Card><StatTile source="vfd" label="Power factor" value={t.avg_pf.toFixed(3)} /></Card>
      </div>

      {/* ---------------- the chart that pays for the project ---------------- */}
      <Card title="Production power vs idle burn" className="mt-3"
            sub="Orange is the motor spinning with nothing to show for it · 5-minute means"
            right={<span className="flex items-center gap-2">
                     <Source from={["vfd", "plc"]} note="kW from the drive; producing-vs-idle from the PLC run state" />
                     <span className="readout text-[15px]" style={{ color: "var(--s2)" }}>{pkr(t.idle_pkr)}</span>
                   </span>}>
        <LineChart height={220} stack x={area.x}
          series={[
            { key: "prod", label: "Producing", color: "var(--s1)", values: area.prod },
            { key: "idle", label: "Idle burn", color: "var(--s2)", values: area.idle },
          ]}
          xFmt={(s) => hhmmss(s).slice(0, 5)} yFmt={(v) => `${v.toFixed(1)} kW`} legendKind="rect" />
        <p className="m-0 mt-2 text-[12px] text-[var(--ink-2)]">
          <b>{mins(t.idle_min)}</b> of this shift the press was powered and producing nothing —
          <b style={{ color: "var(--s2)" }}> {pkr(t.idle_pkr)}</b> at the current tariff.
          Across 22 working days that is <b>{pkr(t.idle_pkr * 22)}</b> a month.
        </p>
      </Card>

      <div className="grid gap-3 mt-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(330px,1fr))" }}>
        <Card title="Energy per 1,000 strokes" sub="Raw in grey, EWMA (λ=0.2) in accent — rising means something is wearing"
              right={<Source from="calc" note="30-day history: drive energy over stroke count" />}>
          {hist ? (() => {
            const raw = hist.rows.map((r) => +(r.kwh / Math.max(1, r.strokes) * 1000).toFixed(2));
            let prev: number | null = null;
            const sm = raw.map((v) => (prev = prev === null ? v : 0.2 * v + 0.8 * prev));
            return (
              <LineChart height={180} x={hist.rows.map((_, i) => i)}
                series={[
                  { key: "raw", label: "Daily", color: "var(--dim)", values: raw },
                  { key: "ewma", label: "EWMA", color: "var(--s1)", values: sm },
                ]}
                xFmt={(i) => hist.rows[i]?.date.slice(5) ?? ""} yFmt={(v) => v.toFixed(1)} />
            );
          })() : <Empty msg="no history" />}
        </Card>

        <Card title="Energy by part" sub="kWh per 1,000 strokes — which parts cost most to make"
              right={<Source from="calc" />}>
          {perPart.length
            ? <BarChart horizontal height={Math.max(150, perPart.length * 34)}
                        data={perPart.map((p) => ({ ...p, color: "var(--s1)" }))}
                        yFmt={(v) => `${v.toFixed(1)}`} />
            : <Empty msg="no history" />}
        </Card>
      </div>

      <Card title="Energy by day" className="mt-3">
        {hist ? (
          <TableView
            cols={["Date", "Part", "Strokes", "kWh", "Idle kWh", "kWh/1000", "Cost"]}
            rows={[...hist.rows].reverse().slice(0, 14).map((r) => [
              r.date, partLabel(r.part), n0(r.strokes), n1(r.kwh), n1(r.idle_kwh),
              (r.kwh / Math.max(1, r.strokes) * 1000).toFixed(2), pkr(r.pkr),
            ])}
          />
        ) : <Empty msg="no history" />}
      </Card>
    </Shell>
  );
}
