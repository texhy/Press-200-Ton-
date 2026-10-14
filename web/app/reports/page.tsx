"use client";
import { useMemo, useState } from "react";
import { Shell } from "@/components/shell/Shell";
import { Card } from "@/components/ui";
import { loadCv, loadDay, loadHistory, useAsync } from "@/lib/data";
import { detectFindings, measuredWindow } from "@/lib/findings";
import { loadFloor } from "@/lib/floor";
import { Dropdown } from "@/components/planner/Dropdown";
import { ReportDoc, type ReportScope } from "@/components/reports/ReportDoc";
import { partLabel } from "@/lib/format";

/** REPORTS.
 *
 *  This screen used to print the minute-by-minute PLC log — 510 rows of mode,
 *  motor, amps and torque. That is the right artefact when an engineer disputes
 *  a number and the wrong one for everybody else, which is most of the people a
 *  report gets handed to.
 *
 *  So: filters, then a sheet of paper. The preview IS the output — same A4
 *  geometry, same white, same type — and printing it is the download, which is
 *  why it needs no PDF library and cannot drift from what was on screen. */

const PRINT_CSS = `
@media print {
  @page { size: A4; margin: 0; }
  body { background: #fff !important; }
  body * { visibility: hidden !important; }
  #report-paper, #report-paper * { visibility: visible !important; }
  #report-paper {
    position: absolute !important; left: 0; top: 0;
    margin: 0 !important; box-shadow: none !important;
    width: 210mm !important;
  }
  #report-paper section, #report-paper table { break-inside: avoid; }
}`;

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const pretty = (s: string) =>
  new Date(`${s}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

type RangeKey = "measured" | "last7" | "last30" | "custom";

export default function ReportsPage() {
  const { data: day } = useAsync(loadDay);
  const { data: hist } = useAsync(loadHistory);
  const { data: floor } = useAsync(loadFloor);
  const { data: cv } = useAsync(loadCv);

  const presses = floor?.stations ?? [];
  const instrumented = presses.find((p) => p.instrumented) ?? presses[presses.length - 1];

  const [pressId, setPressId] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>("measured");
  const [onDate, setOnDate] = useState<string | null>(null);
  const [operator, setOperator] = useState<string>("all");

  const rowsAll = hist?.rows ?? [];
  const dates = rowsAll.map((r) => r.date);
  const latest = dates[dates.length - 1];

  const press = presses.find((p) => p.id === pressId) ?? instrumented;
  const theDate = onDate ?? latest;

  const rows = useMemo(() => {
    if (!rowsAll.length) return [];
    // a press with nothing fitted has no measurements to report
    if (press && !press.instrumented) return [];
    let out = rowsAll;
    if (range === "custom") out = out.filter((r) => r.date === theDate);
    else out = out.slice(range === "last7" ? -7 : -30);
    if (operator !== "all") out = out.filter((r) => r.operator === operator);
    return out;
  }, [rowsAll, range, theDate, operator, press]);

  const operators = useMemo(
    () => [...new Set(rowsAll.map((r) => r.operator))].sort(), [rowsAll]);

  /** camera-only losses, shown only when the recorded day is inside the range
   *  and the selected press is the instrumented one — the footage covers one
   *  window on one machine, and implying otherwise would be a lie */
  const camDate = day?.date;
  const camInRange = !!camDate && rows.some((r) => r.date === camDate);
  /** the recorded window — the only part of this app that is not simulated */
  const measured = useMemo(
    () => (range === "measured" && press?.instrumented ? measuredWindow(cv, day ?? null) : null),
    [range, press, cv, day]);

  const findings = useMemo(
    () => ((measured || camInRange) && press?.instrumented ? detectFindings(cv, day ?? null) : []),
    [measured, camInRange, press, cv, day],
  );

  /** the window the findings were measured from */
  const watchedMin = day ? day.camera.end_min - day.camera.start_min : 0;
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const camWindow = day ? `${hhmm(day.camera.start_min)}\u2013${hhmm(day.camera.end_min)}` : "";

  const scope: ReportScope = {
    pressLabel: press?.label ?? "Press 200",
    pressTonnage: press?.tonnage ?? 200,
    instrumented: !!press?.instrumented,
    from: rows[0]?.date ?? theDate ?? "",
    to: rows[rows.length - 1]?.date ?? theDate ?? "",
    operator,
    rows,
  };

  if (!hist || !floor) return <Shell day={day ?? null}><Card title="Loading…" /></Shell>;

  return (
    <Shell day={day ?? null} wide>
      <style>{PRINT_CSS}</style>

      <header className="mt-7 mb-5 print:hidden">
        <h1 className="m-0 text-[30px] font-[680] leading-[1.1] tracking-[-0.02em]">
          Reports
        </h1>
        <p className="m-0 mt-1.5 text-[13px] text-[var(--muted)]">
          Pick a machine and a period. What you see below is the printed page.
        </p>
      </header>

      {/* ---------------- filters ---------------- */}
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <Dropdown label="MACHINE" width={210} value={press?.id ?? ""}
                  onChange={setPressId}
                  options={presses.map((p) => ({
                    value: p.id,
                    label: p.label,
                    hint: `${p.tonnage} T`,
                    badge: p.instrumented ? "live" : undefined,
                  }))} />

        <Dropdown label="PERIOD" width={190} value={range}
                  onChange={(v) => setRange(v as RangeKey)}
                  options={[
                    { value: "measured", label: "Recorded window", hint: "measured" },
                    { value: "last7", label: "Last 7 days", hint: "simulated" },
                    { value: "last30", label: "Last 30 days", hint: "simulated" },
                    { value: "custom", label: "A single day", hint: "simulated" },
                  ]} />

        {range === "custom" && (
          <Dropdown label="DATE" width={210} value={theDate ?? ""}
                    onChange={setOnDate}
                    options={[...dates].reverse().map((d) => ({ value: d, label: pretty(d) }))} />
        )}

        <Dropdown label="OPERATOR" width={190} value={operator}
                  onChange={setOperator}
                  options={[{ value: "all", label: "All operators" },
                            ...operators.map((o) => ({ value: o, label: o }))]} />

        <button
          onClick={() => window.print()}
          disabled={!rows.length && !measured}
          className="ml-auto h-[38px] px-4 rounded-[10px] text-[13px] font-[620]
                     disabled:opacity-40 transition-colors flex items-center gap-2"
          style={{ background: "var(--s1)", color: "#fff" }}>
          <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden>
            <path d="M7 1v8M3.6 6.1L7 9.5l3.4-3.4M1.6 12.4h10.8" fill="none"
                  stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Download PDF
        </button>
      </div>

      <p className="m-0 mt-2.5 text-[11.5px] text-[var(--muted)] print:hidden">
        {rows.length
          ? <>Showing <strong className="text-[var(--ink-2)]">{rows.length}</strong>{" "}
              {rows.length === 1 ? "day" : "days"}
              {operator !== "all" && <> for <strong className="text-[var(--ink-2)]">{operator}</strong></>}.
              {" "}Download opens your browser&apos;s print dialog — choose
              <strong className="text-[var(--ink-2)]"> Save as PDF</strong>.</>
          : press && !press.instrumented
            ? <>{press.label} has no camera, PLC tap or drive link fitted — there is nothing measured to report.</>
            : <>No days match these filters.</>}
      </p>

      {/* ---------------- the sheet ---------------- */}
      <div className="mt-5 pb-8 overflow-x-auto">
        <ReportDoc scope={scope} day={day ?? null} measured={measured}
                   findings={findings} camDate={camDate}
                   watchedMin={watchedMin} camWindow={camWindow} />
      </div>
    </Shell>
  );
}
