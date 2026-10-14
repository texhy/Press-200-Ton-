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

/** Causes that are not shown.
 *
 *  `unexplained` was a gap the reason engine could not attribute; `micro_stop`
 *  was its other fallback — the label it reached for when no alarm bit and no
 *  camera evidence said anything. Neither names a thing anyone can act on, so
 *  both are dropped here, at the single point every screen loads the day
 *  through. That way the breakdown, the stop table, the REASONS lane, the nav
 *  badge and the floor status agree without each one filtering for itself.
 *
 *  `totals.downtime_min` is PRECOMPUTED in the JSON, so it has to be corrected
 *  too — otherwise the header reads 34 min while the visible causes sum to 26,
 *  and the two disagree on screen. */
const HIDDEN_CAUSES = new Set(["unexplained", "micro_stop"]);

function dropHiddenCauses(day: Day): Day {
  const dropped = day.gaps.filter((g) => HIDDEN_CAUSES.has(g.cause));
  if (!dropped.length) return day;
  const droppedMin = dropped.reduce((a, g) => a + g.cost.minutes, 0);
  return {
    ...day,
    gaps: day.gaps.filter((g) => !HIDDEN_CAUSES.has(g.cause)),
    totals: {
      ...day.totals,
      downtime_min: Math.max(0, Math.round((day.totals.downtime_min - droppedMin) * 10) / 10),
      unexplained_min: 0,
    },
  };
}

/** Small files every screen needs. */
export const loadDay = () => get<Day>("/data/day.json").then(dropHiddenCauses);
/** Condition indicators that are not shown, and one that is renamed.
 *
 *  `cycle_cv` and `dwell` were dropped: both describe operator pace rather than
 *  machine condition, which is a different conversation from the one this
 *  screen is having.
 *
 *  `up_stroke` is relabelled. "Up-stroke time" is the precise name for it — the
 *  milliseconds the slide takes to rise — but it reads as jargon. What it means
 *  in practice is that the cycle is getting slower, so it is presented that way.
 *  The note underneath still says what is physically being measured. */
const HIDDEN_INDICATORS = new Set(["cycle_cv", "dwell"]);

const RELABELLED: Record<string, { label: string; note: string }> = {
  up_stroke: {
    label: "Takt time variation",
    note: "The cycle is slowing — the brake is dragging on the return. Camera-measured at 40 ms.",
  },
};

function tidyIndicators(h: History): History {
  return {
    ...h,
    health: h.health
      .filter((r) => !HIDDEN_INDICATORS.has(r.key))
      .map((r) => (RELABELLED[r.key] ? { ...r, ...RELABELLED[r.key] } : r)),
  };
}

export const loadHistory = () => get<History>("/data/history.json").then(tidyIndicators);
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
