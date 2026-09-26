"use client";

/**
 * CommandPalette 2.0 — Global Ctrl+K / ⌘K launcher with Omni-actions,
 * Recent records history, deep nav, and live record search.
 *
 * It is the app's ONE search. The top-bar field (GlobalSearch) is only a
 * trigger that opens it, and the sidebar no longer has a filter box: pages,
 * reports and records are all found here.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Search,
  Loader2,
  Circle,
  Zap,
  Sparkles,
  Users,
  ListChecks,
  Calendar,
  FileSignature,
  Phone,
  FileText,
  Repeat,
  LifeBuoy,
  FolderArchive,
  History,
  TrendingUp,
  Calculator,
  ShieldCheck,
  FolderSync,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  HeartHandshake,
  Shield,
  type LucideIcon,
} from "lucide-react";
import { ICONS } from "./CustomizableNav";
import { ALL_REPORTS, reportHaystack } from "@/lib/reports/catalog";

type PaletteNavItem = {
  href: string;
  label: string;
  iconName: string;
  defaultGroup: string;
};

const RECENT_STORAGE_KEY = "aina_recent_records";

const OPEN_EVENT = "aina:open-command-palette";

/** Open the palette from anywhere on the client (the top-bar search field). */
export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/**
 * The 90-odd canned reports, indexed for the palette.
 *
 * Reports used to be reachable only by opening Reports & MIS and knowing which
 * of 18 groups to expand — so typing "capital gains" here returned clients, and
 * the report read as missing. That is the single most common complaint levelled
 * at the incumbent back offices: a feature that exists but cannot be found.
 *
 * `reportHaystack` folds in each report's description and its aliases, so a
 * firm migrating from another back office can search in its old vocabulary.
 */
const REPORT_INDEX = ALL_REPORTS.map((r) => ({ ...r, haystack: reportHaystack(r) }));

type RecentRecord = {
  id: string;
  href: string;
  title: string;
  sub?: string;
  chip?: string;
};

/**
 * Quick create actions + common power actions. `page` names the menu entry an
 * action belongs to: the action shows only when that page is in navItems, which
 * the layout has already filtered by role and module. Without it an RM was
 * offered RTA imports and the DDQ from here while the menu correctly hid them.
 * (Create actions are guarded by their own pages.)
 */
const QUICK_ACTIONS: Array<{ href: string; label: string; sub: string; icon: LucideIcon; page?: string }> = [
  { href: "/dashboard/leads/new", label: "Add Lead", sub: "New prospect (stages 1–10)", icon: Sparkles },
  { href: "/dashboard/investors/new", label: "Add Client", sub: "New investor (after KYC)", icon: Users },
  { href: "/dashboard/sips/new", label: "Register SIP", sub: "Setup new SIP installment", icon: TrendingUp },
  { href: "/dashboard/tasks/new", label: "Add Task", sub: "Reminder for yourself or team", icon: ListChecks },
  { href: "/dashboard/review-meetings/new", label: "Schedule Review", sub: "Client portfolio review meeting", icon: Calendar },
  { href: "/dashboard/proposals/new", label: "Create Proposal", sub: "Branded scheme proposal PDF", icon: FileSignature },
  { href: "/dashboard/service-requests/new", label: "Log Service Request", sub: "Track investor query / issue", icon: Phone },
  { href: "/dashboard/calculators", label: "Practice Calculators", sub: "SIP, SWP, Lumpsum, Delay cost", icon: Calculator, page: "/dashboard/calculators" },
  { href: "/dashboard/rta-imports", label: "RTA File Imports", sub: "CAMS / KFintech file ingestion", icon: FolderSync, page: "/dashboard/rta-imports" },
  { href: "/dashboard/sips?tab=rejections", label: "View Rejected SIPs", sub: "Bounced / failed SIP recovery", icon: AlertTriangle, page: "/dashboard/sips" },
  { href: "/dashboard/compliance", label: "Compliance & DDQ", sub: "Audit readiness score & register", icon: ShieldCheck, page: "/dashboard/compliance" },
];

