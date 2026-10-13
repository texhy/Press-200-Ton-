"use client";
import { useEffect, useState } from "react";
import type { Day, CvTimeline, History, Plan, Pulse } from "./types";

/** One in-flight promise per URL, for the life of the page.
 *
 *  Every screen pulls day.json (400 KB raw) through Shell, and several pull it
 *  again from their own useAsync; the assistant needs it on every screen too.
 *  Without this they are separate fetches of the same immutable file — the
 *  browser's HTTP cache usually absorbs it, but the JSON is re-parsed each
 *  time, and that is the expensive half. Caching the PROMISE also means two
 *  components mounting in the same tick share one request. */
const inflight = new Map<string, Promise<unknown>>();

async function get<T>(url: string): Promise<T> {
  let p = inflight.get(url) as Promise<T> | undefined;
  if (!p) {
    p = (async () => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${url}: ${r.status}`);
      return r.json() as Promise<T>;
    })();
    // a failed fetch must not be cached as a permanent failure
    p.catch(() => inflight.delete(url));
    inflight.set(url, p);
  }
  return p;
}

/** Small files every screen needs. */
export const loadDay = () => get<Day>("/data/day.json");
export const loadHistory = () => get<History>("/data/history.json");
export const loadPlan = () => get<Plan>("/data/plan.json");
/** The per-frame CV file is MBs — only the camera and timeline screens pull it. */
export const loadCv = () => get<CvTimeline>("/data/cv.json");
/** 107 KB — cheap enough for every screen. */
export const loadPulse = () => get<Pulse>("/data/pulse.json");

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fn().then((d) => live && setData(d)).catch((e) => live && setErr(String(e)));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, err };
}

/** Index CV frames by time for O(1)-ish seeking, plus the lerp pair for a
 *  given video time. The CV file is 5 Hz and the video is 25 fps, so geometry
 *  MUST be interpolated or the overlay boxes visibly stutter. */
export function cvIndex(cv: CvTimeline) {
  const fr = cv.frames;
  const at = (t: number) => {
    let lo = 0, hi = fr.length - 1;
    if (!fr.length) return null;
    if (t <= fr[0].t) return { a: fr[0], b: fr[0], u: 0 };
    if (t >= fr[hi].t) return { a: fr[hi], b: fr[hi], u: 0 };
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (fr[mid].t <= t) lo = mid; else hi = mid;
    }
    const a = fr[lo], b = fr[hi];
    const span = b.t - a.t;
    return { a, b, u: span > 0 ? (t - a.t) / span : 0 };
  };
  return { at, first: fr[0]?.t ?? 0, last: fr[fr.length - 1]?.t ?? 0 };
}

export const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
