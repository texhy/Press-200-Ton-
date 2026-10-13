"use client";
import { useMemo } from "react";
import { Shell } from "@/components/shell/Shell";
import { Card, HeroFigure, Meter, Readout, StatusPill, TrustChip, Source } from "@/components/ui";
import { LineChart, Empty } from "@/components/charts";
import { SlidePosition } from "@/components/instruments/SlidePosition";
import { ShiftRibbon } from "@/components/instruments/ShiftRibbon";
import { loadDay, loadCv, loadPlan, useAsync } from "@/lib/data";
import { useCvLive } from "@/lib/cvlive";
import { useCursor, hhmmss } from "@/lib/cursor";
import { mins, n0, partLabel, pkr, pct } from "@/lib/format";
import { CAUSE_COLOR, CAUSE_LABEL } from "@/lib/palette";

/** The median running cadence over the complete camera run: 11.20 s between
 *  counted strokes. Plotted as a reference so "slow" is relative to what this
 *  press has actually been seen to do, not only to the planned takt. */
const MEASURED_SPM = 5.36;

/** A labelled figure inside the job card, with its channel attached. */
function JobStat({ label, value, sub, src }: {
  label: string; value: string; sub?: string; src: "camera" | "plc" | "vfd" | "calc" | "plan";
}) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <dt className="m-0 text-[11px] text-[var(--muted)] flex items-center gap-1.5">
        {label}<Source from={src} />
      </dt>
      <dd className="m-0 text-[19px] font-[620] leading-none tnum truncate">{value}</dd>
      {sub && <dd className="m-0 text-[10px] text-[var(--muted)]">{sub}</dd>}
    </div>
  );
}

