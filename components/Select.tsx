"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDismiss } from "./useDismiss";

export interface Option {
  value: string;
  label: string;
}

// A pick-one field with its own list, replacing the browser's <select> so the open list matches the app.
// Keyboard: Enter or Arrow Down opens; arrows, Home and End move; Enter chooses; Escape closes.
// `search` adds a filter box, for long lists such as time zones.
export default function Select({ id, value, options, onChange, search = false }: { id?: string; value: string; options: Option[]; onChange: (value: string) => void; search?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const wrap = useDismiss(open, useCallback(() => setOpen(false), []));
  const list = useRef<HTMLUListElement>(null);

  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  const current = options.find((o) => o.value === value);

  function show() {
    setQuery("");
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  }
  function pick(o: Option | undefined) {
    if (!o) return;
    setOpen(false);
    if (o.value !== value) onChange(o.value);
    wrap.current?.querySelector("button")?.focus();
  }

  // Keep the highlighted option in view, and put focus in the list (or its filter box) when it opens.
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector("[data-active]")?.scrollIntoView({ block: "nearest" });
  }, [open, active, q]);
  useEffect(() => {
    if (open && !search) list.current?.focus();
  }, [open, search]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); show(); }
      return;
    }
    const last = shown.length - 1;
    const to = e.key === "ArrowDown" ? Math.min(last, active + 1) : e.key === "ArrowUp" ? Math.max(0, active - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (to !== null) { e.preventDefault(); setActive(to); }
    else if (e.key === "Enter") { e.preventDefault(); pick(shown[active]); }
    else if (e.key === "Tab") setOpen(false);
  }

  return (
    <div className="select" ref={wrap} onKeyDown={onKeyDown}>
      <button type="button" id={id} className="select-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => (open ? setOpen(false) : show())}>
        <span className="select-value">{current?.label ?? "Choose"}</span>
        <svg className="select-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 9.5l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="select-pop">
          {search && (
            <input className="select-search" value={query} onChange={(e) => { setQuery(e.target.value); setActive(0); }} placeholder="Search" aria-label="Search the list" autoFocus />
          )}
          <ul className="select-list" role="listbox" tabIndex={-1} ref={list} aria-activedescendant={shown[active] ? `${id}-opt-${active}` : undefined}>
            {shown.map((o, n) => (
              <li
                key={o.value}
                id={`${id}-opt-${n}`}
                role="option"
                aria-selected={o.value === value}
                data-active={n === active || undefined}
                className="select-opt"
                onPointerMove={() => n !== active && setActive(n)}
                onClick={() => pick(o)}
              >
                {o.label}
                {o.value === value && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
              </li>
            ))}
            {shown.length === 0 && <li className="select-none">Nothing matches “{query.trim()}”.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
