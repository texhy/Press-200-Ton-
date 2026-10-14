"use client";
import type { ReportRow, Day } from "@/lib/types";
import type { Finding, MeasuredWindow } from "@/lib/findings";
import { partLabel } from "@/lib/format";

/** THE DOCUMENT.
 *
 *  Deliberately not themed. This is paper — white, black, serif numerals, A4
 *  proportions — because that is what it becomes the moment anyone prints it,
 *  and a preview that does not look like its output is a lie. The surrounding
 *  app stays dark; the sheet sits on it like a sheet on a desk.
 *
 *  Everything on it is aggregated, never per-minute. The old screen printed
 *  510 rows of PLC state, which is a debug log: useful when someone disputes a
 *  number, useless to the person who has to sign it off. */

const PAPER = {
  ink: "#111418",
  ink2: "#3d454e",
  muted: "#737d88",
  rule: "#dfe3e8",
  ruleStrong: "#b9c0c8",
  accent: "#1f5fa8",
  warn: "#9a5b00",
};

const fmtMin = (m: number) => {
  const r = Math.round(m);
  return r >= 60 ? `${Math.floor(r / 60)}h ${String(r % 60).padStart(2, "0")}m` : `${r}m`;
};
const n0 = (n: number) => Math.round(n).toLocaleString("en-US");
const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB",
    { day: "2-digit", month: "long", year: "numeric" });

export interface ReportScope {
  pressLabel: string;
  pressTonnage: number | string;
  instrumented: boolean;
  from: string;
  to: string;
  operator: string | "all";
  rows: ReportRow[];
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-[2px]">
      <span className="text-[7.5pt] uppercase tracking-[0.1em]" style={{ color: PAPER.muted }}>{label}</span>
      <span className="text-[10pt] font-[600]" style={{ color: PAPER.ink }}>{value}</span>
    </div>
  );
}

