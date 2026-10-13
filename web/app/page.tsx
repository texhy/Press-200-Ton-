"use client";
import { useState, useMemo } from "react";
import { Shell } from "@/components/shell/Shell";
import { Card, StatusPill, StatTile, TrustChip } from "@/components/ui";
import { FloorLegend } from "@/components/floor/FloorPlan2D";
import { FloorView, SimpleViewToggle } from "@/components/floor/FloorView";
import { StationRoster, StationCard } from "@/components/floor/StationRoster";
import { loadDay, loadPulse, useAsync } from "@/lib/data";
import { loadFloor } from "@/lib/floor";
import { allStatuses, bySeverity } from "@/lib/floorStatus";
import { useCursor, hhmmss } from "@/lib/cursor";
import { STATUS_COLOR } from "@/lib/palette";

/** THE FRONT DOOR.
 *
 *  This is what the maintenance room sees first: the whole shop, which station
 *  is in trouble, and one click into the evidence. The 3D view lands in the
 *  next phase; the SVG plan below is not a placeholder for it — it stays as the
 *  no-WebGL / reduced-motion / mobile / print path. */
export default function FloorPage() {
  const { data: day } = useAsync(loadDay);
  // the 25 Hz slide signal — this is what makes the one measured ram real
  const { data: pulse } = useAsync(loadPulse);
  const { data: floorData, err } = useAsync(loadFloor);
  const floor = floorData;
  const { t } = useCursor();
  const [selected, setSelected] = useState<string | null>(null);
  const [simple, setSimple] = useState(false);
  const [viewId, setViewId] = useState("overview");
  /* floorData MUST be in the deps. It was omitted behind an eslint-disable, so
     the memo ran once on the first render — while the fetch was still in
     flight and floorData was null — cached `null`, and never recomputed,
     because viewId was already "overview". The camera therefore sat on the
     Canvas's initial prop forever and every view preset, including "Reset
     view", did nothing. `selected` was in the list and is not read here. */
  const view = useMemo(
    () => floorData?.views.find((v) => v.id === viewId) ?? null,
    [floorData, viewId]);

  // selecting the instrumented station flies the camera to its preset
  const pick = (id: string | null) => {
    setSelected(id);
    const v = floorData?.views.find((x) => x.id === id);
    setViewId(v ? id! : "overview");
  };

  const attention = useMemo(() => {
    if (!floor) return [];
    const st = allStatuses(floor, day, t);
    return floor.stations
      .map((s) => ({ s, st: st.get(s.id)! }))
      .filter((r) => r.st.severity === "critical" || r.st.severity === "serious")
      .sort((a, b) => bySeverity(a.st, b.st));
  }, [floor, day, t]);

  if (err) {
    return (
      <Shell day={day}>
        <Card title="Floor map unavailable" edge="warning">
          <p className="m-0 text-[11px] text-[var(--muted)]">{err}</p>
        </Card>
      </Shell>
    );
  }
  if (!floor) return <Shell day={day}><Card title="Loading floor…" /></Shell>;

  return (
    <Shell day={day} wide>
      {/* the provenance banner — unmissable, not buried in a tooltip */}
      <Card edge="warning" className="mb-3">
        <div className="flex items-center gap-3 flex-wrap">
          <TrustChip trust="simulated" />
          <p className="m-0 text-[11px] text-[var(--ink-2)] flex-1 min-w-[280px]">
            <b>{floor.legend.text}.</b> Press 200 (s_press_1) is the only station with a
            camera, PLC tap or drive link. The other {floor.legend.total - floor.legend.instrumented} show
            a declared simulation so the floor reads as a shop — they are not measurements.
          </p>
        </div>
      </Card>

      <div className="grid gap-3" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(260px,320px)" }}>
        <Card title="Press shop floor" pad={false}
              sub={`${floor.stations.length} stations · drag to pan · scroll to zoom · right-drag to rotate`}
              right={
                <span className="flex items-center gap-2.5">
                  {floor.views.map((v) => (
                    <button key={v.id} onClick={() => setViewId(v.id)}
                            className="px-1.5 h-[20px] rounded text-[10px] border"
                            style={{ borderColor: viewId === v.id ? "var(--s1)" : "var(--hair)",
                                     color: viewId === v.id ? "var(--s1)" : "var(--muted)" }}>
                      {v.id === "overview" ? "Reset view" : v.id === "s_press_1" ? "Press 200" : "Hydraulic"}
                    </button>
                  ))}
                  <SimpleViewToggle on={simple} onToggle={setSimple} />
                </span>
              }>
          <div className="px-4 pb-3">
            <div className="w-full rounded-[var(--r-ctl)] overflow-hidden"
                 style={{ height: "clamp(380px, 62vh, 760px)", background: "var(--plane)" }}>
              <FloorView floor={floor} day={day} pulse={pulse} t={t} force2d={simple}
                         selected={selected} onSelect={pick} view={view} />
            </div>
            <div className="mt-2"><FloorLegend floor={floor} /></div>
          </div>
        </Card>

        <div className="flex flex-col gap-3 min-w-0">
          {attention.length > 0 && (
            <Card title="Needs attention" edge="critical" sub="worst first">
              <div className="flex flex-col gap-1.5">
                {attention.map(({ s, st }) => (
                  <button key={s.id} onClick={() => pick(s.id)}
                          className="flex items-center gap-2 text-left text-[12px]">
                    <span aria-hidden className="w-[9px] h-[9px] rounded-sm shrink-0"
                          style={{ background: STATUS_COLOR[st.severity!] }} />
                    <span className="font-[600]">{s.label}</span>
                    <span className="text-[var(--muted)] truncate">{st.state}</span>
                    {!s.instrumented && <span className="ml-auto"><TrustChip trust="simulated" /></span>}
                  </button>
                ))}
              </div>
            </Card>
          )}

          {selected && (
            <Card>
              <StationCard floor={floor} day={day} t={t} id={selected}
                           onClose={() => setSelected(null)} />
            </Card>
          )}

          <Card title="All stations" pad={false}
                sub="keyboard path and table twin of the map">
            <div className="px-2 pb-3 max-h-[46vh] overflow-y-auto">
              <StationRoster floor={floor} day={day} t={t}
                             selected={selected} onSelect={pick} />
            </div>
          </Card>
        </div>
      </div>
    </Shell>
  );
}
