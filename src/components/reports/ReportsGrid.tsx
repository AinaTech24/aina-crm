"use client";

/**
 * Reports hub: "Most used" and "Favourites" as cards on top, then every report
 * grouped by area in collapsible groups, plus search and per-user "hide report".
 *
 * The canned reports are built-in (defined in code, shared across tenants) — so
 * an MFD can't truly delete one, but they CAN hide the ones they don't use to
 * declutter their view. Hidden keys, favourites, open counts and which groups
 * are open persist to localStorage per user/device.
 *
 * Most used = the six reports this person opens most on this device, topped up
 * from DEFAULT_MOST_USED until they have opened six. Favourites are left out of
 * it (they already sit right beside it). Groups start collapsed: with these two
 * rows above them the page is a hub, and a group opens with one click.
 *
 * Search filters across every group by report name, description, aliases or
 * group name. Hover a row → × to hide it; "Manage hidden" reveals hidden rows
 * (dimmed) with a ↺ to restore, plus "Restore all".
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BarChart3, TrendingUp, TrendingDown, Users, Filter, AlertTriangle, FileText,
  Calendar, Briefcase, Shield, ShieldCheck, Clock, CheckCircle2, ListChecks,
  Megaphone, X, RotateCcw, Search, ChevronRight, type LucideIcon,
  Star, CalendarClock} from "lucide-react";
import { DEFAULT_MOST_USED, type ReportFrequency } from "@/lib/reports/catalog";

const ICONS: Record<string, LucideIcon> = {
  BarChart3, TrendingUp, TrendingDown, Users, Filter, AlertTriangle, FileText,
  Calendar, CalendarClock, Briefcase, Shield, ShieldCheck, Clock, CheckCircle2, ListChecks, Megaphone,
};

type Item = { key: string; label: string; iconName: string; href: string; desc?: string; aliases?: string[] };
type Section = { group: string; frequency?: ReportFrequency; items: Item[] };

/**
 * Everything a search should match a report on: its name, the description shown
 * under it, and its non-rendering aliases (what the previous back office called
 * it, the RTA file code, the plain word someone actually types). Matching the
 * label alone is how a report that exists reads as a report that doesn't.
 */
function haystack(item: Item): string {
  return [item.label, item.desc ?? "", ...(item.aliases ?? [])].join(" ").toLowerCase();
}

const LS_KEY = "aina:hidden-reports:v1";
const FAV_KEY = "aina:favorite-reports:v1";
/** Superseded by OPENS_KEY; read once to seed the counts. */
const RECENT_KEY = "aina:recent-reports:v1";
const OPENS_KEY = "aina:report-opens:v1";
const OPEN_GROUPS_KEY = "aina:open-report-groups:v1";
const MOST_USED = 6;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private window / blocked storage: the page still works, it just forgets */
  }
}

