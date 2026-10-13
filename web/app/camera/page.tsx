"use client";
import { useRef, useState, useMemo, useEffect } from "react";
import { Shell } from "@/components/shell/Shell";
import { Card, StatusPill, StatTile, TrustChip, Legend, TableView, Reveal } from "@/components/ui";
import { LineChart, Histogram, Empty } from "@/components/charts";
import { VideoOverlay, DEFAULT_LAYERS, type Layers } from "@/components/instruments/VideoOverlay";
import { loadDay, loadCv, useAsync } from "@/lib/data";
import { useCvLive, useVideoFollower } from "@/lib/cvlive";
import { useCursor, hhmmss } from "@/lib/cursor";
import { n0, partLabel, secs } from "@/lib/format";

interface DieEp {
  start?: string; end?: string; start_s?: number; duration_s?: number;
  trigger?: string; plate_changed_at?: string; plate_changed_at_s?: number | null;
  forklift_times_s?: number[]; strokes_while_open?: number;
}

const LAYER_LABEL: Record<keyof Layers, string> = {
  worker: "Operator box", people: "Other people", wrists: "Wrists", parts: "Part boxes",
  motion: "Motion dots", rois: "Stroke ROI", sheets: "Sheet events", die: "Die zone",
  stack: "Steel stack", state: "State readout", stock: "Stock tray",
};

