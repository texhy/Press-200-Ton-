"use client";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { JobCard, PartSpec, Shift } from "@/lib/kanbanStore";
import { SHIFT_MIN, minutesFor, DAY_LABEL } from "@/lib/kanbanStore";
import { partLabel, n0 } from "@/lib/format";

/** ADD / EDIT A JOB.
 *
 *  Time is not asked for. It is qty divided by the part's proven rate, shown
 *  live as the quantity is typed, because a planner who has to work out
 *  minutes themselves will guess — and a guessed duration is what makes a
 *  schedule lie. The field can still be overridden, and when it is, the card
 *  says so rather than passing the override off as the proven figure. */

const fmtMin = (m: number) =>
  m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;

const field = `w-full h-[32px] px-2.5 rounded-[var(--r-ctl)] text-[12px] bg-[var(--surface)]
               border border-[var(--hair-strong)] outline-none
               focus:border-[var(--s1)] transition-colors`;

export function AddPartSheet({
  open, date, dow, dom, parts, editing, existingMin, onClose, onSave,
}: {
  open: boolean;
  date: string; dow: number; dom: number;
  parts: PartSpec[];
  /** set when editing an existing card rather than creating one */
  editing: JobCard | null;
  /** minutes already planned that day, per shift — for the capacity preview */
  existingMin: Record<Shift, number>;
  onClose: () => void;
  onSave: (c: Omit<JobCard, "id">) => void;
}) {
  const [partKey, setPartKey] = useState(parts[0]?.part ?? "");
  const [qty, setQty] = useState(1000);
  const [shift, setShift] = useState<Shift>("A");
  const [manualMin, setManualMin] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setPartKey(editing.part); setQty(editing.qty); setShift(editing.shift);
      setManualMin(editing.estManual ? editing.estMin : null);
    } else {
      setPartKey(parts[0]?.part ?? ""); setQty(1000); setShift("A"); setManualMin(null);
    }
  }, [open, editing, parts]);

  const spec = useMemo(() => parts.find((p) => p.part === partKey), [parts, partKey]);
  const autoMin = minutesFor(qty, spec?.achieved_spm ?? 0);
  const estMin = manualMin ?? autoMin;

  // what this job does to the shift it is going onto
  const already = existingMin[shift] ?? 0;
  const after = already + estMin - (editing && editing.shift === shift ? editing.estMin : 0);
  const pct = Math.round((after / SHIFT_MIN) * 100);
  const over = pct > 100;

  if (!open) return null;

  const save = () => {
    if (!spec || qty <= 0) return;
    onSave({
      date, shift, part: spec.part, process: spec.process, die: spec.die,
      qty, estMin, estManual: manualMin !== null,
    });
    onClose();
  };

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 grid place-items-center p-4"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)" }}
        onClick={onClose}
      >
        <motion.div
          initial={{ y: 14, scale: 0.98, opacity: 0 }}
          animate={{ y: 0, scale: 1, opacity: 1 }}
          exit={{ y: 10, scale: 0.99, opacity: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 34 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-[400px] rounded-[var(--r-over)] overflow-hidden"
          style={{ background: "var(--surface)", border: "1px solid var(--hair-strong)",
                   boxShadow: "0 24px 60px rgba(0,0,0,0.5)" }}
        >
          <header className="px-4 py-3 flex items-baseline gap-2"
                  style={{ borderBottom: "1px solid var(--hair)" }}>
            <h2 className="m-0 text-[13px] font-[660]">
              {editing ? "Edit job" : "Add part"}
            </h2>
            <span className="text-[11px] text-[var(--muted)]">
              {DAY_LABEL[dow]} {dom}
            </span>
            <button onClick={onClose} aria-label="Close"
                    className="ml-auto w-[22px] h-[22px] rounded-[3px] text-[11px]
                               border border-[var(--hair-strong)] hover:border-[var(--hair-strong)]
                               hover:text-[var(--ink)] text-[var(--muted)]">✕</button>
          </header>

          <div className="p-4 flex flex-col gap-3">
            {/* part ------------------------------------------------------ */}
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-[700] tracking-[0.07em] text-[var(--muted)]">PART</span>
              <select value={partKey} onChange={(e) => setPartKey(e.target.value)} className={field}>
                {parts.map((p) => (
                  <option key={p.part} value={p.part}>
                    {partLabel(p.part)} · {p.die} · {p.achieved_spm.toFixed(2)} spm
                  </option>
                ))}
              </select>
              {spec && (
                <span className="text-[10px]"
                      style={{ color: spec.spm_trust === "measured" ? "var(--s3)" : "var(--muted)" }}>
                  {spec.spm_trust === "measured"
                    ? "rate measured from the camera run"
                    : "rate is an estimate — not proven by a run"}
                </span>
              )}
            </label>

            {/* shift ----------------------------------------------------- */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-[700] tracking-[0.07em] text-[var(--muted)]">SHIFT</span>
              <div className="flex gap-1.5">
                {(["A", "B"] as Shift[]).map((s) => {
                  const on = shift === s;
                  const col = s === "A" ? "var(--s1)" : "var(--s7)";
                  return (
                    <button key={s} onClick={() => setShift(s)}
                            className="flex-1 h-[32px] rounded-[var(--r-ctl)] text-[12px] font-[600] transition-colors"
                            style={{ border: `1px solid ${on ? col : "var(--hair-strong)"}`,
                                     color: on ? col : "var(--muted)",
                                     background: on ? `color-mix(in srgb, ${col} 12%, transparent)` : "transparent" }}>
                      Shift {s}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* qty ------------------------------------------------------- */}
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-[700] tracking-[0.07em] text-[var(--muted)]">QUANTITY (pcs)</span>
              <input type="number" min={1} value={qty} className={`${field} tnum`}
                     onChange={(e) => setQty(Math.max(0, Number(e.target.value) || 0))} />
            </label>

            {/* estimated time -------------------------------------------- */}
            <label className="flex flex-col gap-1">
              <span className="flex items-center gap-2 text-[10px] font-[700] tracking-[0.07em] text-[var(--muted)]">
                ESTIMATED TIME
                {manualMin !== null && (
                  <button onClick={() => setManualMin(null)}
                          className="font-[500] tracking-normal text-[10px] text-[var(--s1)]">
                    reset to {fmtMin(autoMin)}
                  </button>
                )}
              </span>
              <div className="flex items-center gap-2">
                <input type="number" min={0} value={estMin} className={`${field} tnum`}
                       onChange={(e) => setManualMin(Math.max(0, Number(e.target.value) || 0))} />
                <span className="text-[11px] text-[var(--muted)] shrink-0 w-[62px]">{fmtMin(estMin)}</span>
              </div>
              <span className="text-[10px] text-[var(--muted)]">
                {manualMin === null
                  ? `${n0(qty)} pcs ÷ ${spec?.achieved_spm.toFixed(2) ?? "—"} spm`
                  : "overridden — the card will say so"}
              </span>
            </label>

            {/* capacity preview ------------------------------------------ */}
            <div className="flex flex-col gap-1.5 pt-2.5" style={{ borderTop: "1px solid var(--hair)" }}>
              <div className="flex items-baseline gap-2">
                <span className="text-[10px] font-[700] tracking-[0.07em] text-[var(--muted)]">
                  SHIFT {shift} AFTER THIS
                </span>
                <span className="ml-auto text-[12px] font-[640] tnum"
                      style={{ color: over ? "var(--warning)" : "var(--ink)" }}>
                  {pct}%
                </span>
              </div>
              <span className="h-[5px] rounded-full overflow-hidden" style={{ background: "var(--hair)" }}>
                <motion.span className="block h-full rounded-full"
                             initial={false} animate={{ width: `${Math.min(100, pct)}%` }}
                             transition={{ duration: 0.28, ease: [0.2, 0, 0, 1] }}
                             style={{ background: over ? "var(--warning)" : "var(--s1)" }} />
              </span>
              <span className="text-[10px]" style={{ color: over ? "var(--warning)" : "var(--muted)" }}>
                {over
                  ? `${fmtMin(after - SHIFT_MIN)} over the ${fmtMin(SHIFT_MIN)} shift — it will not fit as planned`
                  : `${fmtMin(Math.max(0, SHIFT_MIN - after))} left in the shift`}
              </span>
            </div>
          </div>

          <footer className="px-4 py-3 flex gap-2" style={{ borderTop: "1px solid var(--hair)" }}>
            <button onClick={onClose}
                    className="h-[30px] px-3 rounded-[var(--r-ctl)] text-[12px] text-[var(--muted)]
                               border border-[var(--hair-strong)] hover:text-[var(--ink)]">
              Cancel
            </button>
            <button onClick={save} disabled={!spec || qty <= 0}
                    className="ml-auto h-[30px] px-4 rounded-[var(--r-ctl)] text-[12px] font-[620]
                               disabled:opacity-40 transition-colors"
                    style={{ background: "var(--s1)", color: "#fff" }}>
              {editing ? "Save" : "Add to day"}
            </button>
          </footer>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
