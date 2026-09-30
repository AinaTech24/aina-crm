"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

const STORAGE_KEY = "aina:sidebar-pinned";

/** Stable, user-controlled navigation width with a persisted compact mode. */
export function DesktopSidebar({ children }: { children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    const restore = () => {
      try { setExpanded(localStorage.getItem(STORAGE_KEY) !== "closed"); }
      catch { setExpanded(true); }
    };
    const collapse = () => setExpanded(false);
    restore();
    window.addEventListener("aina:sidebar-collapse", collapse);
    window.addEventListener("aina:sidebar-restore", restore);
    return () => {
      window.removeEventListener("aina:sidebar-collapse", collapse);
      window.removeEventListener("aina:sidebar-restore", restore);
    };
  }, []);

  function toggle() {
    setExpanded((prev) => {
      try { localStorage.setItem(STORAGE_KEY, prev ? "closed" : "open"); }
      catch { /* The sidebar remains usable when storage is unavailable. */ }
      return !prev;
    });
  }

  return (
    <aside
      aria-label="Workspace navigation"
      style={{ width: expanded ? "16rem" : "4rem" }}
      className={`hidden lg:flex relative z-30 shrink-0 h-full flex-col bg-card border-r border-border transition-[width] duration-200 print:hidden ${expanded ? "" : "sidebar-collapsed"}`}
    >
      <button
        type="button"
        onClick={toggle}
        aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
        aria-expanded={expanded}
        title={expanded ? "Collapse sidebar" : "Expand sidebar"}
        className="absolute top-[82px] -right-3 z-40 grid size-6 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow-sm hover:text-primary hover:border-primary/40"
      >
        {expanded ? <ChevronLeft className="size-3.5" /> : <ChevronRight className="size-3.5" />}
      </button>
      <div className="flex-1 flex flex-col min-h-0">{children}</div>
    </aside>
  );
}