export default function LivePage() {
  const { data: day, err } = useAsync(loadDay);
  const { data: cv } = useAsync(loadCv);
  const { data: plan } = useAsync(loadPlan);
  const { t, setT, openInspector } = useCursor();

  /* Everything the CAMERA knows is read at the playhead, not out of a
     one-minute bucket — that is what makes the screen move while the video
     runs. PLC/VFD stay on the minute spine: they are simulated, and giving
     them sub-minute detail would be inventing precision. */
  const L = useCvLive(cv ?? null, day ?? null, t);
  const cur = day?.minutes[Math.floor(t / 60)];

  // strokes before the camera window come from the spine; inside it the
  // camera's own counter takes over, so the number ticks up as you watch
  const preCam = useMemo(
    () => day ? day.minutes.filter((m) => m.m < day.camera.start_min).reduce((a, m) => a + m.s, 0) : 0,
    [day]);
  const strokesSoFar = useMemo(() => {
    if (!day) return 0;
    if (L.covered) return preCam + L.strokes;
    return day.minutes.filter((m) => m.m <= Math.floor(t / 60)).reduce((a, m) => a + m.s, 0);
  }, [day, t, L.covered, L.strokes, preCam]);

  /* Rolling pace from the camera's real stroke times.
     A 15-SECOND bucket was the bug here. This press runs at 5.36 spm, so a
     15 s window holds one or two strokes and nothing else is representable:
     x4 to get per-minute and the series can only ever be 0, 4 or 8. The chart
     drew a square wave and looked like noise on a machine that was running
     perfectly steadily.
     A 60 s window stepped every 10 s samples the same strokes but resolves
     the actual rate, and overlapping windows smooth the quantisation instead
     of amplifying it. */
  const PACE_WIN = 60, PACE_STEP = 10, PACE_SPAN = 12 * 60;
  const pace = useMemo(() => {
    if (!day) return { x: [] as number[], v: [] as number[] };
    const x: number[] = [], v: number[] = [];
    // one pass over the strokes in range, not one filter() per bucket
    const lo = t - PACE_SPAN - PACE_WIN;
    const inRange = day.strokes.filter((k) => k.t >= lo && k.t <= t).map((k) => k.t);
    for (let s = t - PACE_SPAN; s <= t; s += PACE_STEP) {
      x.push(s);
      let n = 0;
      for (const kt of inRange) if (kt > s - PACE_WIN && kt <= s) n++;
      v.push((n * 60) / PACE_WIN);
    }
    return { x, v };
  }, [day, t]);

  /* WHAT IS COMING, AND WHEN.
     Remaining pieces at the rate this press has actually been measured at —
     not at the planned takt, which it has never hit. If that run-out lands
     past the end of the shift the card says so instead of printing a time
     that implies the job finishes today. */
  const upNext = useMemo(() => {
    if (!day || !plan) return null;
    const cells = [...plan.cells].sort((a, b) => (a.date + a.shift).localeCompare(b.date + b.shift));
    const i = cells.findIndex((c) => c.date === day.date && c.shift === day.operator.shift);
    const next = i >= 0 ? cells[i + 1] : null;
    return next ?? null;
  }, [day, plan]);

  const active = day?.gaps.find((g) => t >= g.t0 && t < g.t1);

  if (err) return <Shell day={null}><Card title="Could not load"><p className="text-[11px]">{err}</p></Card></Shell>;
  if (!day || !cur) return <Shell day={null}><Card title="Loading…" /></Shell>;

  const target = day.job.target;
  const progress = Math.min(100, (strokesSoFar / target) * 100);

  // share of the CAMERA WINDOW the operator was at the press — a percentage of
  // covered time, never of the shift, because outside coverage we do not know
  const presencePct = day.camera
    ? Math.round(100 * day.minutes
        .filter((m) => m.present !== null)
        .reduce((a, m) => a + (m.present! > 40 ? 1 : 0), 0)
        / Math.max(1, day.minutes.filter((m) => m.present !== null).length))
    : null;

  const runMin = (day.shift.m1 - day.shift.m0) - day.totals.break_min;
  const taktSpm = 60 / day.job.takt_sec;

  // run-out at the MEASURED cadence, not the planned takt
  const left = Math.max(0, target - strokesSoFar);
  const runOut = left > 0
    ? (() => {
        const at = t + (left / MEASURED_SPM) * 60;
        return { at, overruns: at > day.shift.m1 * 60 };
      })()
    : null;

  return (
    <Shell day={day}>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))" }}>
        {/* ---------------- current job + die match ---------------- */}
        <Card title="Current job" sub={`${day.job.process} · die ${day.job.die}`}
              right={<span className="flex items-center gap-1.5">
                       <Source from="plan" note="the job as scheduled" />
                     </span>}>
          <div className="flex flex-col gap-3">
            <Readout value={partLabel(day.job.part)} size={22} label="Part" />

            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 m-0">
              <JobStat label="Parts made so far" value={n0(strokesSoFar)}
                       sub={`of ${n0(target)}`} src="camera" />
              <JobStat label="Sheets in / out"
                       value={L.covered ? `${L.sheetIn} / ${L.sheetOut}`
                                        : `${day.totals.sheet_in} / ${day.totals.sheet_out}`}
                       sub={L.covered ? "live, this part" : "shift total"} src="camera" />
            </dl>

            {upNext && (
              <div className="flex flex-col gap-1 pt-2.5" style={{ borderTop: "1px solid var(--hair)" }}>
                <span className="text-[11px] text-[var(--muted)] flex items-center gap-1.5">
                  Next in plan <Source from="plan" />
                </span>
                <span className="text-[14px] font-[620]">
                  {partLabel(upNext.part)}
                  <span className="text-[var(--muted)] font-[400] text-[11px]"> · die {upNext.die}</span>
                </span>
                <span className="text-[11px] text-[var(--muted)] tnum">
                  {runOut
                    ? <>current job runs out {runOut.overruns
                        ? <b style={{ color: "var(--warning)" }}>past this shift</b>
                        : <>at <b>{hhmmss(runOut.at).slice(0, 5)}</b></>}
                      {" · "}{n0(Math.max(0, target - strokesSoFar))} left at {MEASURED_SPM} spm</>
                    : `${n0(upNext.qty)} pieces planned`}
                  {upNext.changeover_min > 0 && <> · +{upNext.changeover_min} min changeover</>}
                </span>
              </div>
            )}
          </div>
        </Card>

        {/* ---------------- the hero: one per view ---------------- */}
        <Card>
          <div className="flex flex-col items-center gap-2 py-1">
            {L.covered && L.dieChanging ? (
              <StatusPill severity="warning" dot>DIE CHANGE IN PROGRESS</StatusPill>
            ) : (
              <StatusPill severity={L.covered
                  ? (L.pressState !== 0 ? "ok" : "warning")
                  : (cur.s > 0 ? "ok" : cur.motor ? "warning" : "serious")} dot>
                {L.covered
                  ? ["IDLE — motor on", "RISING", "STILL — load window", "DESCENDING"][L.pressState]
                  : cur.s > 0 ? "RUNNING" : cur.motor ? "IDLE — motor on" : "STOPPED"}
              </StatusPill>
            )}
            <HeroFigure value={n0(strokesSoFar)} label="strokes"
                        sub={`of ${n0(target)} target`} />
            <div className="w-full h-[6px] rounded-full overflow-hidden" style={{ background: "var(--track)" }}>
              <div className="h-full rounded-full"
                   style={{ width: `${progress}%`, background: "var(--s1)",
                            transition: "width var(--t-slow) var(--e-out)" }} />
            </div>
            <span className="text-[11px] text-[var(--muted)] tnum">{pct(progress)} · {n0(Math.max(0, target - strokesSoFar))} to go</span>
          </div>
        </Card>

        {/* ---------------- operator ---------------- */}
        <Card title="Operator"
              right={<span className="flex items-center gap-1.5">
                       <Source from="camera" note="presence is a binary at a declared post — the detector box is never projected to floor coordinates" />
                       {cur.present === null ? <TrustChip trust="simulated" /> : <TrustChip trust="measured" />}
                     </span>}>
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2.5">
              <span aria-hidden className="w-[34px] h-[34px] rounded-full grid place-items-center text-[12px] font-[700]"
                    style={{ background: "var(--q600)", color: "#fff" }}>
                {day.operator.name.split(" ").map((s) => s[0]).join("").slice(0, 2)}
              </span>
              <span className="flex flex-col leading-tight">
                <span className="text-[13px] font-[600]">{day.operator.name}</span>
                <span className="text-[11px] text-[var(--muted)]">Shift {day.operator.shift}</span>
              </span>
            </div>
            {!L.covered ? (
              <p className="m-0 text-[11px] text-[var(--muted)]">
                No camera coverage at this time — presence unknown, not zero.
              </p>
            ) : L.operator ? (
              <StatusPill severity={L.operator.confirmed ? "ok" : "warning"} dot>
                {L.operator.confirmed ? "at station" : "at station (unconfirmed)"}
                {` · id${L.operator.tid}`}
              </StatusPill>
            ) : (
              <StatusPill severity="critical" dot>away from station</StatusPill>
            )}
            {/* sheet counts moved to the job card — they belong to the PART,
                not to the person. What belongs here is how much of the covered
                time this operator was actually at the press. */}
            <div className="pt-2 flex items-baseline justify-between gap-2"
                 style={{ borderTop: "1px solid var(--hair)" }}>
              <span className="text-[11px] text-[var(--muted)] flex items-center gap-1.5">
                At the press <Source from="camera" note="binary presence at a declared post, across the camera window" />
              </span>
              <span className="readout text-[15px]">
                {presencePct === null ? <span className="text-[var(--muted)] text-[11px]">no coverage</span>
                                      : `${presencePct}%`}
              </span>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-3 mt-3" style={{ gridTemplateColumns: "minmax(300px,2fr) auto minmax(260px,1fr)" }}>
        {/* ---------------- pace ---------------- */}
        <Card title="Pace" sub="strokes per minute · 60-second rolling window, last 12 minutes"
              right={<Source from="camera" note="stroke times measured from the footage at 40 ms" />}>
          <div className="flex items-baseline gap-4 mb-1 flex-wrap">
            <Readout value={(L.covered && L.sinceStroke > 6 ? 0 : cur.spm).toFixed(1)} unit="spm" size={32} />
            <span className="text-[11px] text-[var(--muted)]">
              takt {day.job.takt_sec}s = {(60 / day.job.takt_sec).toFixed(1)} spm ·
              {" "}measured median {MEASURED_SPM.toFixed(2)} spm
            </span>
          </div>
          {pace.v.some((v) => v > 0) ? (
            <LineChart height={230} x={pace.x}
              series={[{ key: "spm", label: "Actual spm", color: "var(--s1)", values: pace.v, area: true }]}
              rules={[
                { v: 60 / day.job.takt_sec, label: `takt ${(60 / day.job.takt_sec).toFixed(1)}` },
                { v: MEASURED_SPM, label: `median ${MEASURED_SPM.toFixed(2)}`, color: "var(--s3)" },
              ]}
              xFmt={(s) => hhmmss(s).slice(0, 5)} yFmt={(v) => v.toFixed(1)} />
          ) : (
            <Empty h={230} msg="no camera-measured strokes in the last 12 minutes at this cursor" />
          )}
        </Card>

        {/* ---------------- the slide instrument ---------------- */}
        <Card title="Slide" pad={false} right={<Source from="camera" note="the 25 Hz vy signal at the playhead" />}>
          <div className="px-4 pb-4 grid place-items-center">
            {/* real vy from the camera — this used to be Math.sin(t), which
                moved convincingly and meant absolutely nothing */}
            <SlidePosition vy={L.covered && L.frame ? L.frame.vy : 0}
                           state={L.covered ? L.pressState : 0} />
            <span className="text-[10px] text-[var(--muted)] mt-1">
              {L.covered
                ? ["parked", "rising", "still", "descending"][L.pressState]
                : "no camera coverage"}
            </span>
          </div>
        </Card>

        {/* ---------------- OEE: meters, not gauges ---------------- */}
        <Card title="This shift" sub="how OEE was arrived at"
              right={<Source from="calc" note="A from PLC run minutes, P from camera strokes against takt" />}>
          <div className="flex flex-col gap-3">
            <Meter label="Availability" value={day.oee.availability} />
            <p className="m-0 text-[10px] text-[var(--muted)] tnum -mt-1.5">
              ({n0(runMin)} run − {day.totals.downtime_min.toFixed(1)} down) ÷ {n0(runMin)} min
            </p>

            <Meter label="Performance" value={day.oee.performance} />
            <p className="m-0 text-[10px] text-[var(--muted)] tnum -mt-1.5">
              {n0(day.totals.strokes)} strokes ÷ {n0(day.totals.production_min)} min ÷ {taktSpm.toFixed(1)} spm
            </p>

            <div className="pt-2.5 flex items-baseline justify-between gap-2"
                 style={{ borderTop: "1px solid var(--hair)" }}>
              <span className="flex flex-col">
                <span className="text-[12px] text-[var(--ink-2)]">OEE</span>
                <span className="text-[10px] text-[var(--muted)] tnum">
                  {day.oee.availability}% × {day.oee.performance}% — A × P
                </span>
              </span>
              <span className="readout text-[22px]">{day.oee.oee.toFixed(1)}%</span>
            </div>
          </div>
        </Card>
      </div>

      {/* ---------------- the shift so far ---------------- */}
      <Card title="The shift so far" className="mt-3"
            sub="one bar per minute, coloured by what owned it"
            right={<Source from={["plc", "camera"]} note="run/stop from the PLC spine; causes from the reason engine" />}>
        <ShiftRibbon day={day} />
      </Card>

      {/* ---------------- active reason ---------------- */}
      <div className="mt-3">
        {active ? (
          <Card edge={active.cause === "unexplained" ? "critical" : "warning"} className="arrive">
            <button onClick={() => { setT(active.t0 + 1); openInspector(active.id); }}
                    className="w-full flex items-center gap-3 flex-wrap text-left">
              <span aria-hidden className="w-[10px] h-[10px] rounded-sm shrink-0"
                    style={{ background: CAUSE_COLOR[active.cause] }} />
              <span className="text-[13px] font-[650]">{active.label}</span>
              <span className="text-[11px] text-[var(--muted)]">
                {hhmmss(active.t0).slice(0, 5)} · {mins(active.cost.minutes)} ·
                {" "}{n0(active.cost.strokes)} strokes lost · {pkr(active.cost.pkr)} idle
              </span>
              <span className="ml-auto text-[11px] text-[var(--s1)]">why ▸</span>
            </button>
          </Card>
        ) : (
          <Card>
            <p className="m-0 text-[11px] text-[var(--muted)]">
              No stoppage at {hhmmss(t).slice(0, 5)}. Scrub the spine below to any moment of the day.
            </p>
          </Card>
        )}
      </div>
    </Shell>
  );
}
