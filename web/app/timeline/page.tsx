"use client";
import { useRef, useState, useCallback, useEffect } from "react";
import { Shell } from "@/components/shell/Shell";
import { Inspector } from "@/components/shell/Inspector";
import { Card, StatusPill } from "@/components/ui";
import { LaneTimeline } from "@/components/instruments/LaneTimeline";
import { VideoOverlay, DEFAULT_LAYERS } from "@/components/instruments/VideoOverlay";
import { loadDay, loadCv, useAsync } from "@/lib/data";
import { useVideoFollower } from "@/lib/cvlive";
import { useCursor, hhmmss } from "@/lib/cursor";
import type { Day } from "@/lib/types";

const ZOOMS: [string, number][] = [
  ["day", 24 * 3600], ["shift", 8.5 * 3600], ["1h", 3600],
  ["10m", 600], ["1m", 60], ["10s", 10],
];

export default function TimelinePage() {
  const { data: day } = useAsync(loadDay);
  const { data: cv } = useAsync(loadCv);
  const { t, span, setSpan, setT, openInspector, playing, setPlaying, rate } = useCursor();
  const vid = useRef<HTMLVideoElement | null>(null);
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());


  /* The cursor is the clock (see lib/cursor.ts); the video follows it. */
  const camT0 = day ? day.camera.start_min * 60 : 0;
  const camT1 = day ? day.camera.end_min * 60 : 0;
  useVideoFollower(vid, day, t, playing, rate, setT);

  const togglePlay = useCallback(() => {
    if (!day) return;
    if (!playing && (t < camT0 || t >= camT1)) setT(camT0 + 1);
    setPlaying(!playing);
  }, [day, playing, t, camT0, camT1, setT, setPlaying]);

  /* keyboard: arrows step, j/k jump event to event, space plays */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!day) return;
      const tgt = e.target as HTMLElement;
      if (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA") return;
      const step = span / 120;
      if (e.key === "ArrowLeft") { setT(t - step); e.preventDefault(); }
      if (e.key === "ArrowRight") { setT(t + step); e.preventDefault(); }
      if (e.key === "j") {
        const p = [...day.gaps].reverse().find((g) => g.t1 <= t);
        if (p) { setT(p.t0 + 1); openInspector(p.id); }
      }
      if (e.key === "k") {
        const n = day.gaps.find((g) => g.t0 > t);
        if (n) { setT(n.t0 + 1); openInspector(n.id); }
      }
      if (e.key === " ") { togglePlay(); e.preventDefault(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [day, t, span, setT, openInspector, togglePlay]);

  if (!day) return <Shell day={null}><Card title="Loading…" /></Shell>;

  const covered = t >= day.camera.start_min * 60 && t < day.camera.end_min * 60;

  return (
    <Shell day={day} wide>
      <div className="grid gap-3" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(290px,340px)" }}>
        <div className="flex flex-col gap-3 min-w-0">
          <Card title="The day, on ten lanes"
                sub="Click to seek · scroll to zoom · drag to pan · ←→ step · j/k event to event"
                right={
                  <span className="flex gap-1">
                    {ZOOMS.map(([l, s]) => (
                      <button key={l} onClick={() => setSpan(s)}
                              className="px-1.5 h-[20px] rounded text-[10px] border"
                              style={{ borderColor: Math.abs(span - s) < 1 ? "var(--s1)" : "var(--hair)",
                                       color: Math.abs(span - s) < 1 ? "var(--s1)" : "var(--muted)" }}>
                        {l}
                      </button>
                    ))}
                  </span>
                }>
            <LaneTimeline day={day} />
          </Card>

          <Card title="Camera" pad={false}
                sub={covered ? `seeked to ${hhmmss(t)}` : "no camera coverage at this time"}
                right={covered
                  ? <StatusPill severity="ok">MEASURED</StatusPill>
                  : <StatusPill severity="warning">NO COVERAGE</StatusPill>}>
            <div className="px-4 pb-4">
              <div className="relative w-full bg-black rounded-[var(--r-ctl)] overflow-hidden"
                   style={{ aspectRatio: "16/9", opacity: covered ? 1 : 0.35 }}>
                <video ref={vid} src={day.camera.video_url} muted playsInline preload="auto"
                       poster="/videos/press200_poster.jpg"
                       className="absolute inset-0 w-full h-full object-contain" />
                {cv && <VideoOverlay cv={cv} video={vid} layers={DEFAULT_LAYERS} />}
              </div>
              <div className="flex items-center gap-2 mt-2">
                {/* Play is the primary control and is labelled as such. The
                    step buttons say how far they step — a bare "▶" beside a
                    "◀" reads as play, which is exactly how it was misread. */}
                <button onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}
                        className="h-[28px] px-3.5 rounded text-[12px] font-[600] flex items-center gap-1.5"
                        style={{ background: "var(--s1)", color: "#fff" }}>
                  {playing ? "❚❚ Pause" : "▶ Play"}
                </button>
                {([["−10s", -10], ["−1s", -1], ["+1s", 1], ["+10s", 10]] as [string, number][]).map(([l, d]) => (
                  <button key={l} onClick={() => setT(t + d)}
                          className="h-[26px] px-2 rounded text-[11px] border border-[var(--hair-strong)]
                                     text-[var(--ink-2)] hover:bg-[var(--raised)]">{l}</button>
                ))}
                <span className="text-[10px] text-[var(--muted)] ml-1">
                  speed is set in the top bar
                </span>
                <span className="ml-auto text-[10px] text-[var(--muted)]">
                  space = play/pause · overlays interpolated 5 Hz → 25 fps
                </span>
              </div>
            </div>
          </Card>
        </div>

        <Inspector day={{ ...day, gaps: day.gaps.map((g) => ({ ...g, confirmed: confirmed.has(g.id) })) } as Day}
                   onSeek={(vs) => { if (vid.current) vid.current.currentTime = vs; }}
                   onConfirm={(id) => setConfirmed((s) => new Set(s).add(id))} />
      </div>
    </Shell>
  );
}
