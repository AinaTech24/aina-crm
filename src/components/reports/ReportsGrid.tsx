"use client";

/**
 * Reports list with search + per-user "hide report" support.
 *
 * The canned reports are built-in (defined in code, shared across tenants) — so
 * an MFD can't truly delete one, but they CAN hide the ones they don't use to
 * declutter their view. Hidden keys persist to localStorage per user/device.
 *
 * Search filters across every group by report name (or group name). Hover a row
 * → × to hide it; "Manage hidden" reveals hidden rows (dimmed) with a ↺ to
 * restore, plus "Restore all".
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BarChart3, TrendingUp, TrendingDown, Users, Filter, AlertTriangle, FileText,
  Calendar, Briefcase, Shield, ShieldCheck, Clock, CheckCircle2, ListChecks,
  Megaphone, X, RotateCcw, Search, ChevronRight, type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  BarChart3, TrendingUp, TrendingDown, Users, Filter, AlertTriangle, FileText,
  Calendar, Briefcase, Shield, ShieldCheck, Clock, CheckCircle2, ListChecks, Megaphone,
};

type Item = { key: string; label: string; iconName: string; href: string };
type Section = { group: string; items: Item[] };

const LS_KEY = "aina:hidden-reports:v1";

export function ReportsGrid({ sections }: { sections: Section[] }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [manage, setManage] = useState(false);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) setHidden(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  function save(next: Set<string>) {
    setHidden(new Set(next));
    try {
      localStorage.setItem(LS_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  }
  const hide = (k: string) => { const n = new Set(hidden); n.add(k); save(n); };
  const restore = (k: string) => { const n = new Set(hidden); n.delete(k); save(n); };
  const hiddenCount = hidden.size;

  // Build the visible sections: apply hide-state (unless managing) + the search.
  const ql = query.trim().toLowerCase();
  const visible = useMemo(() => {
    return sections
      .map((section) => {
        const groupMatch = !!ql && section.group.toLowerCase().includes(ql);
        let items = !ready ? section.items : manage ? section.items : section.items.filter((it) => !hidden.has(it.key));
        if (ql) items = items.filter((it) => groupMatch || it.label.toLowerCase().includes(ql));
        return { group: section.group, items };
      })
      .filter((s) => s.items.length > 0);
  }, [sections, ready, manage, hidden, ql]);

  const totalMatches = visible.reduce((n, s) => n + s.items.length, 0);

  return (
    <div className="space-y-4">
      {/* Search + manage controls */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search reports…"
            className="h-9 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm focus:outline-none focus:border-brand-cyan/60 focus:ring-2 focus:ring-brand-cyan/15"
          />
        </div>
        <div className="flex items-center gap-2 text-xs">
          {ready && manage && hiddenCount > 0 && (
            <button type="button" onClick={() => save(new Set())} className="text-brand-cyan-deep hover:underline font-medium">
              Restore all
            </button>
          )}
          {ready && (hiddenCount > 0 || manage) && (
            <button type="button" onClick={() => setManage((m) => !m)} className="btn-secondary text-xs px-2.5 py-1">
              {manage ? "Done" : `Manage hidden (${hiddenCount})`}
            </button>
          )}
        </div>
      </div>

      {totalMatches === 0 ? (
        <div className="border rounded-lg p-8 text-center text-sm text-muted-foreground">
          No reports match “{query}”.{" "}
          <button type="button" onClick={() => setQuery("")} className="text-brand-cyan-deep hover:underline">Clear search</button>
        </div>
      ) : (
        visible.map((section) => (
          <section key={section.group}>
            <h2 className="font-semibold text-xs uppercase tracking-wide text-muted-foreground mb-1.5">{section.group}</h2>
            <div className="rounded-lg border border-border bg-card divide-y divide-border/60 overflow-hidden">
              {section.items.map((r) => {
                const Icon = ICONS[r.iconName] ?? BarChart3;
                const isHidden = ready && hidden.has(r.key);
                return (
                  <div key={r.key} className={`group flex items-center ${isHidden ? "opacity-50" : ""}`}>
                    <Link href={r.href} className="flex-1 flex items-center gap-3 px-3 py-2.5 hover:bg-accent/40 transition-colors min-w-0">
                      <Icon className="size-4 text-muted-foreground shrink-0" />
                      <span className="text-sm font-medium truncate">{r.label}</span>
                      <ChevronRight className="size-4 text-muted-foreground/40 ml-auto shrink-0" />
                    </Link>
                    {ready && (
                      isHidden ? (
                        <button
                          type="button"
                          onClick={() => restore(r.key)}
                          aria-label={`Restore ${r.label}`}
                          title="Restore report"
                          className="px-3 self-stretch grid place-items-center text-emerald-600 hover:bg-emerald-50"
                        >
                          <RotateCcw className="size-3.5" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => hide(r.key)}
                          aria-label={`Hide ${r.label}`}
                          title="Hide this report"
                          className="px-3 self-stretch grid place-items-center text-muted-foreground hover:bg-rose-50 hover:text-rose-600 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                        >
                          <X className="size-3.5" />
                        </button>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
