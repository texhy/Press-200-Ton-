"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Day, Pulse } from "@/lib/types";
import { Assistant } from "@/components/assistant/Assistant";
import { useCursor, hhmmss } from "@/lib/cursor";
import { StrokePulse } from "@/components/instruments/StrokePulse";
import { StatusPill, TrustChip } from "@/components/ui";
import { CAUSE_COLOR, CAUSE_LABEL } from "@/lib/palette";
import { mins, pkr } from "@/lib/format";
import { loadPulse, useAsync } from "@/lib/data";

/* =========================================================== NAV RAIL ===
   Three groups of three. Badges ONLY for things needing a human decision —
   never for "new data". */
const NAV = [
  { group: "Monitor", items: [
    { href: "/",         label: "Floor",    icon: "⊞" },
    { href: "/live",     label: "Live",     icon: "◉" },
    { href: "/timeline", label: "Timeline", icon: "◷" },
    { href: "/camera",   label: "Camera",   icon: "▣" },
  ]},
  { group: "Analyze", items: [
    { href: "/downtime", label: "Downtime", icon: "◭" },
    { href: "/energy",   label: "Energy",   icon: "⌁" },
    { href: "/health",   label: "Health",   icon: "♡", badge: "zone" },
  ]},
  { group: "Plan", items: [
    { href: "/planner",  label: "Planner",  icon: "▦" },
    { href: "/reports",  label: "Reports",  icon: "▤" },
  ]},
];

