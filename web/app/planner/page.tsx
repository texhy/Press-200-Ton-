"use client";
import { useEffect, useMemo, useState } from "react";
import { Shell } from "@/components/shell/Shell";
import { Card, Source, StatTile } from "@/components/ui";
import { loadDay, loadPlan, useAsync } from "@/lib/data";
import {
  useKanban, weeksInMonth, datesOfWeek, weekIndexOf, isWeekend, iso,
  SHIFT_MIN, type JobCard, type Shift,
} from "@/lib/kanbanStore";
import { FilterBar } from "@/components/planner/FilterBar";
import { DayColumn } from "@/components/planner/DayColumn";
import { AddPartSheet } from "@/components/planner/AddPartSheet";
import { n0 } from "@/lib/format";

/** THE PLANNER, AS A BOARD.
 *
 *  Year ▸ month ▸ week narrows to one block of days; the board is that block,
 *  one column per day, jobs as cards inside it. The thing the screen is for is
 *  the capacity read: every column states how much of each 510-minute shift is
 *  already spoken for, and goes amber the moment a day is asking for more than
 *  the press has ever produced.
 *
 *  Dragging is pointer-based rather than a drop library: on release the board
 *  asks which column is under the pointer and moves the card there. Fewer
 *  moving parts than a DnD context, and it survives the layout animation. */

const fmtMin = (m: number) =>
  m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;