export default function CameraPage() {
  const { data: day } = useAsync(loadDay);
  const { data: cv } = useAsync(loadCv);
  const vid = useRef<HTMLVideoElement | null>(null);
  const [layers, setLayers] = useState<Layers>(DEFAULT_LAYERS);
  const [vt, setVt] = useState(0);
  const { t, setT, playing, rate } = useCursor();
  // the cursor is the clock; this video follows it, and a scrub of the native
  // controls pushes back into the cursor so the two never disagree
  useVideoFollower(vid, day ?? null, t, playing, rate, setT);
  const L = useCvLive(cv ?? null, day ?? null, t);

  const strokes = day?.strokes ?? [];
  const periods = useMemo(() => strokes.map((s) => s.period).filter((p): p is number => !!p), [strokes]);
  const median = periods.length ? [...periods].sort((a, b) => a - b)[Math.floor(periods.length / 2)] : null;
  /* An interval far above the median is a STOPPAGE, not a stroke period. Left
     in, one 132 s gap flattens the whole rhythm trace. They are excluded here
     and counted in the caption — the stoppages themselves live on the
     timeline, where they are classified. */
  const RHYTHM_CAP = median ? median * 3 : Infinity;
  const rhythm = useMemo(() => strokes.filter((s) => s.period && s.period <= RHYTHM_CAP), [strokes, RHYTHM_CAP]);
  const nStops = strokes.filter((s) => s.period && s.period > RHYTHM_CAP).length;

  // the stroke nearest the playhead, for the deviation callout
  const nearest = useMemo(() => {
    if (!day || !strokes.length) return null;
    const clock = day.camera.start_min * 60 + vt;
    return strokes.reduce((b, s) => Math.abs(s.t - clock) < Math.abs(b.t - clock) ? s : b, strokes[0]);
  }, [day, strokes, vt]);

  if (!day) return <Shell day={null}><Card title="Loading…" /></Shell>;

  const frame = cv?.frames.find((f) => f.t >= vt) ?? cv?.frames[cv.frames.length - 1];
  const seenPart = frame?.d[0]?.[0] ?? null;
  const mismatch = seenPart && seenPart !== day.job.part;

  return (
    <Shell day={day} wide>
      <div className="grid gap-3" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(250px,300px)" }}>
        <div className="flex flex-col gap-3 min-w-0">
          <Card title="Press 200 — AI vision" pad={false}
                sub={`${day.camera.anchor === "assumed" ? "time assumed" : "time confirmed"} · ${day.camera.native[0]}×${day.camera.native[1]} @ ${cv?.fps ?? 25} fps`}
                right={<StatusPill severity="ok">CAMERA — MEASURED</StatusPill>}>
            <div className="px-4 pb-4">
              <div className="relative w-full bg-black rounded-[var(--r-ctl)] overflow-hidden"
                   style={{ aspectRatio: `${day.camera.native[0]}/${day.camera.native[1]}` }}>
                <video ref={vid} src={day.camera.video_url} controls muted playsInline preload="metadata"
                       poster="/videos/press200_poster.jpg"
                       onTimeUpdate={(e) => setVt((e.target as HTMLVideoElement).currentTime)}
                       className="absolute inset-0 w-full h-full object-contain" />
                {cv
                  ? <VideoOverlay cv={cv} video={vid} layers={layers} onTime={setVt} />
                  : null}
              </div>
              {!cv && <p className="text-[11px] text-[var(--muted)] mt-2">loading overlay data…</p>}
              {cv && !cv.complete && (
                <p className="text-[11px] mt-2" style={{ color: "var(--warning)" }}>
                  ▲ Overlay data covers the first {secs(cv.totals.seconds)} — the CV pass over the
                  full 53-minute recording is still running. Re-run the pipeline when it finishes.
                </p>
              )}
            </div>
          </Card>

          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))" }}>
            <Card title="Per-stroke period" sub="measured at 40 ms from the camera — the HMI polls at ~200 ms">
              {periods.length ? (
                <>
                  <div className="flex items-baseline gap-4 mb-2">
                    <StatTile label="Median period" value={median!.toFixed(2)} unit="s" />
                    <StatTile label="Equivalent" value={(60 / median!).toFixed(1)} unit="spm" />
                    <StatTile label="Strokes measured" value={n0(strokes.length)} />
                  </div>
                  <LineChart height={130} x={rhythm.map((s) => s.t)}
                    series={[{ key: "p", label: "Stroke period", color: "var(--s1)", values: rhythm.map((s) => s.period ?? 0) }]}
                    xFmt={(s) => hhmmss(s).slice(0, 5)} yFmt={(v) => `${v.toFixed(1)}s`} />
                  {nStops > 0 && (
                    <p className="m-0 mt-1 text-[10px] text-[var(--muted)]">
                      {nStops} interval{nStops > 1 ? "s" : ""} above {RHYTHM_CAP.toFixed(0)}s excluded —
                      those are stoppages, not stroke periods. They are classified on the Timeline.
                    </p>
                  )}
                  {nearest && median && (
                    <p className="m-0 mt-2 text-[11px]"
                       style={{ color: Math.abs((nearest.period ?? median) - median) > median * 0.15 ? "var(--warning)" : "var(--muted)" }}>
                      ⓘ stroke #{nearest.i} at {hhmmss(nearest.t).slice(0, 5)}:
                      {" "}{((nearest.period ?? median) - median >= 0 ? "+" : "")}
                      {(((nearest.period ?? median) - median)).toFixed(2)}s vs median
                      {" "}· down {nearest.down_ms}ms · up {nearest.up_ms ?? "—"}ms · dwell {nearest.dwell_ms}ms
                    </p>
                  )}
                </>
              ) : <Empty msg="no strokes measured in the processed window yet" />}
            </Card>

            <Card title="Down / up split" sub="what the PLC tap cannot give you">
              {rhythm.length ? (
                <>
                  <LineChart height={130} x={rhythm.map((s) => s.t)}
                    series={[
                      { key: "dn", label: "Down-stroke", color: "var(--s1)", values: rhythm.map((s) => s.down_ms) },
                      { key: "up", label: "Up-stroke", color: "var(--s2)", values: rhythm.map((s) => s.up_ms ?? 0) },
                      { key: "dw", label: "Dwell", color: "var(--s3)", values: rhythm.map((s) => s.dwell_ms) },
                    ]}
                    xFmt={(s) => hhmmss(s).slice(0, 5)} yFmt={(v) => `${v.toFixed(0)}ms`} />
                  <p className="m-0 mt-1 text-[10px] text-[var(--muted)]">
                    Rising up-stroke is the brake dragging — weeks of warning before it fails.
                  </p>
                </>
              ) : <Empty msg="no strokes yet" />}
            </Card>
          </div>

          <Card title="Stroke period distribution" sub="tight cluster = stable rhythm">
            {rhythm.length > 3
              ? <Histogram values={rhythm.map((s) => s.period!)} unit="s" height={140} />
              : <Empty msg="need more strokes for a distribution" />}
          </Card>

          <Card title="All measured strokes" pad={false}>
            <div className="px-4 pb-4 max-h-[280px] overflow-y-auto">
              <TableView
                cols={["#", "Clock", "Period", "SPM", "Down", "Up", "Dwell", "Part"]}
                rows={strokes.slice(0, 200).map((s) => [
                  s.i, hhmmss(s.t), s.period ? `${s.period.toFixed(2)}s` : "—",
                  s.spm ? s.spm.toFixed(1) : "—", `${s.down_ms}ms`,
                  s.up_ms ? `${s.up_ms}ms` : "—", `${s.dwell_ms}ms`, partLabel(s.part),
                ])}
                caption="Every chart on this screen has this table twin — nothing is gated behind a hover."
              />
            </div>
          </Card>
        </div>

        {/* ------------------------- side rail ------------------------- */}
        <div className="flex flex-col gap-3 min-w-0">
          <Card title="Layers">
            <div className="grid grid-cols-1 gap-1.5">
              {(Object.keys(LAYER_LABEL) as (keyof Layers)[]).map((k) => (
                <label key={k} className="flex items-center gap-2 text-[11px] cursor-pointer select-none">
                  <input type="checkbox" checked={layers[k]}
                         onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })}
                         className="accent-[var(--s1)]" />
                  <span className="text-[var(--ink-2)]">{LAYER_LABEL[k]}</span>
                </label>
              ))}
            </div>
            <p className="m-0 mt-2.5 text-[10px] text-[var(--muted)] leading-snug">
              Overlays are drawn client-side, so layers toggle, text stays crisp at any
              zoom, and boxes land on the full-resolution frame.
            </p>
          </Card>

          <Card title="Die / job match" edge={mismatch ? "critical" : undefined}>
            <div className="flex flex-col gap-2">
              <StatusPill severity={!seenPart ? "info" : mismatch ? "critical" : "ok"}>
                {!seenPart ? "NO PART IN FRAME" : mismatch ? "DIE MISMATCH" : "MATCHES PLAN"}
              </StatusPill>
              <dl className="grid grid-cols-2 gap-1 m-0 text-[11px]">
                <dt className="text-[var(--muted)] m-0">Camera sees</dt>
                <dd className="m-0 text-right">{partLabel(seenPart)}</dd>
                <dt className="text-[var(--muted)] m-0">Plan says</dt>
                <dd className="m-0 text-right">{partLabel(day.job.part)}</dd>
              </dl>
              <p className="m-0 text-[10px] text-[var(--muted)] leading-snug">
                The detector knows the operation, so a wrong die shows up in the first
                30 seconds instead of at QC. Nobody else has this signal.
              </p>
            </div>
          </Card>

          <Card title="Counted by the camera">
            <div className="flex flex-col gap-2.5">
              <StatTile label="Strokes" value={n0(cv?.totals.strokes ?? 0)} />
              <StatTile label="Sheets in / out" value={`${cv?.totals.sheet_in ?? 0} / ${cv?.totals.sheet_out ?? 0}`} />
              <div className="p-2 rounded-[var(--r-ctl)] text-[10px] leading-snug"
                   style={{ background: "color-mix(in oklab, var(--warning) 10%, transparent)",
                            border: "1px solid color-mix(in oklab, var(--warning) 28%, transparent)",
                            color: "var(--ink-2)" }}>
                ▲ IN and OUT counts are <b>asymmetric</b> by measurement. Parts are reported
                as an estimate — <b>min(IN, OUT)</b> per press window — never as a hard tally.
              </div>
              <Reveal label="Classes the detector knows">
                <ul className="m-0 pl-4 text-[10px] text-[var(--muted)]">
                  {(cv?.classes ?? []).map((c) => <li key={c}>{partLabel(c)} <span className="opacity-60">({c})</span></li>)}
                </ul>
              </Reveal>
            </div>
          </Card>

          <Card title="Die change" edge={L.dieChanging ? "warning" : undefined}>
            {cv?.die_changes?.length ? (
              <ul className="list-none m-0 p-0 flex flex-col gap-3">
                {(cv.die_changes as unknown as DieEp[]).map((d, i) => (
                  <li key={i} className="flex flex-col gap-1.5">
                    <span className="flex items-center gap-2 flex-wrap">
                      <StatusPill severity="warning">DIE CHANGE</StatusPill>
                      <span className="readout text-[13px]">
                        {Math.round((d.duration_s ?? 0) / 60)} min
                      </span>
                    </span>
                    <dl className="grid grid-cols-2 gap-x-2 gap-y-1 m-0 text-[11px]">
                      <dt className="text-[var(--muted)] m-0">Window</dt>
                      <dd className="m-0 text-right readout">{d.start}–{d.end}</dd>
                      <dt className="text-[var(--muted)] m-0">Detected by</dt>
                      <dd className="m-0 text-right">{d.trigger}</dd>
                      <dt className="text-[var(--muted)] m-0">Plate changed</dt>
                      <dd className="m-0 text-right readout">{d.plate_changed_at ?? "—"}</dd>
                      <dt className="text-[var(--muted)] m-0">Forklift seen</dt>
                      <dd className="m-0 text-right">{(d.forklift_times_s ?? []).length}×</dd>
                      <dt className="text-[var(--muted)] m-0">Jog strokes</dt>
                      <dd className="m-0 text-right">{d.strokes_while_open ?? 0}</dd>
                    </dl>
                    <div className="flex gap-1.5 flex-wrap">
                      <button onClick={() => { if (vid.current) vid.current.currentTime = d.start_s ?? 0; }}
                              className="text-[10px] px-1.5 py-[2px] rounded border border-[var(--hair-strong)]
                                         text-[var(--s3)] hover:bg-[var(--raised)]">▣ start</button>
                      {d.plate_changed_at_s != null && (
                        <button onClick={() => { if (vid.current) vid.current.currentTime = d.plate_changed_at_s!; }}
                                className="text-[10px] px-1.5 py-[2px] rounded border border-[var(--hair-strong)]
                                           text-[var(--s3)] hover:bg-[var(--raised)]">▣ plate change</button>
                      )}
                      {(d.forklift_times_s ?? []).slice(0, 3).map((ft) => (
                        <button key={ft} onClick={() => { if (vid.current) vid.current.currentTime = ft; }}
                                className="text-[10px] px-1.5 py-[2px] rounded border border-[var(--hair-strong)]
                                           text-[var(--muted)] hover:bg-[var(--raised)]">
                          ▣ forklift {Math.floor(ft / 60)}:{String(Math.round(ft % 60)).padStart(2, "0")}
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 text-[11px] text-[var(--muted)]">
                No closed episode. One needs sustained idle plus a forklift flag or a
                visibly changed bolster plate.
              </p>
            )}
          </Card>
        </div>
      </div>
    </Shell>
  );
}
