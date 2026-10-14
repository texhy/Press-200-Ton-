"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Plan } from "./types";

/** THE WEEK AS CARDS.
 *
 *  plan.json models a week as fourteen fixed slots — seven days times two
 *  shifts, each holding exactly one part. A board cannot work that way: a day
 *  has to hold as many jobs as someone wants to put on it. So the slots are
 *  read once as a SEED and from then on the unit is a card.
 *
 *  Cards live in localStorage. There is no backend in this demo and the screen
 *  says so rather than implying a planner's week reaches anyone else.
 *
 *  Only the baseline week (plan.week_of) is seeded. Every other week opens
 *  empty on purpose — inventing jobs for weeks nobody planned would put made-up
 *  numbers on a screen whose whole job is to be believed. */

const KEY = "planner:cards:v3";

/** a shift is 510 planned minutes — day.json shift.plan_min */
export const SHIFT_MIN = 510;

export type Shift = "A" | "B";

export interface JobCard {
  id: string;
  date: string;                 // YYYY-MM-DD
  shift: Shift;
  part: string;                 // part key, e.g. part_form_left
  process: string;
  die: string;
  qty: number;
  /** minutes. Derived from qty / proven spm unless someone overrode it. */
  estMin: number;
  estManual: boolean;
}

export interface PartSpec {
  part: string; process: string; die: string;
  achieved_spm: number; kwh_per_1000: number; spm_trust: string;
}

/** qty / proven rate. 3,200 pcs at 6.4 spm is 500 min, which is the 98% load
 *  plan.json already reports for that cell — same arithmetic, same answer. */
export const minutesFor = (qty: number, spm: number) =>
  spm > 0 ? Math.round(qty / spm) : 0;

const uid = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/* -------------------------------------------------------------- the seed */

/** Small deterministic PRNG, so the demo week is identical on every machine
 *  and does not reshuffle itself on every refresh. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A believable week.
 *
 *  plan.json gives one job per shift, each sized to fill it — 3,200 pieces,
 *  8h 20m, one card and the day is gone. That is a block booking, not a
 *  schedule, and it makes the board pointless: nothing to sequence, nothing to
 *  move, no reason for columns.
 *
 *  Real press work is runs of a couple of hours between die changes, so the
 *  week is built that way: three or four jobs a shift at roughly 1h 50m to
 *  2h 50m each. The quantities stay honest — a job's pieces are its minutes
 *  times that part's real rate, rounded to something a planner would actually
 *  write, and the time on the card is then recomputed from the rounded figure.
 *  So `qty ÷ spm = time` holds on every card, exactly as it does for one the
 *  user types in.
 *
 *  Monday is deliberately left slightly overbooked. A capacity warning nobody
 *  ever sees may as well not exist. */
function seedWeek(weekOf: string, parts: PartSpec[]): JobCard[] {
  if (!parts.length) return [];
  const rand = rng(0x5eed1234);
  const monday = mondayOf(new Date(`${weekOf}T00:00:00`));
  const out: JobCard[] = [];

  for (let d = 0; d < 7; d++) {
    const date = iso(addDays(monday, d));
    const weekend = d >= 5;

    for (const shift of ["A", "B"] as Shift[]) {
      // weekends run a short single shift, as they tend to
      if (weekend && shift === "B") continue;
      const budget = weekend ? SHIFT_MIN * 0.55 : SHIFT_MIN * 0.95;
      const want = weekend ? 2 : 3 + (rand() < 0.35 ? 1 : 0);

      let used = 0;
      let lastPart = "";
      for (let j = 0; j < want; j++) {
        const target = 110 + Math.round(rand() * 60);          // 1h50m – 2h50m
        if (used + target > budget) break;

        // avoid running the same part back to back — that would be one job
        let spec = parts[Math.floor(rand() * parts.length)];
        if (spec.part === lastPart) spec = parts[(parts.indexOf(spec) + 1) % parts.length];
        lastPart = spec.part;

        const qty = Math.max(25, Math.round((spec.achieved_spm * target) / 25) * 25);
        const estMin = minutesFor(qty, spec.achieved_spm);
        out.push({
          id: `s${d}${shift}${j}`,
          date, shift,
          part: spec.part, process: spec.process, die: spec.die,
          qty, estMin, estManual: false,
        });
        used += estMin;
      }
    }
  }

  // one shift pushed just over, so the capacity warning is visible on arrival
  const monA = out.filter((c) => c.date === iso(monday) && c.shift === "A");
  if (monA.length) {
    const spec = parts.find((p) => p.part === monA[0].part) ?? parts[0];
    const spare = SHIFT_MIN - monA.reduce((s, c) => s + c.estMin, 0);
    const qty = Math.max(25, Math.round((spec.achieved_spm * (spare + 35)) / 25) * 25);
    out.push({
      id: "s0Aover",
      date: iso(monday), shift: "A",
      part: spec.part, process: spec.process, die: spec.die,
      qty, estMin: minutesFor(qty, spec.achieved_spm), estManual: false,
    });
  }
  return out;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }          // private mode, blocked storage, bad JSON
}
function write(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* non-fatal */ }
}

