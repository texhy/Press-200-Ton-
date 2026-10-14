"use client";
import { MONTH_LABEL, weeksInMonth } from "@/lib/kanbanStore";
import { Dropdown } from "./Dropdown";

/** YEAR ▸ MONTH ▸ WEEK.
 *
 *  Three dropdowns rather than three rows of pills: twenty controls on screen
 *  to make two choices is noise, and it pushed the board — the thing anyone
 *  came here to look at — below the fold. */

export function FilterBar({
  year, month, week, years, onYear, onMonth, onWeek,
  showWeekend, onWeekend, counts,
}: {
  year: number; month: number; week: number;
  years: number[];
  onYear: (y: number) => void;
  onMonth: (m: number) => void;
  onWeek: (w: number) => void;
  showWeekend: boolean;
  onWeekend: (v: boolean) => void;
  /** jobs per week — surfaced on the option so a week with work is obvious */
  counts: Record<number, number>;
}) {
  const weeks = weeksInMonth(year, month);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Dropdown label="YEAR" width={112} value={String(year)}
                onChange={(v) => onYear(Number(v))}
                options={years.map((y) => ({ value: String(y), label: String(y) }))} />

      <Dropdown label="MONTH" width={156} value={String(month)}
                onChange={(v) => onMonth(Number(v))}
                options={MONTH_LABEL.map((m, i) => ({ value: String(i), label: m }))} />

      <Dropdown label="WEEK" width={262} value={String(week)}
                onChange={(v) => onWeek(Number(v))}
                options={weeks.map((w) => ({
                  value: String(w.n),
                  label: `Week ${w.n}`,
                  hint: w.label,
                  badge: counts[w.n] || undefined,
                }))} />

      <label className="ml-auto flex items-center gap-2.5 h-[38px] px-3 rounded-[10px]
                        text-[12.5px] cursor-pointer select-none transition-colors"
             style={{ border: `1px solid ${showWeekend ? "var(--s1)" : "var(--hair)"}`,
                      color: showWeekend ? "var(--s1)" : "var(--muted)",
                      background: showWeekend
                        ? "color-mix(in srgb, var(--s1) 9%, transparent)" : "transparent" }}>
        <input type="checkbox" checked={showWeekend} onChange={(e) => onWeekend(e.target.checked)}
               className="accent-[var(--s1)] w-[14px] h-[14px]" />
        Show weekend
      </label>
    </div>
  );
}