/** Response shape of GET /api/search */
type SearchResults = {
  investors?: any[];
  leads?: any[];
  families?: any[];
  folios?: any[];
  sips?: any[];
  policies?: any[];
  tasks?: any[];
  serviceRequests?: any[];
  documents?: any[];
};

type Row = {
  key: string;
  href: string;
  title: string;
  suffix?: string;
  sub?: string;
  chip?: string;
  icon: LucideIcon;
};

type Section = { id: string; label: string; icon: LucideIcon; rows: Row[] };

export function CommandPalette({ navItems }: { navItems: PaletteNavItem[] }) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [results, setResults] = useState<SearchResults>({});
  const [busy, setBusy] = useState(false);
  const [recentRecords, setRecentRecords] = useState<RecentRecord[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    try {
      const saved = localStorage.getItem(RECENT_STORAGE_KEY);
      if (saved) setRecentRecords(JSON.parse(saved).slice(0, 5));
    } catch {
      // ignore storage error
    }
  }, []);

  // Global Ctrl/⌘-K opens; Esc closes.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  // Reset + focus on open; lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    setQ("");
    setResults({});
    setActive(0);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => inputRef.current?.focus(), 10);
    return () => {
      document.body.style.overflow = prev;
      clearTimeout(t);
    };
  }, [open]);

  // Debounced search
  useEffect(() => {
    if (!open || q.trim().length < 2) {
      setResults({});
      setBusy(false);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const j = await res.json();
        if (!cancelled) setResults(j);
      } catch {
        if (!cancelled) setResults({});
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, open]);

  const saveRecent = (row: Row) => {
    if (row.key.startsWith("act:") || row.key.startsWith("nav:") || row.key.startsWith("report:")) return;
    try {
      const rec: RecentRecord = {
        id: row.key,
        href: row.href,
        title: row.title,
        sub: row.sub,
        chip: row.chip,
      };
      const updated = [rec, ...recentRecords.filter((r) => r.href !== row.href)].slice(0, 5);
      setRecentRecords(updated);
      localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // ignore
    }
  };

  const sections = useMemo<Section[]>(() => {
    const needle = q.trim().toLowerCase();
    const isActionOnly = needle.startsWith(">");
    const cleanNeedle = isActionOnly ? needle.slice(1).trim() : needle;

    const allowedPages = new Set(navItems.map((n) => n.href));
    const actionRows: Row[] = QUICK_ACTIONS.filter(
      (a) =>
        (!a.page || allowedPages.has(a.page)) &&
        (cleanNeedle === "" || a.label.toLowerCase().includes(cleanNeedle) || a.sub.toLowerCase().includes(cleanNeedle))
    ).map((a) => ({ key: `act:${a.href}`, href: a.href, title: a.label, sub: a.sub, icon: a.icon }));

    if (isActionOnly) {
      return [{ id: "actions", label: "Quick Actions", icon: Zap, rows: actionRows }];
    }

    const recentRows: Row[] = (needle === "" && recentRecords.length > 0)
      ? recentRecords.map((r) => ({
          key: r.id,
          href: r.href,
          title: r.title,
          sub: r.sub,
          chip: r.chip,
          icon: History,
        }))
      : [];

    const navRows: Row[] = navItems
      .filter(
        (n) =>
          cleanNeedle === "" ||
          n.label.toLowerCase().includes(cleanNeedle) ||
          n.defaultGroup.toLowerCase().includes(cleanNeedle)
      )
      .slice(0, cleanNeedle ? 8 : 6)
      .map((n) => ({
        key: `nav:${n.href}`,
        href: n.href,
        title: n.label,
        suffix: n.defaultGroup || undefined,
        icon: ICONS[n.iconName] ?? Circle,
      }));

    // Reports are a static list, so they match locally — no round-trip, no
    // debounce, results land on the keystroke.
    const reportRows: Row[] = cleanNeedle.length < 2
      ? []
      : REPORT_INDEX.filter((r) => r.haystack.includes(cleanNeedle))
          .slice(0, 6)
          .map((r): Row => ({
            key: `report:${r.key}`,
            href: r.href,
            title: r.label,
            sub: r.desc,
            suffix: r.group,
            icon: ICONS[r.icon] ?? BarChart3,
          }));

    const recordRows: Row[] = [
      ...(results.investors ?? []).map((r): Row => ({
        key: `inv:${r.id}`,
        href: `/dashboard/investors/${r.id}`,
        title: r.name,
        sub: `${r.pan ?? "—"} · ${r.segment_tag ?? "—"} · AUM: ₹${r.aum ? (r.aum / 100000).toFixed(1) + "L" : "0"}`,
        chip: "Client",
        icon: Users,
      })),
      ...(results.leads ?? []).map((r): Row => ({
        key: `lead:${r.id}`,
        href: `/dashboard/leads/${r.id}`,
        title: r.name,
        sub: `${r.stage} · ${r.source}`,
        chip: "Lead",
        icon: Sparkles,
      })),
      ...(results.families ?? []).map((r): Row => ({
        key: `fam:${r.id}`,
        href: `/dashboard/families/${r.id}`,
        // Same fallback as the Families list: many households only have a head name.
        title: r.family_name || r.head_name || "Unnamed family",
        sub: [r.family_name ? r.head_name : null, r.family_code].filter(Boolean).join(" · ") || undefined,
        chip: "Family",
        icon: HeartHandshake,
      })),
      ...(results.folios ?? []).map((r): Row => ({
        key: `folio:${r.id}`,
        href: r.investor_id ? `/dashboard/investors/${r.investor_id}` : "/dashboard/investors",
        title: `Folio: ${r.folio_number}`,
        sub: `${r.amc_name} · ${r.investor_name ?? "—"}`,
        chip: "Folio",
        icon: FileText,
      })),
      ...(results.sips ?? []).map((r): Row => ({
        key: `sip:${r.id}`,
        href: "/dashboard/sips",
        title: r.scheme_name,
        sub: `₹${r.amount}/mo · ${r.investor_name ?? "—"}`,
        chip: "SIP",
        icon: Repeat,
      })),
      ...(results.policies ?? []).map((r): Row => ({
        key: `pol:${r.id}`,
        href: `/dashboard/insurance/${r.id}`,
        title: r.policy_number ?? "(no number)",
        sub: `${r.insurer ?? "—"} · ${r.policy_type ?? "—"} · ${r.investor_name ?? "—"}`,
        chip: "Policy",
        icon: Shield,
      })),
      ...(results.tasks ?? []).map((r): Row => ({
        key: `task:${r.id}`,
        href: `/dashboard/tasks?task=${r.id}`,
        title: r.title,
        sub: `${r.status} · ${r.priority ?? "—"}${r.investor_name ? ` · ${r.investor_name}` : ""}`,
        chip: "Task",
        icon: ListChecks,
      })),
      ...(results.serviceRequests ?? []).map((r): Row => ({
        key: `sr:${r.id}`,
        href: "/dashboard/service-requests",
        title: r.subject,
        sub: `${r.ticket_no} · ${r.investor_name ?? "—"}`,
        chip: "SR",
        icon: LifeBuoy,
      })),
      ...(results.documents ?? []).map((r): Row => ({
        key: `doc:${r.id}`,
        href: "/dashboard/documents",
        title: r.name,
        sub: r.category ?? undefined,
        chip: "Document",
        icon: FolderArchive,
      })),
    ];

    const out: Section[] = [];
    if (recentRows.length > 0) {
      out.push({ id: "recent", label: "Recently Visited", icon: History, rows: recentRows });
    }
    if (actionRows.length > 0) {
      out.push({ id: "actions", label: "Quick Actions", icon: Zap, rows: actionRows.slice(0, 6) });
    }
    if (navRows.length > 0) {
      out.push({ id: "nav", label: "Pages", icon: ArrowRight, rows: navRows });
    }
    if (recordRows.length > 0) {
      out.push({ id: "records", label: "Matching Records", icon: Search, rows: recordRows });
    }
    if (reportRows.length > 0) {
      out.push({ id: "reports", label: "Reports", icon: BarChart3, rows: reportRows });
    }
    return out;
  }, [q, navItems, results, recentRecords]);

  const flatRows = useMemo(() => sections.flatMap((s) => s.rows), [sections]);

  // Keep active index in bounds
  useEffect(() => {
    if (active >= flatRows.length) setActive(Math.max(0, flatRows.length - 1));
  }, [flatRows.length, active]);

  function pick(row: Row) {
    saveRecent(row);
    setOpen(false);
    router.push(row.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % Math.max(1, flatRows.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + flatRows.length) % Math.max(1, flatRows.length));
    } else if (e.key === "Enter" && flatRows[active]) {
      e.preventDefault();
      pick(flatRows[active]);
    }
  }

  if (!mounted || !open) return null;

  let flatIndex = -1;

  const content = (
    <div className="fixed inset-0 z-[140] flex items-start justify-center p-4 sm:p-6 md:p-20 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-950/50 backdrop-blur-xs transition-opacity animate-fade-in"
        onClick={() => setOpen(false)}
      />

      {/* Palette Container */}
      <div className="relative w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-scale-in text-foreground">
        {/* Search bar */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border bg-card">
          <Search className="size-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            aria-label="Search clients, leads, folios and pages"
            placeholder="Search clients, leads, folios or pages (type > for actions)…"
            className="w-full bg-transparent border-0 outline-hidden text-sm placeholder:text-muted-foreground focus:ring-0"
          />
          {busy ? (
            <Loader2 className="size-4 animate-spin text-brand-cyan shrink-0" />
          ) : (
            <span className="text-2xs uppercase font-bold text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
              ESC
            </span>
          )}
        </div>

        {/* Results List */}
        <div ref={listRef} className="max-h-[60vh] overflow-y-auto p-2 space-y-3 text-xs">
          {flatRows.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <p className="text-sm font-medium">No results found for “{q}”</p>
              <p className="text-xs text-muted-foreground mt-1">Try a client name, PAN, mobile, folio number or a page name.</p>
            </div>
          ) : (
            sections.map((section) => (
              <div key={section.id} className="space-y-1">
                <div className="px-3 py-1 text-2xs font-bold tracking-wider uppercase text-muted-foreground flex items-center gap-1.5">
                  <section.icon className="size-3 text-brand-navy" />
                  <span>{section.label}</span>
                </div>
                {section.rows.map((row) => {
                  flatIndex++;
                  const isCurrent = flatIndex === active;
                  const Icon = row.icon;
                  return (
                    <button
                      key={row.key}
                      type="button"
                      onClick={() => pick(row)}
                      onMouseEnter={() => setActive(flatIndex)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-colors ${
                        isCurrent
                          ? "bg-brand-navy text-white font-medium shadow-sm"
                          : "text-foreground hover:bg-secondary/70"
                      }`}
                    >
                      <span
                        className={`size-7 rounded-lg grid place-items-center shrink-0 ${
                          isCurrent ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"
                        }`}
                      >
                        <Icon className="size-3.5" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate">{row.title}</span>
                          {row.suffix && (
                            <span
                              className={`text-2xs px-1.5 py-0.2 rounded font-normal ${
                                isCurrent ? "bg-white/20 text-white" : "text-muted-foreground bg-muted"
                              }`}
                            >
                              {row.suffix}
                            </span>
                          )}
                          {row.chip && (
                            <span
                              className={`text-2xs px-1.5 py-0.2 rounded font-semibold ml-auto shrink-0 ${
                                isCurrent ? "bg-white/20 text-white" : "bg-brand-cyan-light text-brand-cyan-deep"
                              }`}
                            >
                              {row.chip}
                            </span>
                          )}
                        </div>
                        {row.sub && (
                          <div
                            className={`text-2xs truncate mt-0.5 ${
                              isCurrent ? "text-white/80" : "text-muted-foreground"
                            }`}
                          >
                            {row.sub}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer shortcuts */}
        <div className="flex items-center justify-between px-4 py-2 bg-muted/40 border-t border-border text-2xs text-muted-foreground">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="px-1 py-0.5 rounded bg-card border font-mono">↑</kbd> <kbd className="px-1 py-0.5 rounded bg-card border font-mono">↓</kbd> Navigate
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 rounded bg-card border font-mono">↵</kbd> Select
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 rounded bg-card border font-mono">&gt;</kbd> Actions
            </span>
          </div>
          <span>Aina Growth OS</span>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
