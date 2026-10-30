"use client";

/**
 * Top-bar calendar icon — one click to the viewer's own calendar, this week or
 * this month (the Calendar page already scopes items to the viewer's book).
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CalendarDays, CalendarRange } from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";

const VIEWS = [
  { href: "/dashboard/calendar?view=week", label: "This week", Icon: CalendarRange },
  { href: "/dashboard/calendar", label: "This month", Icon: CalendarDays },
];

export function CalendarShortcut() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (open && ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <Tooltip label="My calendar" hidden={open}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="size-9 rounded-full bg-secondary/70 hover:bg-secondary text-muted-foreground hover:text-foreground grid place-items-center transition-colors"
          aria-label="My calendar"
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <CalendarDays className="size-4" />
        </button>
      </Tooltip>

      {open && (
        <div role="menu" className="absolute right-0 top-full mt-2 w-44 border bg-card rounded-lg shadow-lg z-40 overflow-hidden py-1">
          {VIEWS.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-secondary"
            >
              <Icon className="size-4 text-muted-foreground" />
              {label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
