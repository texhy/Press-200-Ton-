"use client";
import { motion } from "framer-motion";
import type { JobCard, PartSpec } from "@/lib/kanbanStore";
import { SHIFT_MIN } from "@/lib/kanbanStore";
import { partLabel, n0 } from "@/lib/format";

/** ONE JOB.
 *
 *  Sized to be read, not scanned at a glance from across a dashboard. Three
 *  lines, in the order someone actually asks them: what part, how much and how
 *  long, and on what die. The shift is a tag rather than a field because it is
 *  the one categorical thing on the card — the same role the type chip plays on
 *  a project board.
 *
 *  Everything else — energy, operator, feasibility maths — lives in the editor.
 *  A card that answers every possible question answers none of them quickly. */

const fmtMin = (m: number) =>
  m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;

export function JobCardView({
  card, spec, onEdit, onRemove, onDragStart, onDragMove, onDragEnd,
}: {
  card: JobCard;
  spec?: PartSpec;
  onEdit: () => void;
  onRemove: () => void;
  onDragStart?: (id: string) => void;
  /** viewport point, straight from framer-motion — no DOM sniffing */
  onDragMove?: (p: { x: number; y: number }) => void;
  onDragEnd?: (id: string, p: { x: number; y: number }) => void;
}) {
  const over = card.estMin > SHIFT_MIN;
  const measured = (spec?.spm_trust ?? "estimated") === "measured";
  const tint = card.shift === "A" ? "var(--s1)" : "var(--s7)";

  return (
    <motion.article
      layout
      drag
      dragSnapToOrigin
      dragElastic={0.1}
      whileDrag={{ scale: 1.03, zIndex: 40, cursor: "grabbing" }}
      whileHover={{ y: -1 }}
      transition={{ type: "spring", stiffness: 520, damping: 38 }}
      onDragStart={() => onDragStart?.(card.id)}
      onDrag={(_, info) => onDragMove?.(info.point)}
      onDragEnd={(_, info) => onDragEnd?.(card.id, info.point)}
      data-card-id={card.id}
      onDoubleClick={onEdit}
      className="group relative rounded-[10px] select-none"
      style={{
        background: "var(--raised)",
        border: `1px solid ${over ? "var(--warning)" : "var(--hair)"}`,
        cursor: "grab",
      }}
    >
      <div className="p-3.5 flex flex-col gap-2.5">
        {/* ---- title + shift tag ------------------------------------- */}
        <div className="flex items-start gap-2">
          <h4 className="m-0 text-[14px] font-[620] leading-[1.25] flex-1 min-w-0">
            {partLabel(card.part)}
          </h4>
          <span className="shrink-0 text-[9.5px] font-[700] tracking-[0.06em] px-2 py-[3px] rounded-[5px]"
                style={{ color: tint, background: `color-mix(in srgb, ${tint} 15%, transparent)` }}>
            SHIFT {card.shift}
          </span>
        </div>

        {/* ---- the two numbers that matter --------------------------- */}
        <div className="flex items-baseline gap-2.5 text-[12.5px]">
          <span className="tnum font-[560] text-[var(--ink-2)]">{n0(card.qty)} pcs</span>
          <span className="opacity-30">·</span>
          <span className="tnum font-[560]" style={{ color: over ? "var(--warning)" : "var(--ink-2)" }}>
            {fmtMin(card.estMin)}
          </span>
          {card.estManual && (
            <span className="text-[10px] text-[var(--muted)]">manual</span>
          )}
        </div>

        {/* ---- footer: die + how much to trust the rate --------------- */}
        <div className="flex items-center gap-2 pt-2.5 text-[11px]"
             style={{ borderTop: "1px solid var(--hair)" }}>
          <span className="text-[var(--muted)]">{card.die}</span>
          <span className="ml-auto flex items-center gap-1.5"
                style={{ color: measured ? "var(--s3)" : "var(--muted)" }}>
            <i aria-hidden className="w-[5px] h-[5px] rounded-full"
               style={{ background: measured ? "var(--s3)" : "var(--muted)" }} />
            {measured ? "measured" : "estimated"}
          </span>
        </div>
      </div>

      {/* hover actions — absent at rest so a column reads as work, not UI */}
      <div className="absolute right-2 top-2 flex gap-1 opacity-0 group-hover:opacity-100
                      transition-opacity duration-[var(--t-fast)]">
        <button onClick={(e) => { e.stopPropagation(); onEdit(); }} aria-label="Edit job"
                className="w-[24px] h-[24px] rounded-[6px] text-[11px] leading-none
                           border border-[var(--hair-strong)] bg-[var(--surface)] text-[var(--muted)]
                           hover:border-[var(--s1)] hover:text-[var(--s1)] transition-colors">✎</button>
        <button onClick={(e) => { e.stopPropagation(); onRemove(); }} aria-label="Remove job"
                className="w-[24px] h-[24px] rounded-[6px] text-[11px] leading-none
                           border border-[var(--hair-strong)] bg-[var(--surface)] text-[var(--muted)]
                           hover:border-[var(--critical)] hover:text-[var(--critical)] transition-colors">✕</button>
      </div>
    </motion.article>
  );
}