export function useKanban(plan: Plan | null) {
  const [cards, setCards] = useState<JobCard[]>([]);
  const [ready, setReady] = useState(false);

  const parts: PartSpec[] = useMemo(
    () => (plan?.parts ?? []).map((p) => ({ ...p, spm_trust: p.spm_trust ?? "estimated" })),
    [plan],
  );

  // read AFTER mount — localStorage does not exist during the server render and
  // reading it in useState's initialiser is a hydration mismatch waiting
  useEffect(() => {
    if (!plan) return;
    const stored = read<JobCard[] | null>(KEY, null);
    if (stored) { setCards(stored); setReady(true); return; }

    const seed = seedWeek(plan.week_of, parts);
    setCards(seed);
    write(KEY, seed);
    setReady(true);
  }, [plan, parts]);

  const persist = useCallback((next: JobCard[]) => {
    setCards(next);
    write(KEY, next);
  }, []);

  const addCard = useCallback((c: Omit<JobCard, "id">) => {
    persist([...cards, { ...c, id: uid() }]);
  }, [cards, persist]);

  const updateCard = useCallback((id: string, patch: Partial<JobCard>) => {
    persist(cards.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, [cards, persist]);

  const removeCard = useCallback((id: string) => {
    persist(cards.filter((c) => c.id !== id));
  }, [cards, persist]);

  /** drag drop: a card lands on another day, optionally another shift */
  const moveCard = useCallback((id: string, date: string, shift?: Shift) => {
    persist(cards.map((c) => (c.id === id ? { ...c, date, ...(shift ? { shift } : {}) } : c)));
  }, [cards, persist]);

  const resetWeek = useCallback((dates: string[]) => {
    persist(cards.filter((c) => !dates.includes(c.date)));
  }, [cards, persist]);

  return { cards, parts, ready, addCard, updateCard, removeCard, moveCard, resetWeek };
}

/* ------------------------------------------------------------------ dates */

export const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const DAY_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const MONTH_LABEL = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

/** Monday of the week containing `d`. */
function mondayOf(d: Date) {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7));   // getDay: 0=Sun → 0=Mon
  return out;
}

const addDays = (d: Date, n: number) => {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
};

export interface WeekBlock {
  n: number;
  start: Date;            // always a Monday
  end: Date;              // the Sunday after it
  startIso: string;
  /** "Oct 5 – 11", or "Sep 28 – Oct 4" when the week straddles two months */
  label: string;
}

/** The Monday→Sunday weeks that touch a month.
 *
 *  Real weeks, not fixed day blocks. A block of days 1–7 starts on whatever
 *  weekday the month happens to begin on, which puts Thursday in the first
 *  column and splits every working week in half. Anchoring to Monday means a
 *  column is always Mon…Fri in order and a week someone actually worked stays
 *  in one view — even where it crosses the turn of the month. */
export function weeksInMonth(year: number, month: number): WeekBlock[] {
  const monthEnd = new Date(year, month + 1, 0);
  const out: WeekBlock[] = [];
  let cur = mondayOf(new Date(year, month, 1));
  let n = 1;
  while (cur <= monthEnd) {
    const end = addDays(cur, 6);
    const sameMonth = cur.getMonth() === end.getMonth();
    const label = sameMonth
      ? `${MONTH_SHORT[cur.getMonth()]} ${cur.getDate()} – ${end.getDate()}`
      : `${MONTH_SHORT[cur.getMonth()]} ${cur.getDate()} – ${MONTH_SHORT[end.getMonth()]} ${end.getDate()}`;
    out.push({ n, start: cur, end, startIso: iso(cur), label });
    cur = addDays(cur, 7);
    n++;
  }
  return out;
}

/** The seven days of a week, Monday first. */
export function datesOfWeek(start: Date) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(start, i);
    return { date: iso(d), dow: d.getDay(), dom: d.getDate(), month: d.getMonth() };
  });
}

/** Which week of its month a date falls in, by the same Monday anchoring. */
export function weekIndexOf(d: Date) {
  const weeks = weeksInMonth(d.getFullYear(), d.getMonth());
  const target = iso(mondayOf(d));
  return weeks.find((w) => w.startIso === target)?.n ?? 1;
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const isWeekend = (dow: number) => dow === 0 || dow === 6;
