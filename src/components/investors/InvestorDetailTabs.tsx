"use client";

/**
 * InvestorDetailTabs — groups a detail page's sections into category tabs so
 * the page shows one clean group at a time instead of a dense wall.
 *
 * It works the SAME way as RelatedListsManager: it leaves the server-rendered
 * section JSX untouched and injects scoped CSS keyed on `[data-rl-section]` to
 * hide the sections that don't belong to the active tab (and fade-in the ones
 * that do). Because it only adds `display:none` / an animation, it composes
 * cleanly with the existing show/hide/reorder customization — all logic,
 * components and field-gating are preserved.
 *
 * Sections NOT listed in any tab (e.g. the header) are never touched → they
 * stay pinned above the tab content as persistent context.
 *
 * The control itself is a segmented switch — a track with a raised pill on the
 * active tab — rather than the underline it used to be. Three reasons it earns
 * the change on a CRM detail page:
 *
 *  · An underline is a 2px cue at the bottom edge of the label. On a page that
 *    already carries chips, tiles and a banner above it, the active tab was the
 *    quietest thing on screen. A filled pill reads instantly.
 *  · The track draws a box around the whole set, so seven tabs on Client 360
 *    read as one control rather than seven loose words.
 *  · It gives `count` somewhere to live. A related-list tab that says how many
 *    items are behind it ("Activity 12") saves a click to find out — the thing
 *    every mature CRM does and this page did not.
 *
 * Accessibility, which the underline version had none of: proper
 * tablist/tab roles, aria-selected, roving tabindex and ←/→/Home/End keys.
 */

import { useEffect, useRef, useState } from "react";
import {
  LayoutGrid,
  Wallet,
  ShieldCheck,
  MessagesSquare,
  FileText,
  Activity,
  MoreHorizontal,
  type LucideIcon,
} from "lucide-react";

export type DetailTab = {
  key: string;
  label: string;
  icon?: LucideIcon;
  sections: string[];
  /** Items behind this tab. Rendered as a badge; omit when there is nothing
   *  meaningful to count (a settings or details tab). 0 still renders, because
   *  "Activity 0" is information — it says don't bother looking. */
  count?: number;
};

const ICONS: Record<string, LucideIcon> = {
  overview: LayoutGrid,
  portfolio: Wallet,
  profile: ShieldCheck,
  engagement: MessagesSquare,
  details: FileText,
  activity: Activity,
  more: MoreHorizontal,
};

export function InvestorDetailTabs({
  moduleKey,
  tabs,
  label = "Sections",
}: {
  moduleKey: string;
  tabs: DetailTab[];
  /** Accessible name for the tab strip. */
  label?: string;
}) {
  const storageKey = `nd-tab:${moduleKey}`;
  const [active, setActive] = useState<string>(tabs[0]?.key ?? "");
  const stripRef = useRef<HTMLDivElement>(null);

  // Restore the last-used tab (per browser) after hydration.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved && tabs.some((t) => t.key === saved)) setActive(saved);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, active);
    } catch {}
  }, [active, storageKey]);

  const managed = new Set(tabs.flatMap((t) => t.sections));
  const activeSet = new Set(tabs.find((t) => t.key === active)?.sections ?? []);

  /** ←/→ move between tabs and follow focus, per the WAI-ARIA tabs pattern. */
  function onKeyDown(e: React.KeyboardEvent) {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const i = tabs.findIndex((t) => t.key === active);
    const next =
      e.key === "Home" ? 0
      : e.key === "End" ? tabs.length - 1
      : e.key === "ArrowLeft" ? (i - 1 + tabs.length) % tabs.length
      : (i + 1) % tabs.length;
    setActive(tabs[next].key);
    const el = stripRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next];
    el?.focus();
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  // Hide every tab-managed section that isn't in the active tab; fade-in the
  // ones that are. Rendered server-side too (with the default tab), so the page
  // loads already focused on one tab — no flash of every section.
  const css =
    [...managed]
      .filter((k) => !activeSet.has(k))
      .map((k) => `[data-rl-module="${moduleKey}"][data-rl-section="${k}"]{display:none!important;}`)
      .join("\n") +
    "\n" +
    [...activeSet]
      .map((k) => `[data-rl-module="${moduleKey}"][data-rl-section="${k}"]{animation:nd-tab-in .28s ease both;}`)
      .join("\n") +
    "\n@keyframes nd-tab-in{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:none;}}" +
    "\n@media (prefers-reduced-motion:reduce){[data-rl-module]{animation:none!important;}}";

  return (
    <div>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div
        ref={stripRef}
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="inline-flex max-w-full items-center gap-1 overflow-x-auto scrollbar-none rounded-xl border border-border bg-secondary/60 p-1"
      >
        {tabs.map((t) => {
          const Icon = t.icon ?? ICONS[t.key];
          const on = active === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={on}
              tabIndex={on ? 0 : -1}
              onClick={() => setActive(t.key)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm whitespace-nowrap transition-colors ${
                on
                  ? "bg-card font-semibold text-foreground shadow-sm ring-1 ring-border"
                  : "font-medium text-muted-foreground hover:bg-card/60 hover:text-foreground"
              }`}
            >
              {Icon && <Icon className={`size-4 ${on ? "text-primary" : ""}`} aria-hidden />}
              {t.label}
              {t.count != null && (
                <span
                  className={`ml-0.5 rounded-full px-1.5 py-px text-2xs font-semibold tabular-nums ${
                    on ? "bg-primary/10 text-primary" : "bg-background text-muted-foreground"
                  }`}
                >
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
