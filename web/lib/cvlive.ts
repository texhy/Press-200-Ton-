"use client";
import { useEffect, useMemo, useRef } from "react";
import type { CvTimeline, CvFrame, Day } from "./types";

/** LIVE CAMERA STATE AT THE PLAYHEAD.
 *
 *  The dashboard used to read every camera number out of `day.minutes[t/60]`,
 *  which is a one-minute bucket — so nothing visibly moved while the video
 *  played. The camera samples at 5 Hz; this binds the readouts to that instead,
 *  so stroke count, sheet counters, operator presence, part class and press
 *  state all advance with the footage.
 *
 *  PLC and VFD stay on the minute spine: they are simulated, and pretending
 *  they have sub-minute resolution would be inventing precision. */

export interface CvLive {
  /** the camera sample at the playhead, or null outside the covered window */
  frame: CvFrame | null;
  covered: boolean;
  /** seconds into the video for the current clock time (may be out of range) */
  videoT: number;
  /** real vy history ending at the playhead — drives the pulse instrument */
  vy: number[];
  /** strokes the camera has counted up to this instant */
  strokes: number;
  sheetIn: number;
  sheetOut: number;
  pressState: 0 | 1 | 2 | 3;
  dieChanging: boolean;
  forklift: boolean;
  operator: { tid: number; confirmed: boolean; sim: number } | null;
  part: string | null;
  /** seconds since the last counted stroke — 0 while stroking */
  sinceStroke: number;
}

const EMPTY: CvLive = {
  frame: null, covered: false, videoT: 0, vy: [], strokes: 0,
  sheetIn: 0, sheetOut: 0, pressState: 0, dieChanging: false, forklift: false,
  operator: null, part: null, sinceStroke: 0,
};

/** Binary search for the last frame at or before `vt`. */
function findIdx(frames: CvFrame[], vt: number): number {
  let lo = 0, hi = frames.length - 1;
  if (!frames.length || vt < frames[0].t) return -1;
  if (vt >= frames[hi].t) return hi;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= vt) lo = mid; else hi = mid;
  }
  return lo;
}

const PULSE_SAMPLES = 90;   // ~18 s of real signal at 5 Hz

export function useCvLive(cv: CvTimeline | null, day: Day | null, t: number): CvLive {
  // keep the last good sample so a momentary miss does not blank the readouts
  const last = useRef<CvLive>(EMPTY);

  return useMemo(() => {
    if (!cv || !day) return EMPTY;
    const t0 = day.camera.start_min * 60;
    const videoT = t - t0;
    const covered = videoT >= 0 && videoT <= (cv.totals.seconds ?? 0);
    if (!covered) {
      last.current = { ...EMPTY, videoT, covered: false };
      return last.current;
    }
    const i = findIdx(cv.frames, videoT);
    if (i < 0) return { ...EMPTY, videoT, covered };
    const f = cv.frames[i];

    const vy: number[] = [];
    for (let k = Math.max(0, i - PULSE_SAMPLES + 1); k <= i; k++) vy.push(cv.frames[k].vy);

    // how long since the stroke counter last advanced
    let sinceStroke = 0;
    for (let k = i; k > 0 && cv.frames[k].c === f.c; k--) sinceStroke = f.t - cv.frames[k].t;

    const out: CvLive = {
      frame: f, covered: true, videoT,
      vy,
      strokes: f.c,
      sheetIn: f.si,
      sheetOut: f.so,
      pressState: f.ps,
      dieChanging: f.dc === 1,
      forklift: f.fk === 1,
      operator: f.w ? { tid: f.w[0], confirmed: f.cf === 1, sim: f.w[6] / 100 } : null,
      part: f.d.length ? f.d[0][0] : null,
      sinceStroke: Math.round(sinceStroke * 10) / 10,
    };
    last.current = out;
    return out;
  }, [cv, day, t]);
}

/* ------------------------------------------------------------------------ */


/** Keep a <video> locked to the cursor.
 *
 *  The cursor is the clock; the video is a follower. It plays for smooth
 *  decode and is nudged only when it drifts, because seeking every frame
 *  stutters badly. A user scrub of the native controls pushes back into the
 *  cursor, so the two never disagree about what time it is. */
export function useVideoFollower(
  vid: React.RefObject<HTMLVideoElement | null>,
  day: Day | null,
  t: number,
  playing: boolean,
  rate: number,
  onUserSeek?: (clockS: number) => void,
) {
  const camT0 = day ? day.camera.start_min * 60 : 0;
  const camT1 = day ? day.camera.end_min * 60 : 0;
  const ours = useRef(false);

  // follow the cursor
  useEffect(() => {
    const v = vid.current;
    if (!v || !day) return;
    const vs = t - camT0;
    const inRange = vs >= 0 && vs <= (v.duration || Infinity);
    if (!inRange) { if (!v.paused) v.pause(); return; }
    // only correct real drift — seeking on every frame stutters
    if (Math.abs(v.currentTime - vs) > 0.35) {
      ours.current = true;
      v.currentTime = vs;
    }
    // rates above 4x are past what the decoder will do smoothly; let the
    // cursor run ahead and keep the video as a periodically-seeked still
    const canPlay = playing && rate <= 4;
    v.playbackRate = Math.max(0.0625, Math.min(4, rate));
    if (canPlay && v.paused) void v.play().catch(() => {});
    if (!canPlay && !v.paused) v.pause();
  }, [t, day, playing, rate, camT0, camT1, vid]);

  // a scrub on the native controls moves the cursor instead of fighting it
  useEffect(() => {
    const v = vid.current;
    if (!v || !day || !onUserSeek) return;
    const onSeeked = () => {
      if (ours.current) { ours.current = false; return; }
      onUserSeek(camT0 + v.currentTime);
    };
    v.addEventListener("seeked", onSeeked);
    return () => v.removeEventListener("seeked", onSeeked);
  }, [day, camT0, onUserSeek, vid]);
}