export function ReportsGrid({ sections }: { sections: Section[] }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [manage, setManage] = useState(false);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState("");
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [opens, setOpens] = useState<Record<string, number>>({});
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    setHidden(new Set(readJson<string[]>(LS_KEY, [])));
    setFavorites(new Set(readJson<string[]>(FAV_KEY, [])));
    setOpenGroups(new Set(readJson<string[]>(OPEN_GROUPS_KEY, [])));
    let counts = readJson<Record<string, number>>(OPENS_KEY, {});
    if (Object.keys(counts).length === 0) {
      // First visit since counts began: the old "Recent" list is the best
      // evidence of use there is, newest weighted highest.
      const recent = readJson<string[]>(RECENT_KEY, []);
      counts = Object.fromEntries(recent.map((k, i) => [k, recent.length - i]));
    }
    setOpens(counts);
    setReady(true);
  }, []);

  function save(next: Set<string>) {
    setHidden(new Set(next));
    writeJson(LS_KEY, [...next]);
  }
  const hide = (k: string) => { const n = new Set(hidden); n.add(k); save(n); };
  const restore = (k: string) => { const n = new Set(hidden); n.delete(k); save(n); };
  const hiddenCount = hidden.size;

  const allItems = useMemo(() => sections.flatMap((section) => section.items), [sections]);
  const itemByKey = useMemo(() => new Map(allItems.map((item) => [item.key, item])), [allItems]);

  function toggleFavorite(key: string) {
    const next = new Set(favorites);
    if (next.has(key)) next.delete(key); else next.add(key);
    setFavorites(next);
    writeJson(FAV_KEY, [...next]);
  }

  function toggleGroup(group: string) {
    const next = new Set(openGroups);
    if (next.has(group)) next.delete(group); else next.add(group);
    setOpenGroups(next);
    writeJson(OPEN_GROUPS_KEY, [...next]);
  }

  function recordOpen(key: string) {
    const next = { ...opens, [key]: (opens[key] ?? 0) + 1 };
    setOpens(next);
    writeJson(OPENS_KEY, next);
  }

  // Top rows: favourites, then the most-opened reports that aren't favourites.
  const favoriteItems = useMemo(
    () => [...favorites].map((k) => itemByKey.get(k)).filter((i): i is Item => !!i && !hidden.has(i.key)),
    [favorites, itemByKey, hidden]
  );
  const { mostUsed, usedCount } = useMemo(() => {
    const eligible = (k: string) => itemByKey.has(k) && !hidden.has(k) && !favorites.has(k);
    const used = Object.entries(opens)
      .filter(([k, n]) => n > 0 && eligible(k))
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k)
      .slice(0, MOST_USED);
    const keys = [...used];
    for (const k of DEFAULT_MOST_USED) {
      if (keys.length >= MOST_USED) break;
      if (!keys.includes(k) && eligible(k)) keys.push(k);
    }
    return { mostUsed: keys.map((k) => itemByKey.get(k)!), usedCount: used.length };
  }, [opens, itemByKey, hidden, favorites]);

  // Build the visible sections: apply hide-state (unless managing) + the search.
  const ql = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      sections
        .map((section) => {
          const groupMatch = !!ql && section.group.toLowerCase().includes(ql);
          let items = !ready ? section.items : manage ? section.items : section.items.filter((it) => !hidden.has(it.key));
          if (ql) items = items.filter((it) => groupMatch || haystack(it).includes(ql));
          return { ...section, items };
        })
        .filter((s) => s.items.length > 0),
    [sections, ready, manage, hidden, ql]
  );

  const totalMatches = visible.reduce((n, s) => n + s.items.length, 0);
  // Rendered before storage is read too (Most used starts from the defaults),
  // so the rows don't pop in above the groups after hydration.
  const showTopRows = !ql && !manage;

  return (
    <div className="space-y-6">
      {showTopRows && (
        <>
          <TopRow
            title="Most used"
            note={usedCount === 0 ? "Common starting points. This fills with what you open most." : usedCount < MOST_USED ? "What you open most, topped up with common picks." : "What you open most on this device."}
          >
            {mostUsed.map((r) => (
              <ReportCard key={r.key} r={r} favorite={false} onOpen={recordOpen} onToggleFavorite={toggleFavorite} />
            ))}
          </TopRow>
          <TopRow title="Favourites">
            {!ready ? (
              <div className="h-16 rounded-lg bg-secondary/40" aria-hidden />
            ) : favoriteItems.length === 0 ? (
              <p className="col-span-full text-sm text-muted-foreground">
                Star <Star className="inline size-3.5 -mt-0.5" aria-hidden /> any report below to keep it here.
              </p>
            ) : (
              favoriteItems.map((r) => (
                <ReportCard key={r.key} r={r} favorite onOpen={recordOpen} onToggleFavorite={toggleFavorite} />
              ))
            )}
          </TopRow>
        </>
      )}

      {/* Search + manage controls */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search reports — try “capital gains”, “brokerage”, “LTCG”…"
            aria-label="Search reports"
            className="h-9 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm focus:outline-none focus:border-brand-cyan/60 focus:ring-2 focus:ring-brand-cyan/15"
          />
        </div>
        <div className="flex items-center gap-2 text-xs">
          {!ql && (
            <span className="text-muted-foreground mr-1 hidden sm:inline">
              {allItems.length} reports in {sections.length} groups
            </span>
          )}
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
        /* Multi-column so every group header is visible at once instead of a
           single narrow list next to two-thirds of empty screen. Each group
           stays whole (`break-inside-avoid`) as it expands. */
        <div className="columns-1 lg:columns-2 xl:columns-3 gap-4 [&>section]:break-inside-avoid [&>section]:mb-4">
        {visible.map((section) => {
          const isOpen = !!ql || manage || openGroups.has(section.group);
          return (
          <section key={section.group}>
            <button
              type="button"
              onClick={() => toggleGroup(section.group)}
              aria-expanded={isOpen}
              className="w-full flex items-center gap-2 mb-1.5 group/hdr text-left"
            >
              <ChevronRight className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`} />
              <h2 className="text-sm font-semibold text-foreground">{section.group}</h2>
              {section.frequency && (
                <span className="rounded-full border border-border bg-secondary px-1.5 text-2xs font-medium leading-5 text-muted-foreground">
                  {section.frequency}
                </span>
              )}
              <span className="ml-auto text-2xs text-muted-foreground tabular-nums">{section.items.length}</span>
            </button>
            {isOpen && (
            <div className="rounded-lg border border-border bg-card divide-y divide-border/60 overflow-hidden">
              {section.items.map((r) => {
                const Icon = ICONS[r.iconName] ?? BarChart3;
                const isHidden = ready && hidden.has(r.key);
                return (
                  <div key={r.key} className={`group flex items-center ${isHidden ? "opacity-50" : ""}`}>
                    <Link href={r.href} onClick={() => recordOpen(r.key)} className="flex-1 flex items-center gap-3 px-3 py-2.5 hover:bg-accent/40 transition-colors min-w-0">
                      <Icon className="size-4 text-muted-foreground shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium truncate">{r.label}</span>
                        {r.desc && <span className="block text-2xs text-muted-foreground truncate">{r.desc}</span>}
                      </span>
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
                    {ready && !isHidden && (
                      <FavoriteButton label={r.label} on={favorites.has(r.key)} onClick={() => toggleFavorite(r.key)} className="px-3 self-stretch" />
                    )}
                  </div>
                );
              })}
            </div>
            )}
          </section>
          );
        })}
        </div>
      )}
    </div>
  );
}

function TopRow({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {note && <span className="text-xs text-muted-foreground">{note}</span>}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}

function ReportCard({
  r,
  favorite,
  onOpen,
  onToggleFavorite,
}: {
  r: Item;
  favorite: boolean;
  onOpen: (key: string) => void;
  onToggleFavorite: (key: string) => void;
}) {
  const Icon = ICONS[r.iconName] ?? BarChart3;
  return (
    <div className="relative rounded-lg border border-border bg-card transition-colors hover:bg-accent/40">
      <Link href={r.href} onClick={() => onOpen(r.key)} className="flex items-start gap-3 p-3 pr-11 min-w-0">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-secondary">
          <Icon className="size-4 text-muted-foreground" aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium text-foreground truncate">{r.label}</span>
          {r.desc && <span className="block text-xs text-muted-foreground truncate">{r.desc}</span>}
        </span>
      </Link>
      <FavoriteButton label={r.label} on={favorite} onClick={() => onToggleFavorite(r.key)} className="absolute right-1.5 top-1.5 size-8 rounded-md" />
    </div>
  );
}

function FavoriteButton({ label, on, onClick, className }: { label: string; on: boolean; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={on ? `Remove ${label} from favourites` : `Add ${label} to favourites`}
      aria-pressed={on}
      title={on ? "Remove from favourites" : "Add to favourites"}
      className={`grid place-items-center ${on ? "text-primary" : "text-muted-foreground hover:text-primary"} ${className ?? ""}`}
    >
      <Star className="size-3.5" fill={on ? "currentColor" : "none"} />
    </button>
  );
}
