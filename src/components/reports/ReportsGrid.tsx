"use client";

/**
 * Reports grid with per-user "hide report" support.
 *
 * The canned reports are built-in (defined in code, shared across tenants) — so
 * an MFD can't truly delete one, but they CAN hide the ones they don't use to
 * declutter their view. Hidden keys persist to localStorage per user/device,
 * matching how CustomizableNav personalizes the sidebar.
 *
 * Hover a card → × to hide it. "Manage hidden" reveals hidden cards (dimmed)
 * with a ↺ to restore, plus "Restore all".
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  BarChart3, TrendingUp, TrendingDown, Users, Filter, AlertTriangle, FileText,
  Calendar, Briefcase, Shield, ShieldCheck, Clock, CheckCircle2, ListChecks,
  Megaphone, X, RotateCcw, type LucideIcon,
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
  const hide = (k: string) => {
    const n = new Set(hidden);
    n.add(k);
    save(n);
  };
  const restore = (k: string) => {
    const n = new Set(hidden);
    n.delete(k);
    save(n);
  };

  const hiddenCount = hidden.size;

  return (
    <div className="space-y-6">
      {ready && (hiddenCount > 0 || manage) && (
        <div className="flex items-center justify-between gap-3 flex-wrap rounded-lg border border-border/60 bg-secondary/40 px-3 py-2 text-xs">
          <span className="text-muted-foreground">
            {manage
              ? "Manage mode — click ↺ to restore a hidden report, or × on a card to hide it."
              : `${hiddenCount} report${hiddenCount === 1 ? "" : "s"} hidden from your view.`}
          </span>
          <div className="flex items-center gap-2">
            {manage && hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => save(new Set())}
                className="text-brand-cyan-deep hover:underline font-medium"
              >
                Restore all
              </button>
            )}
            <button type="button" onClick={() => setManage((m) => !m)} className="btn-secondary text-xs px-2.5 py-1">
              {manage ? "Done" : "Manage hidden"}
            </button>
          </div>
        </div>
      )}

      {sections.map((section) => {
        // Before hydration we render every item (matches the server render →
        // no hydration mismatch); after, we filter out hidden ones unless in
        // manage mode.
        const items = !ready ? section.items : manage ? section.items : section.items.filter((it) => !hidden.has(it.key));
        if (items.length === 0) return null;
        return (
          <section key={section.group}>
            <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground mb-2">{section.group}</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {items.map((r) => {
                const Icon = ICONS[r.iconName] ?? BarChart3;
                const isHidden = ready && hidden.has(r.key);
                return (
                  <div key={r.key} className={`relative group ${isHidden ? "opacity-50" : ""}`}>
                    <Link
                      href={r.href}
                      className="block h-full border rounded-lg p-4 bg-card hover:bg-accent/40 transition-colors"
                    >
                      <Icon className="size-4 text-muted-foreground" />
                      <div className="mt-2 font-medium text-sm pr-6">{r.label}</div>
                    </Link>
                    {ready &&
                      (isHidden ? (
                        <button
                          type="button"
                          onClick={() => restore(r.key)}
                          aria-label={`Restore ${r.label}`}
                          title="Restore report"
                          className="absolute top-2 right-2 size-6 grid place-items-center rounded-md bg-card border text-emerald-600 hover:bg-emerald-50"
                        >
                          <RotateCcw className="size-3.5" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => hide(r.key)}
                          aria-label={`Hide ${r.label}`}
                          title="Hide this report"
                          className="absolute top-2 right-2 size-6 grid place-items-center rounded-md text-muted-foreground hover:bg-rose-50 hover:text-rose-600 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                        >
                          <X className="size-3.5" />
                        </button>
                      ))}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
