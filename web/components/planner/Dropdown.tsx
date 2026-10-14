"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

/** A SELECT THAT BELONGS TO THIS UI.
 *
 *  A native <select> is correct and free, but its popup is drawn by the OS: on
 *  macOS that is a light grey list dropped into the middle of a dark board.
 *  There is no styling hook for it, so the only way to keep the surface
 *  coherent is to own the menu.
 *
 *  What the native control gave away has to be put back by hand, so it is:
 *  roving focus with the arrow keys, Home/End, type-ahead, Enter/Escape,
 *  aria-activedescendant, and the list scrolled to keep the active row in view.
 *  Anything less is a worse control than the one it replaced. */

export interface Option {
  value: string;
  label: string;
  /** dimmed text after the label — dates, ranges */
  hint?: string;
  /** small pill at the end — counts */
  badge?: string | number;
}

export function Dropdown({
  label, value, options, onChange, width = 200,
}: {
  label: string;
  value: string;
  options: Option[];
  onChange: (v: string) => void;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement | null>(null);
  const list = useRef<HTMLUListElement | null>(null);
  const typed = useRef({ q: "", at: 0 });

  const selected = options.findIndex((o) => o.value === value);
  const current = options[selected] ?? options[0];

  // open on the current row, not the top
  useLayoutEffect(() => { if (open) setActive(Math.max(0, selected)); }, [open, selected]);

  // keep the active row visible while arrowing through a long month list
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  // click away
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const commit = (i: number) => { onChange(options[i].value); setOpen(false); };

  const onKey = (e: React.KeyboardEvent) => {
    const last = options.length - 1;
    switch (e.key) {
      case "ArrowDown": e.preventDefault();
        if (!open) { setOpen(true); break; }
        setActive((i) => Math.min(last, i + 1)); break;
      case "ArrowUp": e.preventDefault();
        if (!open) { setOpen(true); break; }
        setActive((i) => Math.max(0, i - 1)); break;
      case "Home": if (open) { e.preventDefault(); setActive(0); } break;
      case "End": if (open) { e.preventDefault(); setActive(last); } break;
      case "Enter": case " ":
        e.preventDefault();
        open ? commit(active) : setOpen(true); break;
      case "Escape": if (open) { e.preventDefault(); setOpen(false); } break;
      case "Tab": setOpen(false); break;
      default: {
        if (e.key.length !== 1) break;                     // type-ahead
        const now = Date.now();
        typed.current.q = now - typed.current.at > 700 ? e.key : typed.current.q + e.key;
        typed.current.at = now;
        const hit = options.findIndex((o) =>
          o.label.toLowerCase().startsWith(typed.current.q.toLowerCase()));
        if (hit >= 0) { setActive(hit); if (!open) commit(hit); }
      }
    }
  };

  return (
    <div className="flex flex-col gap-1.5" ref={wrap}>
      <span className="text-[10px] font-[700] tracking-[0.08em] text-[var(--muted)]">{label}</span>

      <div className="relative" style={{ width }}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          onKeyDown={onKey}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-activedescendant={open ? `${label}-opt-${active}` : undefined}
          className="w-full h-[38px] pl-3.5 pr-9 rounded-[10px] flex items-center gap-2
                     text-[13px] font-[540] text-left transition-colors outline-none"
          style={{
            background: "var(--raised)",
            border: `1px solid ${open ? "var(--s1)" : "var(--hair)"}`,
            boxShadow: open ? "0 0 0 3px color-mix(in srgb, var(--s1) 18%, transparent)" : "none",
          }}
        >
          <span className="truncate">{current?.label}</span>
          {current?.hint && (
            <span className="truncate text-[var(--muted)] font-[460]">{current.hint}</span>
          )}
          {current?.badge != null && (
            <span className="ml-auto shrink-0 text-[10.5px] tnum px-1.5 rounded-full"
                  style={{ background: "color-mix(in srgb, var(--s1) 18%, transparent)",
                           color: "var(--s1)" }}>
              {current.badge}
            </span>
          )}
          <motion.svg aria-hidden width="11" height="11" viewBox="0 0 10 10"
                      className="absolute right-3 top-1/2 pointer-events-none"
                      style={{ translateY: "-50%", color: open ? "var(--s1)" : "var(--muted)" }}
                      animate={{ rotate: open ? 180 : 0 }}
                      transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}>
            <path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5"
                  strokeLinecap="round" strokeLinejoin="round" />
          </motion.svg>
        </button>

        <AnimatePresence>
          {open && (
            <motion.ul
              ref={list}
              role="listbox"
              tabIndex={-1}
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.985 }}
              transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
              className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 m-0 p-1.5
                         rounded-[12px] list-none max-h-[282px] overflow-y-auto"
              style={{
                background: "color-mix(in srgb, var(--surface) 92%, transparent)",
                backdropFilter: "blur(12px)",
                border: "1px solid var(--hair-strong)",
                boxShadow: "0 18px 44px rgba(0,0,0,0.5)",
              }}
            >
              {options.map((o, i) => {
                const on = o.value === value;
                const hot = i === active;
                return (
                  <li key={o.value} id={`${label}-opt-${i}`} data-i={i}
                      role="option" aria-selected={on}
                      onPointerEnter={() => setActive(i)}
                      onClick={() => commit(i)}
                      className="relative flex items-center gap-2 h-[34px] pl-7 pr-2.5
                                 rounded-[8px] text-[12.5px] cursor-pointer"
                      style={{
                        background: hot ? "var(--raised)" : "transparent",
                        color: on ? "var(--s1)" : "var(--ink-2)",
                        fontWeight: on ? 620 : 480,
                      }}>
                    {on && (
                      <motion.svg layoutId={`${label}-check`} aria-hidden
                                  width="11" height="11" viewBox="0 0 12 12"
                                  className="absolute left-2.5">
                        <path d="M2 6.3l2.6 2.6L10 3.5" fill="none" stroke="currentColor"
                              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </motion.svg>
                    )}
                    <span className="truncate">{o.label}</span>
                    {o.hint && (
                      <span className="truncate font-[460]"
                            style={{ color: on ? "color-mix(in srgb, var(--s1) 70%, var(--muted))" : "var(--muted)" }}>
                        {o.hint}
                      </span>
                    )}
                    {o.badge != null && (
                      <span className="ml-auto shrink-0 text-[10.5px] tnum px-1.5 rounded-full"
                            style={{ background: on
                                       ? "color-mix(in srgb, var(--s1) 20%, transparent)"
                                       : "var(--raised)",
                                     color: on ? "var(--s1)" : "var(--muted)" }}>
                        {o.badge}
                      </span>
                    )}
                  </li>
                );
              })}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
