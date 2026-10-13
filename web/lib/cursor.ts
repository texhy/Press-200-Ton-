"use client";
import { create } from "zustand";

/** The single time context the whole app shares.
 *
 *  Principle 2 of the design: ONE TIME, EVERYWHERE. Every chart, lane, video
 *  and readout subscribes here. Hovering a Pareto bar moves the timeline;
 *  clicking the timeline seeks the video. Nothing keeps its own clock. */

export type Mode = "live" | "scrub";

/** ONE CLOCK.
 *
 *  Playback is owned by the cursor store, not by a <video> element. Every
 *  screen — including the ones with no video on them — advances off this, so
 *  pressing play makes the whole dashboard move. Video elements are pure
 *  FOLLOWERS: they play for smooth decode and get nudged back only when they
 *  drift from the cursor. Letting the video own the clock would mean the five
 *  screens without a video could never animate. */

interface CursorState {
  /** seconds of day, 0..86399 */
  t: number;
  mode: Mode;
  /** the entity under the pointer — drives cross-panel highlight (animation #6) */
  hovered: string | null;
  /** set while the pointer is inside a chart, so lanes show a crosshair */
  hoverT: number | null;
  /** zoom span of the timeline in seconds */
  span: number;
  /** which gap the inspector is showing */
  openGap: string | null;
  /** real-time playback of the whole dashboard */
  playing: boolean;
  rate: number;

  setT: (t: number, mode?: Mode) => void;
  setHovered: (k: string | null) => void;
  setHoverT: (t: number | null) => void;
  setSpan: (s: number) => void;
  openInspector: (id: string | null) => void;
  goLive: (now: number) => void;
  setPlaying: (p: boolean) => void;
  setRate: (r: number) => void;
  /** advance the clock by dt seconds of wall time */
  tick: (dt: number, limit: number) => void;
}

export const useCursor = create<CursorState>((set) => ({
  // open inside the camera-covered window so the first thing seen is MEASURED
  /* 09:40:00 — inside the post-changeover production run.
     This used to open at 09:13:30, which is 90 seconds into a 21-minute DIE
     CHANGE: every screen loaded with 0 spm, 0 kW, a parked slide and an empty
     pace chart. All of it correct, and all of it looking like a dead app. The
     die change is still the headline story and is one click away on the
     spine; the front door should show the machine working. */
  t: 9 * 3600 + 40 * 60,
  mode: "scrub",
  hovered: null,
  hoverT: null,
  span: 8.5 * 3600,   // the shift, not the whole empty day
  openGap: null,
  playing: false,
  rate: 1,

  setT: (t, mode = "scrub") => set({ t: Math.max(0, Math.min(86399, t)), mode }),
  setHovered: (hovered) => set({ hovered }),
  setHoverT: (hoverT) => set({ hoverT }),
  setSpan: (span) => set({ span: Math.max(2, Math.min(24 * 3600, span)) }),
  openInspector: (openGap) => set({ openGap }),
  goLive: (now) => set({ t: now, mode: "live" }),
  setPlaying: (playing) => set({ playing }),
  setRate: (rate) => set({ rate }),
  tick: (dt, limit) => set((st) => {
    if (!st.playing) return st;
    const next = st.t + dt * st.rate;
    if (next >= limit) return { t: limit, playing: false };   // stop at the edge
    return { t: next };
  }),
}));

/** Clock helpers on the seconds-of-day axis everything uses. */
export const hhmmss = (s: number) => {
  const v = Math.max(0, Math.floor(s));
  const h = Math.floor(v / 3600), m = Math.floor((v % 3600) / 60), sec = v % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};
export const hhmm = (s: number) => hhmmss(s).slice(0, 5);
/** minute-of-day -> clock */
export const mLabel = (m: number) => hhmm(Math.floor(m) * 60);
