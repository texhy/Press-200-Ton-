"use client";
import type { Day, Gap, EvidenceStep } from "@/lib/types";
import { CAUSE_COLOR, CAUSE_LABEL, STATUS_COLOR } from "@/lib/palette";
import { useCursor, hhmmss } from "@/lib/cursor";
import { StatusPill, TrustChip } from "@/components/ui";
import { mins, pkr, secs } from "@/lib/format";

const SRC_LABEL = { plc: "PLC", vfd: "VFD", cv: "CAMERA", plan: "PLAN" } as const;
const KIND_TONE: Record<EvidenceStep["kind"], string> = {
  cause: "var(--critical)", consequence: "var(--muted)",
  action: "var(--s1)", resume: "var(--good)",
};

/** THE EVIDENCE CHAIN.
 *
 *  The first row is the cause; everything after is consequence. That ordering
 *  IS the argument, so the first row gets the status edge and full-contrast ink
 *  while the rest recede. Nobody has to take the classification on trust. */
export function EvidenceChain({ gap, onSeek }: { gap: Gap; onSeek?: (videoS: number) => void }) {
  return (
    <ol className="list-none m-0 p-0 flex flex-col">
      {gap.evidence.map((e, i) => {
        const first = i === 0;
        return (
          <li key={i} className="relative flex gap-2.5 pl-3 py-1.5"
              style={{ animation: `slideIn var(--t-base) var(--e-out) ${i * 24}ms both` }}>
            <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[2px]"
                  style={{ background: first ? KIND_TONE.cause : "var(--hair)" }} />
            <span className="readout text-[11px] shrink-0 w-[52px]"
                  style={{ color: first ? "var(--ink)" : "var(--muted)" }}>
              {hhmmss(e.t).slice(0, 5)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[12px]" style={{
                  color: first ? "var(--ink)" : "var(--ink-2)",
                  fontWeight: first ? 650 : 450,
                }}>{e.label}</span>
                <span className="text-[8px] font-[700] tracking-[0.06em] px-1 py-[1px] rounded"
                      style={{ color: "var(--muted)", border: "1px solid var(--hair)" }}>
                  {SRC_LABEL[e.src]}
                </span>
                {first && <span className="text-[8px] font-[700] tracking-[0.06em]"
                                style={{ color: KIND_TONE.cause }}>← CAUSE</span>}
              </span>
              <span className="block text-[11px] text-[var(--muted)] leading-snug">{e.detail}</span>
            </span>
            {e.seek !== undefined && onSeek && (
              <button onClick={() => onSeek(e.seek!)}
                      className="shrink-0 self-start text-[10px] px-1.5 py-[2px] rounded
                                 border border-[var(--hair-strong)] text-[var(--s3)] hover:bg-[var(--raised)]">
                ▣ watch
              </button>
            )}
          </li>
        );
      })}
      <style>{`@keyframes slideIn{from{opacity:0;transform:translateX(8px)}to{opacity:1;transform:none}}`}</style>
    </ol>
  );
}

export function GapCard({ gap, day, onSeek, onConfirm }: {
  gap: Gap; day: Day; onSeek?: (videoS: number) => void; onConfirm?: (id: string) => void;
}) {
  const unexplained = gap.cause === "unexplained";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="flex items-center gap-2 flex-wrap">
          <span aria-hidden className="w-[10px] h-[10px] rounded-sm"
                style={{ background: CAUSE_COLOR[gap.cause] }} />
          <h3 className="text-[15px] font-[650] m-0">{gap.label}</h3>
        </span>
        <span className="flex items-center gap-2 flex-wrap text-[11px] text-[var(--muted)]">
          <span className="readout">{hhmmss(gap.t0).slice(0, 5)}–{hhmmss(gap.t1).slice(0, 5)}</span>
          <span>·</span>
          <span>{mins(gap.cost.minutes)}</span>
          <span>·</span>
          <span>confidence {gap.confidence}</span>
          {gap.camera
            ? <TrustChip trust="measured" />
            : <TrustChip trust="simulated" />}
        </span>
      </div>

      {unexplained && (
        <div className="flex items-start gap-2 p-2.5 rounded-[var(--r-ctl)]"
             style={{ background: "color-mix(in oklab, var(--critical) 12%, transparent)",
                      border: "1px solid color-mix(in oklab, var(--critical) 30%, transparent)" }}>
          <span aria-hidden style={{ color: "var(--critical)" }}>■</span>
          <p className="m-0 text-[11px] text-[var(--ink-2)] leading-snug">
            Nothing in the PLC, the VFD or the camera explains this stop.
            It is counted, not guessed at — someone has to look.
          </p>
        </div>
      )}

      <dl className="grid grid-cols-4 gap-2 m-0">
        {[["Minutes", mins(gap.cost.minutes)], ["Strokes lost", gap.cost.strokes.toLocaleString("en-US")],
          ["Parts lost", gap.cost.parts.toLocaleString("en-US")], ["Idle cost", pkr(gap.cost.pkr)]].map(([k, v]) => (
          <div key={k as string} className="flex flex-col">
            <dt className="text-[10px] text-[var(--muted)] m-0">{k}</dt>
            <dd className="text-[14px] readout m-0">{v}</dd>
          </div>
        ))}
      </dl>

      <div>
        <p className="text-[10px] font-[700] tracking-[0.08em] text-[var(--muted)] mb-1 mt-0">EVIDENCE</p>
        <EvidenceChain gap={gap} onSeek={onSeek} />
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button onClick={() => onConfirm?.(gap.id)}
                className="h-[28px] px-3 rounded-[var(--r-ctl)] text-[11px] font-[550]
                           border border-[var(--hair-strong)] hover:bg-[var(--raised)]"
                style={{ color: gap.confirmed ? "var(--good)" : "var(--ink-2)" }}>
          {gap.confirmed ? "✓ confirmed" : "Confirm cause"}
        </button>
        <button className="h-[28px] px-3 rounded-[var(--r-ctl)] text-[11px]
                           border border-[var(--hair-strong)] text-[var(--ink-2)] hover:bg-[var(--raised)]">
          Reclassify
        </button>
      </div>
      <p className="text-[10px] text-[var(--muted)] leading-snug m-0">
        Confirming teaches the engine. Per-cause accuracy on the Downtime screen
        is built from these confirmations.
      </p>
    </div>
  );
}

