"use client";

/**
 * Personalizable sidebar navigation.
 *
 * The server passes the full, role/module-filtered list of nav items (each with
 * a pre-rendered icon and its default group). This client component lets each
 * user:
 *   • search modules by name,
 *   • drag to reorder modules (within and across groups),
 *   • create / rename / delete their own groups,
 * and persists the personalized layout to localStorage (per user, per device).
 *
 * New modules the user gains access to are auto-appended to their default group;
 * modules they lose access to are dropped silently — so the saved layout never
 * goes stale.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DashboardNavDropdown, type DashboardSubItem } from "./DashboardNavDropdown";
import {
  Search, Pencil, Check, Plus, GripVertical, X, RotateCcw, Circle, ChevronDown,
  // ── nav module icons (rendered here by name; see ICONS map) ──
  Activity, AlertTriangle, BarChart3, Bot, Boxes, Briefcase, Cake, Calculator,
  Calendar, CalendarCheck, CalendarOff, ClipboardCheck, Copy, CreditCard,
  FileSignature, FileText, FolderArchive, GitBranch, HeartHandshake, Image as ImageIcon,
  Inbox, LayoutDashboard, ListChecks, Megaphone, MessageSquare, PhoneCall, PieChart,
  Radio, Repeat, Scale, ScrollText, Shield, ShieldCheck, Sparkles, Target, TrendingUp,
  UserCog, Users, Users2, Wallet, XOctagon,
  type LucideIcon,
} from "lucide-react";

/**
 * Name → component map for every icon the sidebar nav uses. The server passes a
 * string name (the lucide displayName) rather than a pre-rendered element —
 * passing a lucide element across the RSC boundary makes React try to serialize
 * the icon as a client reference, which fails ("module not in client manifest").
 * Unknown names fall back to a neutral dot.
 */
const ICONS: Record<string, LucideIcon> = {
  Activity, AlertTriangle, BarChart3, Bot, Boxes, Briefcase, Cake, Calculator,
  Calendar, CalendarCheck, CalendarOff, ClipboardCheck, Copy, CreditCard,
  FileSignature, FileText, FolderArchive, GitBranch, HeartHandshake, Image: ImageIcon,
  Inbox, LayoutDashboard, ListChecks, Megaphone, MessageSquare, PhoneCall, PieChart,
  Radio, Repeat, Scale, ScrollText, Shield, ShieldCheck, Sparkles, Target, TrendingUp,
  UserCog, Users, Users2, Wallet, XOctagon,
};

export type NavItemData = {
  href: string;
  label: string;
  iconName: string; // lucide displayName, resolved client-side via ICONS
  defaultGroup: string; // default section title ("" = the top, header-less group)
};

type Group = { id: string; title: string; items: string[] /* hrefs */ };
type SavedLayout = { v: number; groups: Group[] };

const VERSION = 2;

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "group";
}

function buildDefault(items: NavItemData[]): Group[] {
  const groups: Group[] = [];
  const byId = new Map<string, Group>();
  for (const it of items) {
    const title = it.defaultGroup ?? "";
    const id = title === "" ? "main" : slug(title);
    let g = byId.get(id);
    if (!g) {
      g = { id, title, items: [] };
      byId.set(id, g);
      groups.push(g);
    }
    g.items.push(it.href);
  }
  return groups;
}

/** Merge a saved layout with the currently-available items. */
function reconcile(saved: SavedLayout | null, items: NavItemData[]): Group[] {
  if (!saved || saved.v !== VERSION || !Array.isArray(saved.groups)) return buildDefault(items);
  const available = new Map(items.map((i) => [i.href, i]));
  const seen = new Set<string>();
  const groups: Group[] = saved.groups.map((g) => ({
    id: g.id,
    title: g.title ?? "",
    items: (g.items || []).filter((h) => {
      if (available.has(h) && !seen.has(h)) {
        seen.add(h);
        return true;
      }
      return false;
    }),
  }));
  // Append newly-available items to a group matching their default title.
  for (const it of items) {
    if (seen.has(it.href)) continue;
    const title = it.defaultGroup ?? "";
    let g = groups.find((x) => x.title === title);
    if (!g) {
      g = { id: title === "" ? "main" : slug(title), title, items: [] };
      groups.push(g);
    }
    g.items.push(it.href);
    seen.add(it.href);
  }
  return groups;
}