function Figure({ label, value, unit, note }: {
  label: string; value: string; unit?: string; note?: string;
}) {
  return (
    <div className="flex flex-col gap-[1px] py-2">
      <span className="text-[7.5pt] uppercase tracking-[0.09em]" style={{ color: PAPER.muted }}>{label}</span>
      <span className="text-[17pt] font-[680] leading-none tnum" style={{ color: PAPER.ink }}>
        {value}
        {unit && <span className="text-[9pt] font-[500] ml-1" style={{ color: PAPER.ink2 }}>{unit}</span>}
      </span>
      {note && <span className="text-[7.5pt] mt-[2px]" style={{ color: PAPER.muted }}>{note}</span>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="m-0 mb-2 pb-1 text-[8.5pt] font-[700] uppercase tracking-[0.12em]"
        style={{ color: PAPER.ink, borderBottom: `1.5px solid ${PAPER.ruleStrong}` }}>
      {children}
    </h2>
  );
}

type Row = [string, number, string, string?, string?, string?];

const th = "text-left text-[7.5pt] font-[700] uppercase tracking-[0.07em] py-1.5 px-2";
const td = "text-[9pt] py-[7px] px-2 align-top";

export function ReportDoc({ scope, day, findings = [], camDate, measured = null, watchedMin = 0, camWindow = "" }: {
  scope: ReportScope;
  day: Day | null;
  /** camera-only losses — shown when the recorded day is inside the range */
  findings?: Finding[];
  camDate?: string;
  /** minutes of footage the findings were measured from */
  /** when set, the whole document is built from the recorded window */
  measured?: MeasuredWindow | null;
  watchedMin?: number;
  /** "09:12–10:06" */
  camWindow?: string;
}) {
  const { rows } = scope;
  const single = scope.from === scope.to;

  // ---- totals across the selected range --------------------------------
  const t = rows.reduce((a, r) => ({
    strokes: a.strokes + r.strokes,
    produced: a.produced + r.produced,
    target: a.target + r.target,
    production: a.production + r.production_min,
    downtime: a.downtime + r.downtime_min,
    idle: a.idle + r.idle_min,
    plan: a.plan + r.plan_min,
    kwh: a.kwh + r.kwh,
    pkr: a.pkr + r.pkr,
  }), { strokes: 0, produced: 0, target: 0, production: 0, downtime: 0, idle: 0, plan: 0, kwh: 0, pkr: 0 });

  const oee = rows.length ? rows.reduce((a, r) => a + r.oee, 0) / rows.length : 0;
  const operators = [...new Set(rows.map((r) => r.operator))];

  // ---- per part, which is the question a report is actually asked ------
  const byPart = Object.values(
    rows.reduce((acc, r) => {
      const k = r.part;
      acc[k] ??= { part: k, process: r.process, days: 0, strokes: 0, produced: 0,
                   target: 0, min: 0 };
      acc[k].days += 1;
      acc[k].strokes += r.strokes;
      acc[k].produced += r.produced;
      acc[k].target += r.target;
      acc[k].min += r.production_min;
      return acc;
    }, {} as Record<string, { part: string; process: string; days: number; strokes: number;
                              produced: number; target: number; min: number }>),
  ).sort((a, b) => b.min - a.min);

  const totalKnown = t.production + t.downtime + t.idle;

  return (
    <article
      id="report-paper"
      className="mx-auto"
      style={{
        width: "210mm",
        minHeight: "297mm",
        padding: "16mm 15mm",
        background: "#ffffff",
        color: PAPER.ink,
        boxShadow: "0 24px 70px rgba(0,0,0,0.45)",
        fontFamily: "var(--font-sans, ui-sans-serif, system-ui, sans-serif)",
      }}
    >
      {/* ================= letterhead ================= */}
      <header className="flex items-start justify-between pb-3"
              style={{ borderBottom: `2px solid ${PAPER.ink}` }}>
        <div>
          <div className="text-[15pt] font-[760] tracking-[-0.01em] leading-none">
            PROCON ENGINEERING
          </div>
          <div className="text-[8pt] mt-[3px] tracking-[0.06em]" style={{ color: PAPER.muted }}>
            PRESS SHOP · PRODUCTION MONITORING
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11pt] font-[680] leading-none">Production Report</div>
          <div className="text-[8pt] mt-[4px]" style={{ color: PAPER.muted }}>
            {measured
              ? `${longDate(measured.date)} · ${measured.from}–${measured.to}`
              : single ? longDate(scope.from) : `${longDate(scope.from)} — ${longDate(scope.to)}`}
          </div>
        </div>
      </header>

      {/* ================= scope ================= */}
      <section className="grid gap-x-6 gap-y-3 py-4"
               style={{ gridTemplateColumns: "repeat(4, 1fr)",
                        borderBottom: `1px solid ${PAPER.rule}` }}>
        <Field label="Machine" value={`${scope.pressLabel} · ${scope.pressTonnage} T`} />
        <Field label="Operator" value={measured ? measured.operator
                                       : operators.length === 1 ? operators[0]
                                       : operators.length ? `${operators.length} operators` : "—"} />
        <Field label="Shift" value={measured ? measured.shift : day?.shift.label ?? "Shift A"} />
        <Field label={measured ? "Window watched" : "Days covered"}
               value={measured ? `${Math.round(measured.minutes)} min · ${measured.from}–${measured.to}`
                               : `${rows.length} ${rows.length === 1 ? "day" : "days"}`} />
      </section>

      {!scope.instrumented && (
        <p className="m-0 mt-3 px-3 py-2 text-[8.5pt] leading-snug"
           style={{ background: "#fff7e8", border: `1px solid #e8c98a`, color: PAPER.warn }}>
          <strong>No instrumentation on this machine.</strong> {scope.pressLabel} has no camera,
          PLC tap or drive link fitted. Nothing in this report is measured from it.
        </p>
      )}

      {/* ================= headline figures ================= */}
      {measured ? (
        <section className="mt-5">
          <SectionTitle>Measured in this window</SectionTitle>
          <div className="grid" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
            <Figure label="Strokes" value={n0(measured.strokes)} note="counted by the monitor" />
            <Figure label="Parts made" value={n0(measured.partsMade)}
                    note="counted across the die line" />
            <Figure label="Running rate" value={measured.spm.toFixed(2)} unit="spm"
                    note={`${measured.cycleS.toFixed(1)} s per cycle`} />
            <Figure label="Productive time" value={measured.productivePct.toFixed(0)} unit="%"
                    note="of the window watched" />
            <Figure label="Die changes" value={String(measured.dieChanges)} />
          </div>
        </section>
      ) : (
        <section className="mt-5">
          <SectionTitle>Output</SectionTitle>
          <div className="grid" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
            <Figure label="Strokes" value={n0(t.strokes)} />
            <Figure label="Parts produced" value={n0(t.produced)}
                    note={t.target ? `of ${n0(t.target)} planned` : undefined} />
            <Figure label="Running time" value={fmtMin(t.production)} />
            <Figure label="Downtime" value={fmtMin(t.downtime)} />
            <Figure label="OEE" value={oee.toFixed(1)} unit="%" note="availability × performance" />
          </div>
        </section>
      )}

      {/* ================= parts ================= */}
      {measured ? (
        <section className="mt-5">
          <SectionTitle>Part running</SectionTitle>
          <table className="w-full border-collapse">
            <thead>
              <tr style={{ borderBottom: `1px solid ${PAPER.ruleStrong}` }}>
                <th className={th} style={{ color: PAPER.ink2 }}>Part</th>
                <th className={th} style={{ color: PAPER.ink2 }}>Process</th>
                <th className={th} style={{ color: PAPER.ink2 }}>Die</th>
                <th className={`${th} text-right`} style={{ color: PAPER.ink2 }}>Strokes</th>
                <th className={`${th} text-right`} style={{ color: PAPER.ink2 }}>Parts made</th>
                <th className={`${th} text-right`} style={{ color: PAPER.ink2 }}>Rate</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: `1px solid ${PAPER.rule}` }}>
                <td className={`${td} font-[640]`}>{partLabel(measured.part)}</td>
                <td className={td} style={{ color: PAPER.ink2 }}>{measured.process}</td>
                <td className={td} style={{ color: PAPER.ink2 }}>{measured.die}</td>
                <td className={`${td} text-right tnum font-[640]`}>{n0(measured.strokes)}</td>
                <td className={`${td} text-right tnum font-[640]`}>{n0(measured.partsMade)}</td>
                <td className={`${td} text-right tnum`}>{measured.spm.toFixed(2)} spm</td>
              </tr>
            </tbody>
          </table>
          <p className="m-0 mt-2 text-[8pt] leading-snug" style={{ color: PAPER.muted }}>
            Parts are counted by the camera watching blanks cross the die line, not by a
            production counter. {measured.strokes} strokes were made in the same window — the
            difference is set-up jogs and strokes with no blank loaded.
          </p>
        </section>
      ) : (
      <section className="mt-5">
        <SectionTitle>Parts produced</SectionTitle>
        <table className="w-full border-collapse">
          <thead>
            <tr style={{ borderBottom: `1px solid ${PAPER.ruleStrong}` }}>
              <th className={th} style={{ color: PAPER.ink2 }}>Part</th>
              <th className={th} style={{ color: PAPER.ink2 }}>Process</th>
              <th className={`${th} text-right`} style={{ color: PAPER.ink2 }}>Runs</th>
              <th className={`${th} text-right`} style={{ color: PAPER.ink2 }}>Strokes</th>
              <th className={`${th} text-right`} style={{ color: PAPER.ink2 }}>Produced</th>
              <th className={`${th} text-right`} style={{ color: PAPER.ink2 }}>Planned</th>
              <th className={`${th} text-right`} style={{ color: PAPER.ink2 }}>Run time</th>
            </tr>
          </thead>
          <tbody>
            {byPart.map((p, i) => (
              <tr key={p.part} style={{ borderBottom: `1px solid ${PAPER.rule}`,
                                        background: i % 2 ? "#fafbfc" : "transparent" }}>
                <td className={`${td} font-[640]`}>{partLabel(p.part)}</td>
                <td className={td} style={{ color: PAPER.ink2 }}>{p.process}</td>
                <td className={`${td} text-right tnum`}>{p.days}</td>
                <td className={`${td} text-right tnum`}>{n0(p.strokes)}</td>
                <td className={`${td} text-right tnum font-[640]`}>{n0(p.produced)}</td>
                <td className={`${td} text-right tnum`} style={{ color: PAPER.muted }}>{n0(p.target)}</td>
                <td className={`${td} text-right tnum`}>{fmtMin(p.min)}</td>
              </tr>
            ))}
            {!byPart.length && (
              <tr><td className={td} colSpan={7} style={{ color: PAPER.muted }}>
                No production in this period.
              </td></tr>
            )}
          </tbody>
          {byPart.length > 1 && (
            <tfoot>
              <tr style={{ borderTop: `1.5px solid ${PAPER.ruleStrong}` }}>
                <td className={`${td} font-[700]`} colSpan={3}>Total</td>
                <td className={`${td} text-right tnum font-[700]`}>{n0(t.strokes)}</td>
                <td className={`${td} text-right tnum font-[700]`}>{n0(t.produced)}</td>
                <td className={`${td} text-right tnum font-[700]`}>{n0(t.target)}</td>
                <td className={`${td} text-right tnum font-[700]`}>{fmtMin(t.production)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </section>
      )}

      {/* ================= where the time went ================= */}
      <section className="mt-5" style={{ breakInside: "avoid" }}>
        <SectionTitle>Where the time went</SectionTitle>

        {measured && (
          <p className="m-0 mb-2.5 text-[8.5pt] leading-snug" style={{ color: PAPER.ink2 }}>
            Every minute below is attributed from the footage. Only{" "}
            <strong>{measured.productivePct.toFixed(0)}%</strong> of the window made parts.
          </p>
        )}
        <table className="w-full border-collapse">
          <tbody>
            {(measured
              ? measured.slices.map((sl) =>
                  [sl.label, sl.minutes, sl.color, sl.note, sl.when, sl.cameraOnly] as Row)
              : ([
                  ["Running", t.production, PAPER.accent],
                  ["Downtime", t.downtime, "#b4472f"],
                  ["Idle — motor on, no output", t.idle, "#9a5b00"],
                ] as Row[])
            ).map(([label, mins, color, note, when, cameraOnly]) => {
              const base = measured ? measured.minutes : totalKnown;
              const pct = base ? (mins / base) * 100 : 0;
              return (
                <tr key={label} style={{ borderBottom: `1px solid ${PAPER.rule}` }}>
                  <td className={td} style={{ width: "44%" }}>
                    <div className="flex items-baseline gap-1.5">
                      {cameraOnly && (
                        <span aria-hidden className="text-[8pt] leading-none"
                              style={{ color: "#b4472f" }}>&#9873;</span>
                      )}
                      <span className={measured ? "font-[640]" : ""}>{label}</span>
                      {when && (
                        <span className="text-[7.5pt] tnum" style={{ color: PAPER.muted }}>{when}</span>
                      )}
                    </div>
                    {note && (
                      <div className="text-[8pt] leading-snug mt-[2px]" style={{ color: PAPER.ink2 }}>
                        {note}
                      </div>
                    )}
                    {cameraOnly && (
                      <div className="text-[7.5pt] leading-snug mt-[3px] pl-2"
                           style={{ color: PAPER.muted, borderLeft: `2px solid ${PAPER.rule}` }}>
                        {cameraOnly}
                      </div>
                    )}
                  </td>
                  <td className={td} style={{ width: "34%" }}>
                    <span className="block h-[7px] rounded-[2px]" style={{ background: "#eceff2" }}>
                      <span className="block h-full rounded-[2px]"
                            style={{ width: `${Math.min(100, pct)}%`, background: color }} />
                    </span>
                  </td>
                  <td className={`${td} text-right tnum font-[620]`}>{fmtMin(mins)}</td>
                  <td className={`${td} text-right tnum`} style={{ color: PAPER.muted, width: "12%" }}>
                    {pct.toFixed(0)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* the flag's meaning, and the statistics that are not slices of clock */}
        {measured && measured.slices.some((sl) => sl.cameraOnly) && (
          <p className="m-0 mt-2 text-[8pt]" style={{ color: PAPER.muted }}>
            <span style={{ color: "#b4472f" }}>&#9873;</span>{" "}
            Not visible on any PLC or drive register — these exist only because of the camera.
          </p>
        )}

        {findings.filter((f) => f.minutes == null).map((f) => (
          <div key={f.id} className="flex gap-3 pt-3 mt-3"
               style={{ borderTop: `1px solid ${PAPER.ruleStrong}` }}>
            <div className="shrink-0 w-[24mm] text-right text-[15pt] font-[700] leading-none tnum"
                 style={{ color: "#b4472f" }}>
              {f.value}
            </div>
            <div className="min-w-0">
              <div className="text-[9.5pt] font-[650] leading-snug">{f.title}</div>
              <div className="text-[8.5pt] leading-snug mt-[2px]" style={{ color: PAPER.ink2 }}>
                {f.detail}
              </div>
              <div className="text-[7.5pt] leading-snug mt-[3px] pl-2"
                   style={{ color: PAPER.muted, borderLeft: `2px solid ${PAPER.rule}` }}>
                {f.onlyCamera}
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* ================= day log ================= */}
      {!measured && (
      <section className="mt-5" style={{ breakInside: "avoid" }}>
        <SectionTitle>{single ? "The day" : "Day by day"}</SectionTitle>
        <table className="w-full border-collapse">
          <thead>
            <tr style={{ borderBottom: `1px solid ${PAPER.ruleStrong}` }}>
              <th className={th} style={{ color: PAPER.ink2 }}>Date</th>
              <th className={th} style={{ color: PAPER.ink2 }}>Part</th>
              <th className={th} style={{ color: PAPER.ink2 }}>Operator</th>
              <th className={`${th} text-right`} style={{ color: PAPER.ink2 }}>Made</th>
              <th className={`${th} text-right`} style={{ color: PAPER.ink2 }}>Run</th>
              <th className={`${th} text-right`} style={{ color: PAPER.ink2 }}>Down</th>
              <th className={`${th} text-right`} style={{ color: PAPER.ink2 }}>OEE</th>
              <th className={th} style={{ color: PAPER.ink2 }}>Main loss</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.date} style={{ borderBottom: `1px solid ${PAPER.rule}`,
                                        background: i % 2 ? "#fafbfc" : "transparent" }}>
                <td className={`${td} tnum`}>
                  {new Date(`${r.date}T00:00:00`)
                    .toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                </td>
                <td className={td}>{partLabel(r.part)}</td>
                <td className={td} style={{ color: PAPER.ink2 }}>{r.operator}</td>
                <td className={`${td} text-right tnum`}>{n0(r.produced)}</td>
                <td className={`${td} text-right tnum`}>{fmtMin(r.production_min)}</td>
                <td className={`${td} text-right tnum`}>{fmtMin(r.downtime_min)}</td>
                <td className={`${td} text-right tnum font-[640]`}>{r.oee.toFixed(0)}%</td>
                <td className={td} style={{ color: PAPER.muted }}>
                  {r.top_cause.replace(/_/g, " ")} · {fmtMin(r.top_cause_min)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      )}

      {/* ================= energy ================= */}
      {!measured && (
      <section className="mt-5">
        <SectionTitle>Energy</SectionTitle>
        <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          <Figure label="Consumed" value={t.kwh.toFixed(1)} unit="kWh" />
          <Figure label="Cost" value={`Rs ${n0(t.pkr)}`} />
          <Figure label="Per 1,000 strokes"
                  value={t.strokes ? (t.kwh / t.strokes * 1000).toFixed(2) : "—"} unit="kWh" />
        </div>
      </section>

      )}

      {/* ================= footer ================= */}
      <footer className="mt-7 pt-2.5 flex items-start justify-between text-[7.5pt]"
              style={{ borderTop: `1px solid ${PAPER.rule}`, color: PAPER.muted }}>
        <span className="max-w-[118mm] leading-snug">
          {measured
            ? "Every figure above is measured from the vision pass over the recorded window. No PLC, drive or planning data is used anywhere in this report."
            : "Camera channel measured from the recorded window; PLC and drive channels are simulated from the camera's own stroke cadence. Quality is not measured — OEE is availability × performance only."}
        </span>
        <span className="text-right shrink-0">
          Generated {longDate(new Date().toISOString().slice(0, 10))}<br />
          {scope.pressLabel}
        </span>
      </footer>
    </article>
  );
}
