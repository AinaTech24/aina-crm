"use client";

/**
 * Custom select / dropdown — a branded, accessible replacement for the native
 * <select>. Button trigger + popup listbox, keyboard navigable, no black focus
 * outline. Drop-in API: `value` + `onChange(value)` + `options`.
 *
 *   <Select value={v} onChange={setV} options={[{value:"a",label:"A"}]} />
 */

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";

export type SelectOption = { value: string; label: string; disabled?: boolean };

export function Select({
  value,
  onChange,
  options,
  placeholder = "Select…",
  disabled,
  className = "",
  menuClassName = "",
  ariaLabel,
  size = "md",
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  menuClassName?: string;
  ariaLabel?: string;
  size?: "sm" | "md";
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [alignRight, setAlignRight] = useState(false);
  const [flipUp, setFlipUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setActive(options.findIndex((o) => o.value === value));
    // Open the menu leftward when the trigger sits near the right edge, so the
    // popup never overflows the viewport (which would add a horizontal scroll).
    const el = ref.current;
    if (el && typeof window !== "undefined") {
      const rect = el.getBoundingClientRect();
      setAlignRight(window.innerWidth - rect.left < 256);
      // Open upward when the trigger sits near the bottom of the viewport (and
      // there's room above) — so the menu isn't clipped by a scroll container
      // (e.g. the pipeline board's overflow-x-auto row) or run off-screen.
      setFlipUp(window.innerHeight - rect.bottom < 280 && rect.top > 280);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function commit(i: number) {
    const o = options[i];
    if (!o || o.disabled) return;
    onChange(o.value);
    setOpen(false);
  }

  function onTriggerKey(e: React.KeyboardEvent) {
    if (disabled) return;
    if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (open) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => Math.min(options.length - 1, a + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => Math.max(0, a - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        commit(active);
      }
    }
  }

  const sizes = size === "sm" ? "h-8 text-xs px-2.5" : "h-9 text-sm px-3";

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((s) => !s)}
        onKeyDown={onTriggerKey}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        id={id}
        className={`w-full inline-flex items-center justify-between gap-2 rounded-lg border bg-card font-medium transition
          ${sizes}
          ${open ? "border-brand-cyan/60 ring-2 ring-brand-cyan/15" : "border-border hover:bg-secondary/60"}
          disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none`}
      >
        <span className={`truncate ${selected ? "text-foreground" : "text-muted-foreground"}`}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <ul
          role="listbox"
          className={`absolute ${alignRight ? "right-0" : "left-0"} ${flipUp ? "bottom-full mb-1 origin-bottom" : "top-full mt-1 origin-top"} z-50 min-w-full w-max max-w-[min(20rem,90vw)] max-h-64 overflow-y-auto scrollbar-thin card-elevated bg-card p-1 animate-scale-in ${menuClassName}`}
        >
          {options.length === 0 && (
            <li className="px-2.5 py-2 text-xs text-muted-foreground">No options</li>
          )}
          {options.map((o, i) => {
            const isSel = o.value === value;
            return (
              <li key={o.value || `__${i}`} role="option" aria-selected={isSel}>
                <button
                  type="button"
                  disabled={o.disabled}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => commit(i)}
                  className={`w-full flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition
                    ${i === active ? "bg-brand-cyan-light/60 text-brand-cyan-deep" : "text-foreground/80 hover:bg-secondary"}
                    ${isSel ? "font-semibold" : ""}
                    disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  <span className="truncate">{o.label}</span>
                  {isSel && <Check className="size-3.5 shrink-0 text-brand-cyan" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