export function CustomizableNav({
  items,
  storageKey,
  dashboardSubItems,
}: {
  items: NavItemData[];
  storageKey: string;
  dashboardSubItems?: DashboardSubItem[];
}) {
  const pathname = usePathname() ?? "";
  const itemMap = useMemo(() => new Map(items.map((i) => [i.href, i])), [items]);

  const [layout, setLayout] = useState<Group[]>(() => buildDefault(items));
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const [dragHref, setDragHref] = useState<string | null>(null);
  // Per-group collapse state (groupId → collapsed). Defaults to expanded; the
  // user can collapse a section like the Dashboards dropdown. Persisted per user.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const loadedRef = useRef(false);
  const collapseKey = `${storageKey}:collapsed`;

  // Load saved layout once on mount, reconciled against current access.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      setLayout(reconcile(raw ? (JSON.parse(raw) as SavedLayout) : null, items));
    } catch {
      setLayout(buildDefault(items));
    }
    loadedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Persist on change (after the initial load).
  useEffect(() => {
    if (!loadedRef.current) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ v: VERSION, groups: layout }));
    } catch {
      /* ignore quota / disabled storage */
    }
  }, [layout, storageKey]);

  // Load + persist per-group collapse state.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(collapseKey);
      if (raw) setCollapsed(JSON.parse(raw) as Record<string, boolean>);
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapseKey]);
  useEffect(() => {
    if (!loadedRef.current) return;
    try {
      localStorage.setItem(collapseKey, JSON.stringify(collapsed));
    } catch {
      /* ignore */
    }
  }, [collapsed, collapseKey]);

  function toggleCollapse(id: string) {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === "/dashboard" : pathname === href || pathname.startsWith(href + "/");

  /* ---------------- layout mutations ---------------- */

  function moveItem(href: string, toGroupId: string, beforeHref: string | null) {
    setLayout((prev) => {
      const next = prev.map((g) => ({ ...g, items: g.items.filter((h) => h !== href) }));
      const target = next.find((g) => g.id === toGroupId);
      if (!target) return prev;
      if (beforeHref && beforeHref !== href) {
        const idx = target.items.indexOf(beforeHref);
        target.items.splice(idx < 0 ? target.items.length : idx, 0, href);
      } else {
        target.items.push(href);
      }
      return next;
    });
  }

  function addGroup() {
    setLayout((prev) => [...prev, { id: `g-${prev.length}-${prev.reduce((n, g) => n + g.items.length, 0)}`, title: "New group", items: [] }]);
  }
  function renameGroup(id: string, title: string) {
    setLayout((prev) => prev.map((g) => (g.id === id ? { ...g, title } : g)));
  }
  function deleteGroup(id: string) {
    setLayout((prev) => {
      const idx = prev.findIndex((g) => g.id === id);
      if (idx < 0) return prev;
      const victim = prev[idx];
      const fallback = prev[idx === 0 ? 1 : 0];
      if (!fallback) return prev; // never delete the only group
      const next = prev.filter((g) => g.id !== id).map((g) => (g.id === fallback.id ? { ...g, items: [...g.items, ...victim.items] } : g));
      return next;
    });
  }
  function resetLayout() {
    setLayout(buildDefault(items));
  }

  /* ---------------- search view ---------------- */
  const q = query.trim().toLowerCase();
  const searchResults = q
    ? layout.flatMap((g) => g.items).map((h) => itemMap.get(h)!).filter((it) => it && it.label.toLowerCase().includes(q))
    : null;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Search + edit toolbar — hidden when the rail is collapsed to icons */}
      <div className="sidebar-when-expanded px-3 pt-3 pb-1 space-y-2">
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search modules…"
              disabled={editing}
              className="w-full rounded-lg border border-border bg-secondary/40 pl-8 pr-7 py-1.5 text-xs focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15 disabled:opacity-50"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear">
                <X className="size-3.5" />
              </button>
            )}
          </div>
          {/* Customize toggle — icon only, sits next to the search box. */}
          <button
            type="button"
            onClick={() => { setEditing((e) => !e); setQuery(""); }}
            title={editing ? "Done customizing" : "Customize sidebar"}
            aria-label={editing ? "Done customizing" : "Customize sidebar"}
            className={`shrink-0 inline-grid place-items-center size-[34px] rounded-lg transition-colors ${editing ? "bg-brand-cyan-light text-brand-cyan-deep" : "text-muted-foreground hover:bg-secondary border border-border"}`}
          >
            {editing ? <Check className="size-4" /> : <Pencil className="size-4" />}
          </button>
        </div>
        {editing && (
          <div className="flex items-center gap-1">
            <button type="button" onClick={addGroup} className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md text-brand-cyan-deep hover:bg-brand-cyan-light/60" title="Add a group">
              <Plus className="size-3.5" /> Group
            </button>
            <button type="button" onClick={resetLayout} className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md text-muted-foreground hover:bg-secondary" title="Reset to default">
              <RotateCcw className="size-3" /> Reset
            </button>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 pb-4 pt-2 space-y-5 scrollbar-thin">
        {/* Combined Dashboards dropdown (Dashboard + My Dashboards + Team) — pinned top */}
        {!searchResults && <DashboardNavDropdown items={dashboardSubItems} />}
        {/* ---- search results (flat) ---- */}
        {searchResults ? (
          <div className="space-y-0.5">
            {searchResults.length === 0 ? (
              <div className="px-2 py-6 text-center text-xs text-muted-foreground">No modules match “{query}”.</div>
            ) : (
              searchResults.map((it) => (
                <NavRow key={it.href} item={it} active={isActive(it.href)} onNavigate={() => setQuery("")} />
              ))
            )}
          </div>
        ) : (
          /* ---- grouped layout ---- */
          layout.map((g) => {
            if (!editing && g.items.length === 0) return null;
            const titled = g.title !== "";
            // A titled section is a collapsible dropdown (like Dashboards). The
            // header-less top group + edit mode always show their items.
            const isCollapsed = !editing && titled && !!collapsed[g.id];
            const groupActive = g.items.some((h) => isActive(h));
            return (
              <div
                key={g.id}
                onDragOver={editing ? (e) => e.preventDefault() : undefined}
                onDrop={editing ? (e) => { e.preventDefault(); if (dragHref) moveItem(dragHref, g.id, null); setDragHref(null); } : undefined}
              >
                {editing ? (
                  <div className="sidebar-section-title px-2 mb-2 flex items-center gap-1">
                    <input
                      value={g.title}
                      onChange={(e) => renameGroup(g.id, e.target.value)}
                      placeholder="Group name"
                      className="flex-1 min-w-0 bg-transparent text-[10px] font-bold uppercase tracking-[0.1em] text-foreground/70 border-b border-dashed border-border focus:outline-none focus:border-brand-cyan"
                    />
                    {layout.length > 1 && (
                      <button type="button" onClick={() => deleteGroup(g.id)} className="text-muted-foreground hover:text-rose-600" title="Delete group (items move to the first group)">
                        <X className="size-3" />
                      </button>
                    )}
                  </div>
                ) : titled ? (
                  <button
                    type="button"
                    onClick={() => toggleCollapse(g.id)}
                    aria-expanded={!isCollapsed}
                    className="sidebar-section-title group/sec w-full px-2 mb-2 flex items-center gap-1 text-left hover:text-foreground"
                  >
                    <span className={`flex-1 truncate text-[10px] font-bold uppercase tracking-[0.1em] ${groupActive ? "text-brand-cyan-deep" : "text-muted-foreground/70"}`}>
                      {g.title}
                    </span>
                    <ChevronDown className={`size-3 shrink-0 text-muted-foreground/60 transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
                  </button>
                ) : null}

                {/* Items stay mounted; when the section is collapsed we hide them
                    via CSS so the icon-rail still shows every glyph. */}
                <div className={`nav-sec-body space-y-0.5 min-h-[8px] ${isCollapsed ? "nav-sec-collapsed" : ""}`}>
                  {g.items.map((href) => {
                    const it = itemMap.get(href);
                    if (!it) return null;
                    return (
                      <NavRow
                        key={href}
                        item={it}
                        active={isActive(href)}
                        editing={editing}
                        dragging={dragHref === href}
                        onNavigate={() => setQuery("")}
                        onDragStart={() => setDragHref(href)}
                        onDragEnd={() => setDragHref(null)}
                        onDropBefore={() => { if (dragHref) moveItem(dragHref, g.id, href); setDragHref(null); }}
                      />
                    );
                  })}
                  {editing && g.items.length === 0 && (
                    <div className="text-[10px] text-muted-foreground/60 italic px-2 py-2 border border-dashed border-border rounded-lg text-center">Drop modules here</div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </nav>
    </div>
  );
}

/* ---------------- single row ---------------- */

function NavRow({
  item,
  active,
  editing,
  dragging,
  onNavigate,
  onDragStart,
  onDragEnd,
  onDropBefore,
}: {
  item: NavItemData;
  active: boolean;
  editing?: boolean;
  dragging?: boolean;
  onNavigate?: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onDropBefore?: () => void;
}) {
  const IconCmp = ICONS[item.iconName] ?? Circle;
  const content = (
    <>
      {editing && <GripVertical className="size-3.5 shrink-0 text-muted-foreground/60 cursor-grab" />}
      <IconCmp className="nav-link-icon" />
      <span className="truncate">{item.label}</span>
    </>
  );

  if (editing) {
    return (
      <div
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDropBefore?.(); }}
        className={`group nav-link cursor-grab select-none ${dragging ? "opacity-40" : ""}`}
      >
        {content}
      </div>
    );
  }

  return (
    <Link href={item.href} onClick={onNavigate} className={`group nav-link ${active ? "nav-link-active" : ""}`} aria-current={active ? "page" : undefined}>
      {content}
    </Link>
  );
}
