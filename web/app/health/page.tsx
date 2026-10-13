"use client";
import { Shell } from "@/components/shell/Shell";
import { Card, Sparkline, Source, StatusPill, TableView, TrustChip, ZoneBadge } from "@/components/ui";
import { Empty } from "@/components/charts";
import { loadDay, loadHistory, useAsync } from "@/lib/data";
import { ZONE_COLOR } from "@/lib/palette";
import { n0 } from "@/lib/format";
import type { HealthRow } from "@/lib/types";

/** Zone bands drawn as a track with the EWMA marker on it. ISO 10816 zones are
 *  genuinely severity STATES, so the status palette is the right encoding here —
 *  the one place a severity ramp beats a categorical one. */
function ZoneTrack({ r }: { r: HealthRow }) {
  // For "down-bad" the scale runs the other way: A is the HIGH end, so the
  // window has to extend above band A, not below band C.
  const max = r.direction === "up-bad" ? r.bands.C * 1.18 : r.bands.A * 1.06;
  const min = r.direction === "up-bad" ? 0 : r.bands.C * 0.94;
  const at = (v: number) => `${Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100))}%`;
  const stops = r.direction === "up-bad"
    ? [["A", min, r.bands.A], ["B", r.bands.A, r.bands.B], ["C", r.bands.B, r.bands.C], ["D", r.bands.C, max]] as const
    : [["D", min, r.bands.C], ["C", r.bands.C, r.bands.B], ["B", r.bands.B, r.bands.A], ["A", r.bands.A, max]] as const;
  return (
    <div className="relative h-[8px] rounded-full overflow-hidden" style={{ background: "var(--grid)" }}>
      {stops.map(([z, a, b]) => (
        <span key={z} className="absolute top-0 bottom-0" title={`Zone ${z}`}
              style={{ left: at(a), width: `calc(${at(b)} - ${at(a)})`,
                       background: ZONE_COLOR[z], opacity: 0.3 }} />
      ))}
      <span aria-hidden className="absolute top-[-3px] w-[3px] h-[14px] rounded-sm"
            style={{ left: at(r.ewma), background: "var(--ink)" }} />
    </div>
  );
}

export default function HealthPage() {
  const { data: day } = useAsync(loadDay);
  const { data: hist } = useAsync(loadHistory);

  if (!day) return <Shell day={null}><Card title="Loading…" /></Shell>;

  const rows = hist?.health ?? [];
  const worst = rows.filter((r) => r.zone === "C" || r.zone === "D");

  return (
    <Shell day={day}>
      {worst.length > 0 && (
        <Card title="Needs attention" edge="serious" className="mb-3"
              sub="EWMA has crossed into zone C or beyond">
          <div className="flex flex-col gap-2">
            {worst.map((r) => (
              <div key={r.key} className="flex items-center gap-3 flex-wrap text-[12px]">
                <ZoneBadge zone={r.zone} />
                <span className="font-[600]">{r.label}</span>
                <span className="readout">{r.ewma}{r.unit}</span>
                <span className="text-[var(--muted)]">{r.note}</span>
                {r.weeks_to_boundary !== null && (
                  <span className="ml-auto" style={{ color: "var(--serious)" }}>
                    {r.weeks_to_boundary < 0.3 ? "crossing now" : `~${r.weeks_to_boundary} weeks to next zone`}
                  </span>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title="Condition indicators" pad={false}
            sub="Time-to-threshold is shown only where the fit is real (R² > 0.7)"
            right={<TrustChip trust="simulated" />}>
        <div className="px-4 pb-4 flex flex-col">
          <div className="grid gap-2 py-2 text-[10px] font-[700] tracking-[0.06em] text-[var(--muted)]"
               style={{ gridTemplateColumns: "1.6fr 70px 70px 34px 1.3fr 90px 100px", borderBottom: "1px solid var(--hair)" }}>
            <span>INDICATOR</span><span className="text-right">NOW</span><span className="text-right">EWMA</span>
            <span>ZONE</span><span>A / B / C / D</span><span className="text-right">30-DAY</span>
            <span className="text-right">TO NEXT ZONE</span>
          </div>
          {rows.map((r) => (
            <div key={r.key} className="grid gap-2 py-2.5 items-center text-[12px]"
                 style={{ gridTemplateColumns: "1.6fr 70px 70px 34px 1.3fr 90px 100px", borderBottom: "1px solid var(--hair)" }}>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="truncate">{r.label}</span>
                  {/* which tap this indicator needs. Four of the seven are
                      drive-only and three are camera-only — nothing here comes
                      from both, and that is the argument for keeping both. */}
                  {r.source && <Source from={r.source} />}
                </span>
                <span className="block text-[10px] text-[var(--muted)] truncate">{r.note}</span>
              </span>
              <span className="readout text-right">{r.value}</span>
              <span className="readout text-right" style={{ color: ZONE_COLOR[r.zone] }}>{r.ewma}</span>
              <span><ZoneBadge zone={r.zone} /></span>
              <span><ZoneTrack r={r} /></span>
              <span><Sparkline values={r.spark} h={24} color={ZONE_COLOR[r.zone]} /></span>
              <span className="text-right text-[11px]">
                {r.weeks_to_boundary === null ? (
                  <span className="text-[var(--muted)]" title={`R² = ${r.r2}`}>insufficient trend</span>
                ) : r.weeks_to_boundary < 0.3 ? (
                  <span style={{ color: "var(--serious)" }}>crossing now</span>
                ) : (
                  <span className="readout">~{r.weeks_to_boundary}w</span>
                )}
                <span className="block text-[9px] text-[var(--muted)]">R² {r.r2}</span>
              </span>
            </div>
          ))}
          {!rows.length && <Empty msg="no health history" />}
        </div>
      </Card>
    </Shell>
  );
}
