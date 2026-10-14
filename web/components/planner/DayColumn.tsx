"use client";
import { AnimatePresence, motion } from "framer-motion";
import type { JobCard, PartSpec } from "@/lib/kanbanStore";
import { SHIFT_MIN, DAY_LABEL } from "@/lib/kanbanStore";
import { JobCardView } from "./JobCardView";

/** ONE DAY.
 *
 *  The header follows the shape people already read on a project board: a
 *  coloured dot, the name, a count. Underneath it, the one thing a production
 *  board has that a task board does not — whether the day physically fits.
 *
 *  That is said in words, not just a bar. "3h left" and "1h 20m over" are
 *  immediately actionable; "126%" has to be converted in your head first. */

const fmtMin = (m: number) =>
  m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;

function Capacity({ mins }: { mins: number }) {
  const pct = Math.round((mins / (SHIFT_MIN * 2)) * 100);
  const over = mins > SHIFT_MIN * 2;
  const left = SHIFT_MIN * 2 - mins;
  const tone = over ? "var(--warning)" : pct > 85 ? "var(--s4)" : "var(--s3)";

  return (
    <div className="flex flex-col gap-1.5">
      <span className="h-[5px] rounded-full overflow-hidden" style={{ background: "var(--hair)" }}>
        <motion.span className="block h-full rounded-full"
                     initial={false}
                     animate={{ width: `${Math.min(100, pct)}%` }}
                     transition={{ duration: 0.36, ease: [0.2, 0, 0, 1] }}
                     style={{ background: tone }} />
      </span>
      <span className="text-[11px]" style={{ color: over ? "var(--warning)" : "var(--muted)" }}>
        {mins === 0 ? "day is free"
          : over ? `${fmtMin(mins - SHIFT_MIN * 2)} over capacity`
          : `${fmtMin(left)} still free`}
      </span>
    </div>
  );
}

export function DayColumn({
  date, dow, dom, cards, parts, isToday, isOver, weekend,
  onAdd, onEdit, onRemove, onDragStart, onDragMove, onDragEnd,
}: {
  date: string; dow: number; dom: number;
  cards: JobCard[];
  parts: PartSpec[];
  isToday: boolean;
  isOver: boolean;
  weekend: boolean;
  onAdd: () => void;
  onEdit: (c: JobCard) => void;
  onRemove: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragMove: (p: { x: number; y: number }) => void;
  onDragEnd: (id: string, p: { x: number; y: number }) => void;
}) {
  const total = cards.reduce((s, c) => s + c.estMin, 0);
  const over = total > SHIFT_MIN * 2;
  const dot = over ? "var(--warning)" : isToday ? "var(--s1)" : weekend ? "var(--muted)" : "var(--s3)";

  return (
    <motion.section
      layout
      data-day={date}
      className="flex flex-col min-w-0 rounded-[12px]"
      animate={{ backgroundColor: isOver ? "color-mix(in srgb, var(--s1) 7%, var(--surface))" : "var(--surface)" }}
      transition={{ duration: 0.18 }}
      style={{ border: `1px solid ${isOver ? "var(--s1)" : "var(--hair)"}` }}
    >
      {/* ---- header ---------------------------------------------------- */}
      <header className="px-4 pt-4 pb-3.5 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <i aria-hidden className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: dot }} />
          <span className="text-[14px] font-[640]">{DAY_LABEL[dow]}</span>
          <span className="text-[12px] text-[var(--muted)] tnum">{dom}</span>
          {isToday && (
            <span className="text-[9px] font-[700] tracking-[0.07em] px-1.5 py-[2px] rounded-[4px]"
                  style={{ color: "var(--s1)", background: "color-mix(in srgb, var(--s1) 15%, transparent)" }}>
              TODAY
            </span>
          )}
          <span className="ml-auto text-[11px] tnum px-2 py-[2px] rounded-full text-[var(--muted)]"
                style={{ background: "var(--raised)" }}>
            {cards.length}
          </span>
        </div>

        <Capacity mins={total} />
      </header>

      {/* ---- cards ------------------------------------------------------ */}
      <div className="flex flex-col gap-2.5 px-3 pb-3">
        <AnimatePresence mode="popLayout">
          {cards.map((c) => (
            <JobCardView key={c.id} card={c}
                         spec={parts.find((p) => p.part === c.part)}
                         onEdit={() => onEdit(c)}
                         onRemove={() => onRemove(c.id)}
                         onDragStart={onDragStart}
                         onDragMove={onDragMove}
                         onDragEnd={onDragEnd} />
          ))}
        </AnimatePresence>

        {!cards.length && (
          <div className="grid place-items-center py-7 text-[12px] text-[var(--muted)] opacity-50">
            nothing planned
          </div>
        )}

        <button onClick={onAdd}
                className="h-[38px] rounded-[10px] text-[12.5px] text-[var(--muted)]
                           border border-dashed transition-colors
                           hover:text-[var(--s1)] hover:border-[var(--s1)]
                           hover:bg-[color-mix(in_srgb,var(--s1)_6%,transparent)]"
                style={{ borderColor: "var(--hair-strong)" }}>
          + Add part
        </button>
      </div>
    </motion.section>
  );
}
