"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { loadDay, useAsync } from "@/lib/data";
import { useCursor, hhmmss } from "@/lib/cursor";
import { STRINGS, type Lang, MACHINE_CAUSED } from "@/lib/i18n";
import { CAUSE_COLOR, CAUSE_LABEL } from "@/lib/palette";
import { mins, n0, partLabel } from "@/lib/format";

/** OPERATOR VIEW — deliberately plainer than the manager side.
 *  Big type, high contrast, readable at 2 m on a cheap panel in bad light.
 *  Six numbers and ONE instruction. No charts beyond a minute strip. */
export default function OperatorPage() {
  const { data: day } = useAsync(loadDay);
  const [lang, setLang] = useState<Lang>("en");
  const { t, setT } = useCursor();
  const T = STRINGS[lang];

  const cur = day?.minutes[Math.floor(t / 60)];
  const made = useMemo(
    () => day ? day.minutes.filter((m) => m.m <= Math.floor(t / 60)).reduce((a, m) => a + m.s, 0) : 0,
    [day, t]);

  const split = useMemo(() => {
    if (!day) return { mine: 0, machine: 0, unknown: 0 };
    let mine = 0, machine = 0, unknown = 0;
    const now = Math.floor(t / 60);
    for (const g of day.gaps) {
      if (g.cause === "break" || g.m0 > now) continue;     // nothing from the future
      const m = Math.min(g.cost.minutes, now - g.m0 + 1);
      if (g.cause === "unexplained") unknown += m;
      else if (MACHINE_CAUSED.has(g.cause)) machine += m;
      else mine += m;
    }
    return { mine, machine, unknown };
  }, [day, t]);

  const active = day?.gaps.find((g) => t >= g.t0 && t < g.t1);

  if (!day || !cur) {
    return <main className="min-h-screen grid place-items-center text-[var(--muted)]">loading…</main>;
  }

  const target = day.job.target;
  const progress = Math.min(100, (made / target) * 100);
  const planSpm = 60 / day.job.takt_sec;
  const behind = made < (target * (t - day.shift.m0 * 60)) / ((day.shift.m1 - day.shift.m0) * 60);

  const instruction = !cur.motor ? { text: lang === "en" ? "Machine is stopped — call the supervisor" : "مشین بند ہے — سپروائزر کو بلائیں", sev: "critical" }
    : active && MACHINE_CAUSED.has(active.cause) ? { text: `${CAUSE_LABEL[active.cause]} — ${lang === "en" ? "not your fault, wait for the fix" : "آپ کی غلطی نہیں، انتظار کریں"}`, sev: "warning" }
    : cur.present !== null && cur.present < 20 ? { text: lang === "en" ? "Return to the station" : "اسٹیشن پر واپس آئیں", sev: "warning" }
    : cur.s === 0 ? { text: lang === "en" ? "Press is not stroking — check the feed" : "پریس نہیں چل رہا — فیڈ چیک کریں", sev: "warning" }
    : { text: T.allGood, sev: "ok" };

  const SEV: Record<string, string> = { ok: "var(--good)", warning: "var(--warning)", critical: "var(--critical)" };

  return (
    <main dir={T.dir} className="min-h-screen p-5"
          style={{ fontFamily: T.urdu ? "var(--font-urdu), serif" : undefined,
                   lineHeight: T.urdu ? 2.0 : undefined }}>
      <header className="flex items-center gap-4 flex-wrap mb-5">
        <h1 className="text-[22px] font-[700] m-0">{T.title}</h1>
        <span className="text-[14px] text-[var(--muted)]">Press 200 · {day.operator.name}</span>
        <span className="readout text-[20px] ml-auto">{hhmmss(t).slice(0, 5)}</span>
        <button onClick={() => setLang(lang === "en" ? "ur" : "en")}
                className="h-[34px] px-4 rounded-[var(--r-ctl)] text-[14px] border border-[var(--hair-strong)]
                           hover:bg-[var(--raised)]">
          {T.lang}
        </button>
        <Link href="/live" className="h-[34px] px-4 grid place-items-center rounded-[var(--r-ctl)]
                                      text-[13px] text-[var(--muted)] border border-[var(--hair)]">
          ◉ manager view
        </Link>
      </header>

      {/* ---------- ONE instruction, nothing else ---------- */}
      <section className="card p-5 mb-4 relative overflow-hidden">
        <span aria-hidden className="absolute inset-y-0 start-0 w-[5px]" style={{ background: SEV[instruction.sev] }} />
        <p className="m-0 text-[13px] text-[var(--muted)]">{T.doNow}</p>
        <p className="m-0 text-[26px] font-[650] leading-tight" style={{ color: SEV[instruction.sev] }}>
          {instruction.text}
        </p>
      </section>

      {/* ---------- the job + the big numbers ---------- */}
      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))" }}>
        <section className="card p-5">
          <p className="m-0 text-[13px] text-[var(--muted)]">{T.todaysJob}</p>
          <p className="m-0 text-[28px] font-[650] leading-tight">{partLabel(day.job.part)}</p>
          <p className="m-0 text-[14px] text-[var(--ink-2)]">{T.die} {day.job.die}</p>
        </section>

        <section className="card p-5">
          <p className="m-0 text-[13px] text-[var(--muted)]">{T.made}</p>
          <p className="m-0 text-[44px] font-[650] leading-none">{n0(made)}</p>
          <p className="m-0 text-[14px] text-[var(--muted)]">{T.target}: {n0(target)}</p>
          <div className="h-[10px] rounded-full overflow-hidden mt-2" style={{ background: "var(--q700)" }}>
            <div className="h-full rounded-full" style={{ width: `${progress}%`,
                 background: behind ? "var(--warning)" : "var(--good)", transition: "width var(--t-slow) var(--e-out)" }} />
          </div>
          <p className="m-0 mt-1.5 text-[14px] font-[600]" style={{ color: behind ? "var(--warning)" : "var(--good)" }}>
            {behind ? T.behind : T.onTrack} · {T.remaining} {n0(Math.max(0, target - made))}
          </p>
        </section>

        <section className="card p-5">
          <p className="m-0 text-[13px] text-[var(--muted)]">{T.pace}</p>
          <p className="m-0 text-[44px] font-[650] leading-none readout">{cur.spm.toFixed(0)}</p>
          <p className="m-0 text-[14px] text-[var(--muted)]">{T.perMin} · {T.targetPace} {planSpm.toFixed(0)}</p>
        </section>

        <section className="card p-5">
          <p className="m-0 text-[13px] text-[var(--muted)]">{T.status}</p>
          <p className="m-0 text-[24px] font-[650] leading-tight"
             style={{ color: cur.present === null ? "var(--muted)"
                      : cur.present < 20 ? "var(--critical)"
                      : cur.s > 0 ? "var(--good)" : "var(--warning)" }}>
            {cur.present === null ? T.noCamera : cur.present < 20 ? T.away : cur.s > 0 ? T.working : T.idle}
          </p>
          <p className="m-0 mt-2 text-[13px] text-[var(--muted)]">{T.material}</p>
          <p className="m-0 text-[18px] font-[600]"
             style={{ color: cur.motor ? "var(--s3)" : "var(--warning)" }}>
            {cur.motor ? T.present : T.none}
          </p>
        </section>
      </div>

      {/* ---------- three buckets: theirs, the machine's, and unknown ------- */}
      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))" }}>
        <section className="card p-5">
          <p className="m-0 text-[13px] text-[var(--muted)]">{T.machineWaiting}</p>
          <p className="m-0 text-[36px] font-[650] leading-none" style={{ color: "var(--s2)" }}>
            {mins(split.machine)}
          </p>
          <p className="m-0 text-[13px] text-[var(--muted)]">{T.waitingNote}</p>
        </section>
        <section className="card p-5">
          <p className="m-0 text-[13px] text-[var(--muted)]">{T.myTime}</p>
          <p className="m-0 text-[36px] font-[650] leading-none">{mins(split.mine)}</p>
        </section>
        <section className="card p-5">
          <p className="m-0 text-[13px] text-[var(--muted)]">{T.notExplained}</p>
          <p className="m-0 text-[36px] font-[650] leading-none text-[var(--muted)]">{mins(split.unknown)}</p>
          <p className="m-0 text-[13px] text-[var(--muted)]">{T.notExplainedNote}</p>
        </section>
      </div>

      {/* ---------- my day, as a plain minute strip ---------- */}
      <section className="card p-5">
        <p className="m-0 text-[13px] text-[var(--muted)] mb-2">{T.myDay}</p>
        <div className="flex gap-[1px] h-[36px] rounded-[3px] overflow-hidden" dir="ltr">
          {day.minutes.filter((m) => m.m >= day.shift.m0 && m.m < day.shift.m1).map((m) => {
            const future = m.m > Math.floor(t / 60);
            const g = day.gaps.find((x) => m.m * 60 >= x.t0 && m.m * 60 < x.t1);
            const col = future ? "var(--grid)"
              : m.s > 0 ? "var(--good)"
              : g ? CAUSE_COLOR[g.cause] : m.motor ? "var(--s2)" : "var(--grid)";
            return (
              <button key={m.m} onClick={() => setT(m.m * 60)}
                      title={`${hhmmss(m.m * 60).slice(0, 5)} — ${future ? "not yet" : g ? CAUSE_LABEL[g.cause] : m.s > 0 ? "running" : "stopped"}`}
                      className="flex-1 min-w-[1px]" style={{ background: col, opacity: future ? 0.35 : 1 }} />
            );
          })}
        </div>
        <div className="flex gap-4 mt-2 text-[12px] text-[var(--muted)] flex-wrap" dir="ltr">
          <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded-sm inline-block" style={{ background: "var(--good)" }} /> {T.working}</span>
          <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded-sm inline-block" style={{ background: "var(--s2)" }} /> {T.machineWaiting}</span>
          <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded-sm inline-block" style={{ background: "var(--grid)" }} /> stopped</span>
          <span className="flex items-center gap-1.5 opacity-50"><i className="w-3 h-3 rounded-sm inline-block" style={{ background: "var(--grid)" }} /> not yet</span>
        </div>
        <p className="m-0 mt-3 text-[12px] text-[var(--muted)]">{T.note}</p>
      </section>
    </main>
  );
}
