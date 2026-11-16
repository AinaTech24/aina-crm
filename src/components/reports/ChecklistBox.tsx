"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";

/**
 * A real, tick-able checkbox for the reference checklists (marketing assets,
 * finance checklist). These were previously static decorative boxes, so users
 * couldn't mark items done. State persists per-browser in localStorage, keyed
 * by a stable storageKey, so ticks survive reloads.
 */
export function ChecklistBox({ storageKey, label }: { storageKey: string; label: string }) {
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    try {
      setChecked(localStorage.getItem(storageKey) === "1");
    } catch {
      /* localStorage unavailable — fall back to in-memory only */
    }
  }, [storageKey]);

  function toggle() {
    setChecked((c) => {
      const next = !c;
      try {
        localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={toggle}
      // A 24px hit area (CLAUDE.md "Hit targets") around the 16px box.
      className="group -my-0.5 -ml-1 size-6 flex-shrink-0 grid place-items-center rounded"
    >
      <span
        className={`size-4 rounded border grid place-items-center transition-colors ${
          checked
            ? "bg-brand-cyan border-brand-cyan text-white"
            : "border-border bg-card group-hover:border-brand-cyan"
        }`}
      >
        {checked && <Check className="size-3" strokeWidth={3} />}
      </span>
    </button>
  );
}
