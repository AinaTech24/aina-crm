"use client";

/**
 * "Add Meeting" split button — a single primary action that, on click, asks for
 * the meeting *type* (New / Follow-up / Review) before routing to the schedule
 * form with the matching `?category=` preset. Replaces the old three separate
 * header buttons.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Plus, ChevronDown, CalendarPlus, Repeat, CalendarCheck } from "lucide-react";

const TYPES = [
  { category: "new", label: "New Meeting", icon: CalendarPlus, desc: "First meeting with a client or prospect" },
  { category: "follow_up", label: "Follow-up", icon: Repeat, desc: "Continue a prior conversation" },
  { category: "review", label: "Review", icon: CalendarCheck, desc: "Periodic portfolio review" },
];

export function AddMeetingButton() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="btn-primary"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Plus className="size-4" /> Add Meeting
        <ChevronDown className={`size-3.5 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-64 origin-top-right card-elevated bg-card p-1.5 animate-scale-in">
          <div className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Meeting type
          </div>
          {TYPES.map((t) => {
            const Icon = t.icon;
            return (
              <Link
                key={t.category}
                href={`/dashboard/review-meetings/new?category=${t.category}`}
                onClick={() => setOpen(false)}
                className="flex items-start gap-2.5 rounded-lg px-2.5 py-2 hover:bg-secondary transition-colors"
              >
                <span className="size-7 rounded-lg bg-brand-cyan-light text-brand-cyan-deep grid place-items-center shrink-0 mt-0.5">
                  <Icon className="size-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">{t.label}</span>
                  <span className="block text-[11px] text-muted-foreground">{t.desc}</span>
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
