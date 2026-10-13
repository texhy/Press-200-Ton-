"use client";
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { Source } from "@/components/ui";
import { loadDay, loadHistory, loadPlan, useAsync } from "@/lib/data";
import { loadFloor } from "@/lib/floor";
import { useCursor } from "@/lib/cursor";
import { INTENTS, route, type Answer, type Ctx } from "@/lib/assistant";

/** THE SHIFT ASSISTANT.
 *
 *  A closed-vocabulary assistant over the data already on the page. It does
 *  not call a model and it is not trying to be conversational: in a
 *  maintenance room the cost of a confident wrong answer is somebody walking
 *  to the wrong press, so every reply here is a pure function of day.json /
 *  history.json / plan.json / floor.json at the current playhead, and a
 *  question outside the vocabulary gets a refusal rather than a guess.
 *
 *  Each answer carries the same source chips as the screens, and a link that
 *  moves the playhead to the moment it is talking about — so the assistant is
 *  a way INTO the evidence, not a substitute for it. */

const TONE: Record<string, string> = {
  ok: "var(--good)", warning: "var(--warning)",
  critical: "var(--critical)", muted: "var(--muted)",
};

interface Turn { q: string; a: Answer | null; unknown?: string }

export function Assistant() {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const log = useRef<HTMLDivElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);

  const { data: day } = useAsync(loadDay);
  const { data: hist } = useAsync(loadHistory);
  const { data: plan } = useAsync(loadPlan);
  const { data: floor } = useAsync(loadFloor);
  const { t, setT } = useCursor();

  /* The context is read at ASK time, not subscribed to. An answer is about the
     moment it was asked about; having older replies silently rewrite
     themselves as the playhead moves would make the log a liar. */
  const ctx = useRef<Ctx>({ day, hist, plan, floor, t });
  useEffect(() => { ctx.current = { day, hist, plan, floor, t }; }, [day, hist, plan, floor, t]);

  const ask = useCallback((q: string, id?: string) => {
    const intent = id ? INTENTS.find((i) => i.id === id) ?? null : route(q);
    if (!intent) {
      setTurns((p) => [...p, { q, a: null, unknown: q }]);
      return;
    }
    setTurns((p) => [...p, { q: intent.q, a: intent.answer(ctx.current) }]);
  }, []);

  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [turns, open]);

  // Escape closes; focus moves to the input on open
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    panel.current?.querySelector("input")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const unused = useMemo(
    () => INTENTS.filter((i) => !turns.some((tn) => tn.a && tn.q === i.q)),
    [turns]);

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? "Close the shift assistant" : "Open the shift assistant"}
        className="fixed right-4 z-50 h-[42px] px-3.5 rounded-full flex items-center gap-2
                   text-[12px] font-[600] shadow-[var(--shadow-over)]
                   transition-transform hover:-translate-y-[1px] active:translate-y-0"
        style={{ bottom: "calc(var(--spine-h) + 14px)", background: "var(--s1)", color: "#fff" }}>
        <span aria-hidden className="text-[13px]">{open ? "✕" : "✦"}</span>
        {open ? "Close" : "Ask"}
      </button>

      {open && (
        <div ref={panel}
             role="dialog" aria-label="Shift assistant"
             className="assistant-panel fixed right-4 z-50 flex flex-col overflow-hidden
                        rounded-[var(--r-over)]"
             style={{
               bottom: "calc(var(--spine-h) + 66px)",
               width: "min(410px, calc(100vw - 32px))",
               maxHeight: "min(600px, calc(100vh - var(--topbar-h) - var(--spine-h) - 90px))",
               background: "var(--surface)",
               border: "1px solid var(--hair-strong)",
               boxShadow: "var(--shadow-over)",
             }}>
          <header className="px-3.5 py-2.5 flex items-baseline justify-between gap-2 shrink-0"
                  style={{ borderBottom: "1px solid var(--hair)" }}>
            <span className="text-[13px] font-[650]">Shift assistant</span>
            <span className="text-[10px] text-[var(--muted)]">answers from today&apos;s data</span>
          </header>

          <div ref={log} className="flex-1 overflow-y-auto px-3.5 py-3 flex flex-col gap-3">
            {turns.length === 0 && (
              <p className="m-0 text-[11px] text-[var(--muted)] leading-snug">
                I read the same files the screens do — so I cannot tell you anything
                they do not already know, and I will not guess. Pick a question:
              </p>
            )}

            {turns.map((tn, i) => (
              <div key={i} className="flex flex-col gap-2 assistant-turn">
                <p className="m-0 self-end max-w-[85%] px-2.5 py-1.5 rounded-[var(--r-ctl)] text-[12px]"
                   style={{ background: "var(--raised)", border: "1px solid var(--hair)" }}>
                  {tn.q}
                </p>
                {tn.a ? <AnswerBlock a={tn.a} onSeek={setT} /> : (
                  <div className="text-[11px] text-[var(--ink-2)] leading-snug">
                    <p className="m-0 mb-1.5">
                      I don&apos;t answer that one. I only report what is in today&apos;s data,
                      and making something up here would be worse than saying no.
                    </p>
                    <p className="m-0 text-[var(--muted)]">Try one of the buttons below.</p>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="shrink-0 px-3.5 pt-2.5 pb-3 flex flex-col gap-2"
               style={{ borderTop: "1px solid var(--hair)" }}>
            <div className="flex flex-wrap gap-1.5 max-h-[108px] overflow-y-auto">
              {(unused.length ? unused : INTENTS).map((i) => (
                <button key={i.id} onClick={() => ask(i.q, i.id)}
                        className="px-2 py-[5px] rounded-full text-[11px] text-left
                                   transition-colors hover:bg-[var(--raised)]"
                        style={{ border: "1px solid var(--hair-strong)", color: "var(--ink-2)" }}>
                  {i.q}
                </button>
              ))}
            </div>
            <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) { ask(text); setText(""); } }}
                  className="flex gap-1.5">
              <input value={text} onChange={(e) => setText(e.target.value)}
                     placeholder="or type a question…"
                     className="flex-1 h-[30px] px-2.5 rounded-[var(--r-ctl)] text-[12px] bg-transparent
                                outline-none focus-visible:border-[var(--s1)]"
                     style={{ border: "1px solid var(--hair-strong)", color: "var(--ink)" }} />
              <button type="submit"
                      className="h-[30px] px-3 rounded-[var(--r-ctl)] text-[11px] font-[600]"
                      style={{ background: "var(--s1)", color: "#fff" }}>Ask</button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function AnswerBlock({ a, onSeek }: { a: Answer; onSeek: (t: number) => void }) {
  return (
    <div className="flex flex-col gap-2 px-2.5 py-2 rounded-[var(--r-ctl)]"
         style={{ background: "var(--raised)", border: "1px solid var(--hair)" }}>
      <p className="m-0 text-[12.5px] font-[620] leading-snug">{a.headline}</p>

      {a.lines.length > 0 && (
        <dl className="m-0 flex flex-col gap-1">
          {a.lines.map((l, i) => (
            <div key={i} className="flex items-baseline justify-between gap-2 min-w-0">
              <dt className="m-0 text-[11px] text-[var(--muted)] min-w-0 flex items-center gap-1.5 flex-wrap">
                <span className="truncate">{l.label}</span>
                {l.source && <Source from={l.source} />}
              </dt>
              <dd className="m-0 text-[11.5px] tnum text-right shrink-0"
                  style={{ color: l.tone ? TONE[l.tone] : "var(--ink)" }}>
                {l.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {a.note && (
        <p className="m-0 text-[10.5px] text-[var(--muted)] leading-snug">{a.note}</p>
      )}

      {a.go && (
        <Link href={a.go.href}
              onClick={() => { if (a.seek !== undefined) onSeek(a.seek); }}
              className="text-[11px] text-[var(--s1)] self-start hover:underline">
          {a.go.label} →
        </Link>
      )}
    </div>
  );
}