export default function PlannerPage() {
  const { data: day } = useAsync(loadDay);
  const { data: plan } = useAsync(loadPlan);
  const K = useKanban(plan);

  // the baseline week anchors the initial view, so the seeded jobs are on screen
  const anchor = useMemo(() => (plan ? new Date(`${plan.week_of}T00:00:00`) : new Date()), [plan]);
  const [year, setYear] = useState<number | null>(null);
  const [month, setMonth] = useState<number | null>(null);
  const [week, setWeek] = useState<number | null>(null);
  const [showWeekend, setShowWeekend] = useState(false);

  useEffect(() => {
    if (!plan || year !== null) return;
    setYear(anchor.getFullYear());
    setMonth(anchor.getMonth());
    setWeek(weekIndexOf(anchor));
  }, [plan, anchor, year]);

  const [sheetDate, setSheetDate] = useState<string | null>(null);
  const [editing, setEditing] = useState<JobCard | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);

  const y = year ?? anchor.getFullYear();
  const m = month ?? anchor.getMonth();
  const weeks = weeksInMonth(y, m);
  const w = weeks.find((x) => x.n === (week ?? 1)) ?? weeks[0];

  const allDays = useMemo(() => (w ? datesOfWeek(w.start) : []), [w]);
  const days = showWeekend ? allDays : allDays.filter((d) => !isWeekend(d.dow));

  const byDate = useMemo(() => {
    const map: Record<string, JobCard[]> = {};
    for (const c of K.cards) (map[c.date] ??= []).push(c);
    return map;
  }, [K.cards]);

  /** jobs sitting on Sat/Sun while the weekend is hidden */
  const hiddenWeekend = showWeekend ? 0
    : allDays.filter((d) => isWeekend(d.dow))
             .reduce((s, d) => s + (byDate[d.date]?.length ?? 0), 0);

  /** how many cards each week of this month holds — drives the filter dots */
  const weekCounts = useMemo(() => {
    const out: Record<number, number> = {};
    for (const wk of weeks) {
      out[wk.n] = datesOfWeek(wk.start)
        .filter((d) => showWeekend || !isWeekend(d.dow))
        .reduce((s, d) => s + (byDate[d.date]?.length ?? 0), 0);
    }
    return out;
  }, [weeks, byDate, showWeekend]);

  /* ---- week roll-up, shown above the board --------------------------- */
  const weekCards = days.flatMap((d) => byDate[d.date] ?? []);
  const plannedMin = weekCards.reduce((s, c) => s + c.estMin, 0);
  const plannedPcs = weekCards.reduce((s, c) => s + c.qty, 0);
  const capacityMin = days.length * 2 * SHIFT_MIN;
  const overDays = days.filter((d) => {
    const cs = byDate[d.date] ?? [];
    const a = cs.filter((c) => c.shift === "A").reduce((s, c) => s + c.estMin, 0);
    const b = cs.filter((c) => c.shift === "B").reduce((s, c) => s + c.estMin, 0);
    return a > SHIFT_MIN || b > SHIFT_MIN;
  }).length;

  /* ---- drag: which column is under the pointer -----------------------
   *  The point comes from framer-motion's own drag info, so this never has to
   *  guess from DOM state whether a drag is in progress. */
  const dayUnder = (p: { x: number; y: number }) =>
    document.elementFromPoint(p.x, p.y)?.closest<HTMLElement>("[data-day]")?.dataset.day ?? null;

  const onDragMove = (p: { x: number; y: number }) => setOverDay(dayUnder(p));
  const onDragEnd = (id: string, p: { x: number; y: number }) => {
    const target = dayUnder(p);
    const card = K.cards.find((c) => c.id === id);
    if (target && card && card.date !== target) K.moveCard(id, target);
    setOverDay(null);
  };

  if (!day || !plan || !w) return <Shell day={day ?? null}><Card title="Loading…" /></Shell>;

  const todayIso = iso(new Date());
  const sheetDay = allDays.find((d) => d.date === sheetDate);
  const sheetExisting: Record<Shift, number> = {
    A: (byDate[sheetDate ?? ""] ?? []).filter((c) => c.shift === "A").reduce((s, c) => s + c.estMin, 0),
    B: (byDate[sheetDate ?? ""] ?? []).filter((c) => c.shift === "B").reduce((s, c) => s + c.estMin, 0),
  };

  return (
    <Shell day={day} wide>
      {/* ---- roll-up for the selected week ----------------------------- */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
        <Card><StatTile source="plan" label="Week of"
                        value={w.label}
                        sub={`${y} · ${days.length} days`} /></Card>
        <Card><StatTile source="plan" label="Jobs planned" value={n0(weekCards.length)}
                        sub={weekCards.length ? `${n0(plannedPcs)} pcs` : "nothing yet"} /></Card>
        <Card><StatTile source="calc" label="Press time" value={fmtMin(plannedMin)}
                        sub={`of ${fmtMin(capacityMin)} available`} /></Card>
        <Card edge={overDays ? "warning" : undefined}>
          <StatTile source="calc" label="Days over capacity" value={n0(overDays)}
                    tone={overDays ? "var(--warning)" : undefined}
                    sourceNote="a shift asking for more minutes than the press has ever produced"
                    sub={overDays ? "replan or accept overtime" : "all shifts fit"} />
        </Card>
      </div>

      {/* ---- heading + filters ----------------------------------------- */}
      <header className="mt-7 mb-5">
        <h1 className="m-0 text-[30px] font-[680] leading-[1.1] tracking-[-0.02em]">
          Production Board
        </h1>
        <p className="m-0 mt-1.5 text-[13px] text-[var(--muted)]">
          What the press is scheduled to make, day by day. Drag a card to move it.
        </p>
      </header>

      <div className="flex flex-col gap-4">
        <FilterBar
          year={y} month={m} week={w.n}
          years={[y - 1, y, y + 1]}
          onYear={setYear} onMonth={(mm) => { setMonth(mm); setWeek(1); }} onWeek={setWeek}
          showWeekend={showWeekend} onWeekend={setShowWeekend}
          counts={weekCounts}
        />

        <div className="flex items-center gap-3">
          <h2 className="m-0 text-[15px] font-[620]">
            {w.label}
            <span className="text-[var(--muted)] font-[460]"> · {y}</span>
          </h2>
          <Source from="plan" note="your own entries, kept in this browser — there is no backend" />
          {/* hidden weekend work must never just disappear */}
          {!showWeekend && hiddenWeekend > 0 && (
            <button onClick={() => setShowWeekend(true)}
                    className="h-[26px] px-2.5 rounded-[7px] text-[11.5px] transition-colors"
                    style={{ color: "var(--s4)",
                             background: "color-mix(in srgb, var(--s4) 12%, transparent)",
                             border: "1px solid color-mix(in srgb, var(--s4) 35%, transparent)" }}>
              {hiddenWeekend} more on the weekend — show
            </button>
          )}

          <button
            onClick={() => K.resetWeek(allDays.map((d) => d.date))}
            className="ml-auto h-[30px] px-3 rounded-[8px] text-[12px] text-[var(--muted)]
                       border border-[var(--hair)] hover:text-[var(--critical)]
                       hover:border-[var(--critical)] transition-colors">
            Clear week
          </button>
        </div>
      </div>

      {/* ---- the board ------------------------------------------------- */}
      <div className="mt-4 grid gap-4 items-start overflow-x-auto pb-1"
           style={{ gridTemplateColumns: `repeat(${days.length}, minmax(248px, 1fr))` }}>
        {days.map((d) => (
          <DayColumn
            key={d.date}
            date={d.date} dow={d.dow} dom={d.dom}
            cards={byDate[d.date] ?? []}
            parts={K.parts}
            isToday={d.date === todayIso}
            isOver={overDay === d.date}
            weekend={isWeekend(d.dow)}
            onAdd={() => { setEditing(null); setSheetDate(d.date); }}
            onEdit={(c) => { setEditing(c); setSheetDate(c.date); }}
            onRemove={K.removeCard}
            onDragStart={() => setOverDay(d.date)}
            onDragMove={onDragMove}
            onDragEnd={onDragEnd}
          />
        ))}
      </div>

      <p className="m-0 mt-4 text-[11.5px] text-[var(--muted)] leading-relaxed max-w-[760px]">
        A weekday runs two {fmtMin(SHIFT_MIN)} shifts; weekends run one. Time per job is the
        quantity divided by that part&apos;s proven rate — only Form Left&apos;s rate is measured
        from a real run, the rest are estimates, and every card says which. Edits are kept in
        this browser only.
      </p>

      <AddPartSheet
        open={sheetDate !== null}
        date={sheetDate ?? ""}
        dow={sheetDay?.dow ?? 1}
        dom={sheetDay?.dom ?? 1}
        parts={K.parts}
        editing={editing}
        existingMin={sheetExisting}
        onClose={() => { setSheetDate(null); setEditing(null); }}
        onSave={(c) => {
          if (editing) K.updateCard(editing.id, c);
          else K.addCard(c);
        }}
      />
    </Shell>
  );
}