/** Right-hand drawer. Slides in 240 ms; rows stagger 24 ms each. */
export function Inspector({ day, onSeek, onConfirm }: {
  day: Day; onSeek?: (videoS: number) => void; onConfirm?: (id: string) => void;
}) {
  const { openGap, openInspector, t } = useCursor();
  const gap = day.gaps.find((g) => g.id === openGap)
    ?? day.gaps.find((g) => t >= g.t0 && t < g.t1);
  const cur = day.minutes[Math.floor(t / 60)];

  return (
    <aside className="card p-4 flex flex-col gap-4 min-w-0">
      <header className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-[700] tracking-[0.08em] text-[var(--muted)] m-0">AT</p>
          <p className="readout text-[20px] m-0">{hhmmss(t)}</p>
        </div>
        {openGap && (
          <button onClick={() => openInspector(null)} aria-label="Close"
                  className="text-[var(--muted)] hover:text-[var(--ink)] text-[14px] leading-none">×</button>
        )}
      </header>

      {gap ? (
        <GapCard gap={gap} day={day} onSeek={onSeek} onConfirm={onConfirm} />
      ) : (
        <div className="flex flex-col gap-3">
          <StatusPill severity={(cur?.s ?? 0) > 0 ? "ok" : "warning"} dot>
            {(cur?.s ?? 0) > 0 ? "Producing" : cur?.motor ? "Motor on, no output" : "Stopped"}
          </StatusPill>
          <p className="text-[11px] text-[var(--muted)] m-0 leading-snug">
            No gap at this instant. Click a block on the REASONS lane, or step with the
            ◀ ▶ controls on the spine.
          </p>
        </div>
      )}

      {cur && (
        <div className="pt-3 mt-auto" style={{ borderTop: "1px solid var(--hair)" }}>
          <p className="text-[10px] font-[700] tracking-[0.08em] text-[var(--muted)] mb-2 mt-0">
            EVERY CHANNEL AT THIS MINUTE
          </p>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 m-0 text-[11px]">
            {[
              ["Status", cur.st], ["Mode", cur.mode],
              ["Motor", cur.motor ? "running" : "stopped"], ["Strokes", String(cur.s)],
              ["Power", `${cur.kw.toFixed(1)} kW`], ["Current", `${cur.amps.toFixed(1)} A`],
              ["Torque", `${cur.torque.toFixed(0)} %`], ["Freq", `${cur.hz.toFixed(2)} Hz`],
              ["PF", cur.pf ? cur.pf.toFixed(3) : "—"], ["DC bus", cur.dcbus ? `${cur.dcbus.toFixed(0)} V` : "—"],
              ["Operator", cur.present === null ? "no coverage" : `${cur.present}% present`],
              ["Part seen", cur.part ?? (cur.present === null ? "no coverage" : "none")],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-2 min-w-0">
                <dt className="text-[var(--muted)] m-0 shrink-0">{k}</dt>
                <dd className="m-0 tnum truncate text-right">{v}</dd>
              </div>
            ))}
          </dl>
          {cur.bits.length > 0 && (
            <p className="mt-2 mb-0 text-[11px]" style={{ color: "var(--serious)" }}>
              bits: {cur.bits.join(", ")}
            </p>
          )}
        </div>
      )}
    </aside>
  );
}