function NavRail({ badges }: { badges: Record<string, number> }) {
  const path = usePathname();
  return (
    <nav className="group/rail fixed left-0 top-[var(--topbar-h)] bottom-0 z-30 flex flex-col
                    bg-[var(--surface)] border-r border-[var(--hair)]
                    w-[var(--rail-w)] hover:w-[var(--rail-w-open)] transition-[width] overflow-hidden
                    max-md:hidden"
         style={{ transitionDuration: "var(--t-base)", transitionTimingFunction: "var(--e-move)" }}>
      <div className="flex-1 overflow-y-auto py-3">
        {NAV.map((g) => (
          <div key={g.group} className="mb-3">
            <p className="px-4 pb-1 text-[9px] font-[700] tracking-[0.1em] text-[var(--muted)]
                          opacity-0 group-hover/rail:opacity-100 transition-opacity whitespace-nowrap">
              {g.group.toUpperCase()}
            </p>
            {g.items.map((it) => {
              const on = path === it.href;
              const n = it.badge ? badges[it.badge] ?? 0 : 0;
              return (
                <Link key={it.href} href={it.href}
                      className="relative flex items-center gap-3 h-[38px] px-4 whitespace-nowrap
                                 hover:bg-[var(--raised)] transition-colors"
                      style={{ background: on ? "var(--raised)" : undefined }}>
                  {on && <span aria-hidden className="absolute left-0 top-1 bottom-1 w-[2px] rounded-r"
                               style={{ background: "var(--s1)" }} />}
                  <span aria-hidden className="w-[14px] text-center text-[13px]"
                        style={{ color: on ? "var(--s1)" : "var(--muted)" }}>{it.icon}</span>
                  <span className="text-[12px] opacity-0 group-hover/rail:opacity-100 transition-opacity"
                        style={{ color: on ? "var(--ink)" : "var(--ink-2)" }}>{it.label}</span>
                  {n > 0 && (
                    <span className="ml-auto shrink-0 min-w-[16px] h-[16px] px-1 rounded-full text-[9px]
                                     font-[700] grid place-items-center"
                          style={{ background: "var(--critical)", color: "#fff" }}>{n}</span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
      <Link href="/operator"
            className="flex items-center gap-3 h-[42px] px-4 border-t border-[var(--hair)]
                       hover:bg-[var(--raised)] whitespace-nowrap">
        <span aria-hidden className="w-[14px] text-center text-[13px] text-[var(--muted)]">◐</span>
        <span className="text-[12px] text-[var(--ink-2)] opacity-0 group-hover/rail:opacity-100 transition-opacity">
          Operator view
        </span>
      </Link>
    </nav>
  );
}

/* ============================================================ TOP BAR === */
function TopBar({ day, pulse, live }: { day: Day | null; pulse: number[]; live: boolean }) {
  const { t, mode, goLive, playing, setPlaying, rate, setRate, setT } = useCursor();
  /* Initialise FROM the document, not from a hard-coded default — a literal
     useState("dark") stamps data-theme="dark" on mount and silently overrides
     both the server-rendered theme and the viewer's OS preference. */
  const [theme, setTheme] = useState<"dark" | "light" | null>(null);
  useEffect(() => {
    const stamped = document.documentElement.dataset.theme as "dark" | "light" | undefined;
    setTheme(stamped ?? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"));
  }, []);
  useEffect(() => { if (theme) document.documentElement.dataset.theme = theme; }, [theme]);

  const cur = day?.minutes[Math.floor(t / 60)];
  const status = !day ? "info" : cur?.fault ? "critical"
    : cur?.die ? "warning" : (cur?.s ?? 0) > 0 ? "ok" : cur?.motor ? "warning" : "serious";
  const statusText = !day ? "loading" : cur?.fault ? "FAULT"
    : cur?.die ? "DIE CHANGE" : (cur?.s ?? 0) > 0 ? "RUNNING" : cur?.motor ? "IDLE" : "STOPPED";

  return (
    <header className="fixed top-0 left-0 right-0 z-40 h-[var(--topbar-h)] flex items-center gap-5 px-4
                       bg-[var(--surface)] border-b border-[var(--hair)]">
      <Link href="/" className="flex items-center gap-2.5 shrink-0">
        <span aria-hidden className="text-[15px]" style={{ color: "var(--s1)" }}>◆</span>
        <span className="flex flex-col leading-tight">
          <span className="text-[12px] font-[700] tracking-[0.06em]">BYTEAIRO</span>
          <span className="text-[9px] text-[var(--muted)]">PRESS 200 · 200 T MECH</span>
        </span>
      </Link>

      {/* the machine's heartbeat — on every screen, always */}
      <div className="hidden sm:flex flex-col items-start shrink-0">
        <StrokePulse values={pulse} live={live} />
        <span className="text-[9px] text-[var(--muted)] -mt-0.5">stroke signal</span>
      </div>

      <div className="flex items-center gap-4 shrink-0">
        <StatusPill severity={status as never} dot>{statusText}</StatusPill>
        <span className="flex flex-col leading-none">
          <span className="readout text-[18px]">{hhmmss(t)}</span>
          <span className="text-[9px] text-[var(--muted)] mt-0.5">
            {day?.shift.label ?? "—"}{mode === "scrub" ? " · ⟲ SCRUBBING" : ""}
          </span>
        </span>
        {cur && (
          <span className="hidden lg:flex items-center gap-3 text-[11px] text-[var(--muted)]">
            <span className="readout text-[13px] text-[var(--ink-2)]">{cur.spm.toFixed(0)}</span> spm
            <span className="readout text-[13px] text-[var(--ink-2)]">{cur.kw.toFixed(1)}</span> kW
          </span>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2 shrink-0">
        <span className="hidden xl:inline"><TrustChip trust="simulated" what="PLC/VFD" /></span>
        <span className="hidden xl:inline"><TrustChip trust="measured" what="Camera" /></span>
        {/* One transport for the whole dashboard — every screen runs off it,
            including the ones with no video. */}
        <button onClick={() => {
                  if (!day) return;
                  if (!playing && (t < day.camera.start_min * 60 || t >= day.camera.end_min * 60)) {
                    setT(day.camera.start_min * 60 + 1);   // start where there is truth
                  }
                  setPlaying(!playing);
                }}
                aria-label={playing ? "Pause" : "Play"}
                className="h-[28px] px-3 rounded-[var(--r-ctl)] text-[11px] font-[650] flex items-center gap-1.5"
                style={{ background: playing ? "var(--s2)" : "var(--s1)", color: "#fff" }}>
          {playing ? "❚❚ Pause" : "▶ Play"}
        </button>
        <span className="hidden sm:flex items-center gap-0.5">
          {[1, 4, 16, 60].map((r) => (
            <button key={r} onClick={() => setRate(r)}
                    className="h-[26px] px-1.5 rounded-[var(--r-ctl)] text-[10px] border"
                    style={{ borderColor: rate === r ? "var(--s1)" : "var(--hair-strong)",
                             color: rate === r ? "var(--s1)" : "var(--muted)" }}>
              {r}×
            </button>
          ))}
        </span>
        <button onClick={() => day && goLive(day.camera.start_min * 60 + 30)}
                className="h-[26px] px-2.5 rounded-[var(--r-ctl)] text-[11px] border border-[var(--hair-strong)]
                           hover:bg-[var(--raised)] hidden lg:block"
                style={{ color: mode === "live" ? "var(--s1)" : "var(--ink-2)" }}>
          ⟲ Camera
        </button>
        <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
                className="w-[26px] h-[26px] rounded-[var(--r-ctl)] text-[12px] border border-[var(--hair-strong)]
                           hover:bg-[var(--raised)] text-[var(--ink-2)]">
          {theme === "dark" ? "☀" : "☾"}
        </button>
        <span className="hidden sm:flex items-center gap-1.5 pl-2 ml-1 border-l border-[var(--hair)]">
          <span aria-hidden className="w-[22px] h-[22px] rounded-full grid place-items-center text-[10px] font-[700]"
                style={{ background: "var(--q600)", color: "#fff" }}>
            {(day?.operator.name ?? "?").split(" ").map((s) => s[0]).join("").slice(0, 2)}
          </span>
          <span className="text-[11px] text-[var(--ink-2)] hidden lg:inline">{day?.operator.name ?? "—"}</span>
        </span>
      </div>
    </header>
  );
}

/* ========================================================= TIME SPINE ===
   The anchor. Always visible, always the same time context. Content fades
   around it on route change; the spine itself never moves. */
function TimeSpine({ day }: { day: Day | null }) {
  const { t, setT, openInspector } = useCursor();
  if (!day) return null;
  const { m0, m1 } = day.shift;
  const span = (m1 - m0) * 60;
  const frac = (s: number) => Math.max(0, Math.min(1, (s - m0 * 60) / span));

  const prev = [...day.gaps].reverse().find((g) => g.t1 <= t);
  const next = day.gaps.find((g) => g.t0 > t);

  return (
    <footer className="fixed bottom-0 left-0 right-0 z-40 h-[var(--spine-h)]
                       bg-[var(--surface)] border-t border-[var(--hair)]
                       pl-[var(--rail-w)] max-md:pl-0">
      <div className="h-full px-4 py-1.5 flex flex-col justify-center gap-1">
        <div className="flex items-center justify-between text-[9px] text-[var(--muted)] tnum">
          {Array.from({ length: 6 }, (_, i) => m0 + ((m1 - m0) / 5) * i).map((m) => (
            <span key={m}>{hhmmss(m * 60).slice(0, 5)}</span>
          ))}
        </div>
        <div className="relative h-[12px] rounded-[2px] overflow-hidden cursor-crosshair"
             style={{ background: "var(--grid)" }}
             onPointerDown={(e) => {
               const r = e.currentTarget.getBoundingClientRect();
               const s = m0 * 60 + ((e.clientX - r.left) / r.width) * span;
               setT(s);
               const g = day.gaps.find((x) => s >= x.t0 && s < x.t1);
               openInspector(g ? g.id : null);
             }}>
          {day.gaps.map((g) => (
            <span key={g.id} className="absolute top-0 bottom-0" title={CAUSE_LABEL[g.cause]}
                  style={{ left: `${frac(g.t0) * 100}%`, width: `${Math.max(0.15, (frac(g.t1) - frac(g.t0)) * 100)}%`,
                           background: CAUSE_COLOR[g.cause] }} />
          ))}
          {/* camera coverage: an aqua underline, so you always know where truth is */}
          <span className="absolute bottom-0 h-[2px]"
                style={{ left: `${frac(day.camera.start_min * 60) * 100}%`,
                         width: `${Math.max(0.3, (frac(day.camera.end_min * 60) - frac(day.camera.start_min * 60)) * 100)}%`,
                         background: "var(--s3)" }} />
          <span aria-hidden className="absolute top-0 bottom-0 w-[2px]"
                style={{ left: `${frac(t) * 100}%`, background: "var(--ink)" }} />
        </div>
        <div className="flex items-center gap-3 text-[10px] text-[var(--muted)]">
          <span className="flex items-center gap-1">
            <button disabled={!prev} onClick={() => prev && setT(prev.t0 + 1)}
                    className="px-1 disabled:opacity-30 hover:text-[var(--ink)]">◀</button>
            events
            <button disabled={!next} onClick={() => next && setT(next.t0 + 1)}
                    className="px-1 disabled:opacity-30 hover:text-[var(--ink)]">▶</button>
          </span>
          <span>camera {hhmmss(day.camera.start_min * 60).slice(0, 5)}–{hhmmss(day.camera.end_min * 60).slice(0, 5)}</span>
          <span className="ml-auto flex items-center gap-3">
            <span>{mins(day.totals.downtime_min)} lost</span>
            <span style={{ color: "var(--s2)" }}>{pkr(day.totals.idle_pkr)} idle</span>
          </span>
        </div>
      </div>
    </footer>
  );
}

/* ====================================================== MOBILE TAB BAR === */
function Tabs() {
  const path = usePathname();
  const items = NAV.flatMap((g) => g.items);
  return (
    <nav className="md:hidden fixed left-0 right-0 bottom-[var(--spine-h)] z-40 h-[46px] flex
                    bg-[var(--surface)] border-t border-[var(--hair)] overflow-x-auto">
      {items.map((it) => (
        <Link key={it.href} href={it.href}
              className="flex-1 min-w-[58px] grid place-items-center text-[16px]"
              style={{ color: path === it.href ? "var(--s1)" : "var(--muted)" }}>
          <span aria-hidden>{it.icon}</span>
        </Link>
      ))}
    </nav>
  );
}

/* ============================================================== SHELL === */
export function Shell({ day, children, wide }: {
  day: Day | null; children: React.ReactNode; wide?: boolean;
}) {
  const { t, playing, tick } = useCursor();

  /* The clock. One rAF loop for the whole app; every screen reads `t`. */
  /* Dev-only handle on the clock. Everything on every screen is a function of
     this one store, so without a way to set it from outside, verifying any
     time-dependent behaviour means waiting real minutes for the playhead to
     reach the interesting part of the recording. Stripped from production. */
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    (window as unknown as Record<string, unknown>).__cursor = useCursor;
  }, []);

  useEffect(() => {
    if (!playing || !day) return;
    const limit = day.shift.m1 * 60;
    let raf = 0;
    let prev = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.25, (now - prev) / 1000);   // clamp after a tab switch
      prev = now;
      tick(dt, limit);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, day, tick]);

  /* The pulse shows the REAL slide signal at the playhead. It used to be a
     synthetic sine wave keyed off the stroke count, which looked alive and
     meant nothing — the one thing this instrument must not do. */
  const { data: pulseData } = useAsync(loadPulse);
  const { pulse, camLive } = useMemo(() => {
    if (!day || !pulseData) return { pulse: [] as number[], camLive: false };
    const vt = t - day.camera.start_min * 60;
    if (vt < 0 || vt > pulseData.video_s) return { pulse: [], camLive: false };
    const i = Math.min(pulseData.vy.length - 1, Math.round(vt * pulseData.hz));
    // 18 SECONDS of signal, not 90 samples. The complete run is written at the
    // native 25 Hz instead of the old 5 Hz, so a fixed 90-sample window silently
    // shrank from 18 s to 3.6 s — less than half a stroke, which looked like a
    // flatline on a press that was running. Window by time, never by index.
    const win = pulseData.vy.slice(Math.max(0, i - Math.round(18 * pulseData.hz)), i + 1);
    // stroking if the camera's counter moved in the last ~4 s
    const back = Math.max(0, i - Math.round(4 * pulseData.hz));
    return { pulse: win, camLive: (pulseData.c[i] ?? 0) > (pulseData.c[back] ?? 0) };
  }, [day, pulseData, t]);

  const cur = day?.minutes[Math.floor(t / 60)];
  // inside camera coverage the camera decides; outside it, the (simulated) spine does
  const live = pulse.length > 0 ? camLive : !!cur && cur.s > 0;

  const badges = useMemo((): Record<string, number> => {
    if (!day) return {};
    return { zone: 0 };
  }, [day]);

  return (
    <>
      <TopBar day={day} pulse={pulse} live={live} />
      <NavRail badges={badges} />
      <main className="pt-[var(--topbar-h)] pb-[calc(var(--spine-h)+8px)] max-md:pb-[calc(var(--spine-h)+54px)]
                       pl-[var(--rail-w)] max-md:pl-0 min-h-screen">
        <div className={`mx-auto px-4 py-4 ${wide ? "max-w-none" : "max-w-[1680px]"}`}
             style={{ animation: "fadeIn var(--t-fast) var(--e-out) both" }}>
          {children}
        </div>
      </main>
      <Tabs />
      <TimeSpine day={day} />
      <Assistant />
      <style>{`@keyframes fadeIn{from{opacity:0}to{opacity:1}}`}</style>
    </>
  );
}
