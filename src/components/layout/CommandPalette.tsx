"use client";

/**
 * CommandPalette — global Ctrl+K / ⌘K launcher.
 *
 * Three sections, one flattened keyboard-navigable list:
 *   1. Quick actions — the same create shortcuts as QuickCreateFab
 *   2. Go to — the role/license-filtered sidebar nav (passed from the layout)
 *   3. Records — live results from GET /api/search (same endpoint as GlobalSearch)
 *
 * Rendered in a portal on document.body so it floats above everything
 * (z-[140], above the drawer/toast layers). Icons arrive as lucide
 * displayName strings across the RSC boundary and are resolved via the
 * sidebar's ICONS map — unknown names fall back to a neutral dot.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Search,
  Loader2,
  Circle,
  Zap,
  Compass,
  FileSearch,
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
  type LucideIcon,
} from "lucide-react";
import { ICONS } from "./CustomizableNav";

type PaletteNavItem = {
  href: string;
  label: string;
  iconName: string;
  defaultGroup: string;
};

/** Same create actions as QuickCreateFab — one keystroke from anywhere. */
const QUICK_ACTIONS: Array<{ href: string; label: string; sub: string; icon: LucideIcon }> = [
  { href: "/dashboard/leads/new", label: "Add Lead", sub: "Someone interested in your services", icon: Sparkles },
  { href: "/dashboard/investors/new", label: "Add Client", sub: "Existing investor (after KYC)", icon: Users },
  { href: "/dashboard/tasks/new", label: "Add Task", sub: "Reminder for yourself or a teammate", icon: ListChecks },
  { href: "/dashboard/review-meetings/new", label: "Schedule Meeting", sub: "Review, fresh meeting, or follow-up", icon: Calendar },
  { href: "/dashboard/proposals/new", label: "Create Proposal", sub: "Branded PDF for a client", icon: FileSignature },
  { href: "/dashboard/service-requests/new", label: "Log Service Request", sub: "Track a client's query / problem", icon: Phone },
];

/** Response shape of GET /api/search — same as GlobalSearch consumes. */
type SearchResults = {
  investors?: any[];
  leads?: any[];
  folios?: any[];
  sips?: any[];
  serviceRequests?: any[];
  documents?: any[];
};

/** One flattened, keyboard-addressable row. */
type Row = {
  key: string;
  href: string;
  title: string;
  /** muted inline suffix (e.g. nav group) */
  suffix?: string;
  /** second muted line (e.g. PAN · segment) */
  sub?: string;
  /** small type chip (Records section) */
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
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  // Global Ctrl/⌘-K opens; Esc closes.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Reset + focus on open; lock body scroll while the overlay is up.
  useEffect(() => {
    if (!open) return;
    setQ("");
    setResults({});
    setActive(0);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Focus after the portal paints.
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = prev;
      clearTimeout(t);
    };
  }, [open]);

  // Debounced record search (same endpoint + shape as GlobalSearch).
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
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, open]);

  const sections = useMemo<Section[]>(() => {
    const needle = q.trim().toLowerCase();

    const actionRows: Row[] = QUICK_ACTIONS.filter(
      (a) => needle === "" || a.label.toLowerCase().includes(needle)
    ).map((a) => ({ key: `act:${a.href}`, href: a.href, title: a.label, sub: a.sub, icon: a.icon }));

    const navRows: Row[] = navItems
      .filter(
        (n) =>
          needle === "" ||
          n.label.toLowerCase().includes(needle) ||
          n.defaultGroup.toLowerCase().includes(needle)
      )
      .slice(0, 8)
      .map((n) => ({
        key: `nav:${n.href}`,
        href: n.href,
        title: n.label,
        suffix: n.defaultGroup || undefined,
        icon: ICONS[n.iconName] ?? Circle,
      }));

    const recordRows: Row[] = [
      ...(results.investors ?? []).map((r): Row => ({
        key: `inv:${r.id}`, href: `/dashboard/investors/${r.id}`, title: r.name,
        sub: `${r.pan ?? "—"} · ${r.segment_tag ?? "—"}`, chip: "Client", icon: Users,
      })),
      ...(results.leads ?? []).map((r): Row => ({
        key: `lead:${r.id}`, href: `/dashboard/leads/${r.id}`, title: r.name,
        sub: `${r.stage} · ${r.source}`, chip: "Lead", icon: Sparkles,
      })),
      ...(results.folios ?? []).map((r): Row => ({
        key: `folio:${r.id}`,
        href: r.investor_id ? `/dashboard/investors/${r.investor_id}` : "/dashboard/investors",
        title: `${r.folio_number}`,
        sub: `${r.amc_name} · ${r.investor_name ?? "—"}`, chip: "Folio", icon: FileText,
      })),
      ...(results.sips ?? []).map((r): Row => ({
        key: `sip:${r.id}`, href: "/dashboard/sips", title: r.scheme_name,
        sub: `₹${r.amount}/mo · ${r.investor_name ?? "—"} · ${r.status}`, chip: "SIP", icon: Repeat,
      })),
      ...(results.serviceRequests ?? []).map((r): Row => ({
        key: `sr:${r.id}`, href: "/dashboard/service-requests", title: r.subject,
        sub: `${r.ticket_no} · ${r.investor_name ?? "—"} · ${r.status}`, chip: "SR", icon: LifeBuoy,
      })),
      ...(results.documents ?? []).map((r): Row => ({
        key: `doc:${r.id}`, href: "/dashboard/documents", title: r.name,
        sub: r.category, chip: "Doc", icon: FolderArchive,
      })),
    ];

    const out: Section[] = [];
    if (actionRows.length) out.push({ id: "actions", label: "Quick actions", icon: Zap, rows: actionRows });
    if (navRows.length) out.push({ id: "goto", label: "Go to", icon: Compass, rows: navRows });
    if (q.trim().length >= 2 && (recordRows.length || busy))
      out.push({ id: "records", label: "Records", icon: FileSearch, rows: recordRows });
    return out;
  }, [q, navItems, results, busy]);

  const flatRows = useMemo(() => sections.flatMap((s) => s.rows), [sections]);

  // Clamp the active index whenever the visible list changes.
  useEffect(() => {
    setActive((a) => Math.min(Math.max(a, 0), Math.max(flatRows.length - 1, 0)));
  }, [flatRows.length]);
  useEffect(() => {
    setActive(0);
  }, [q]);

  // Keep the active row visible while arrowing through a long list.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  function onPanelKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (flatRows.length ? (a + 1) % flatRows.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (flatRows.length ? (a - 1 + flatRows.length) % flatRows.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = flatRows[active];
      if (row) go(row.href);
    }
  }

  if (!mounted || !open || typeof document === "undefined") return null;

  let idx = -1; // running index across sections for keyboard nav

  return createPortal(
    <div
      className="fixed inset-0 z-[140] bg-black/40 backdrop-blur-sm animate-fade-in"
      onMouseDown={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="mx-auto mt-[20vh] w-full max-w-xl px-4"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="card-elevated rounded-xl bg-card border border-border shadow-2xl overflow-hidden animate-scale-in"
          onKeyDown={onPanelKeyDown}
        >
          {/* Input row */}
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border">
            <Search className="size-4 text-brand-cyan shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Type a command, page, or record name…"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
              className="flex-1 min-w-0 bg-transparent text-sm outline-none focus:ring-0 placeholder:text-muted-foreground"
              aria-label="Command palette search"
            />
            {busy && <Loader2 className="size-4 animate-spin text-brand-cyan shrink-0" />}
          </div>

          {/* Results */}
          <div ref={listRef} className="max-h-[50vh] overflow-y-auto scrollbar-thin p-2">
            {sections.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">
                No matches for &ldquo;{q}&rdquo;. Try a page name, client, lead, or folio number.
              </div>
            ) : (
              <div className="space-y-3">
                {sections.map((section) => (
                  <div key={section.id}>
                    <div className="px-2 py-1.5 text-[10px] uppercase tracking-[0.1em] font-bold text-muted-foreground/80 flex items-center gap-1.5">
                      <section.icon className="size-3 text-brand-cyan" /> {section.label}
                      {section.id === "records" && busy && section.rows.length === 0 && (
                        <span className="normal-case font-medium text-muted-foreground/60">searching…</span>
                      )}
                    </div>
                    <ul className="space-y-0.5">
                      {section.rows.map((row) => {
                        idx += 1;
                        const i = idx;
                        const Icon = row.icon;
                        return (
                          <li key={row.key}>
                            <button
                              type="button"
                              data-idx={i}
                              onClick={() => go(row.href)}
                              onMouseEnter={() => setActive(i)}
                              className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-left transition-colors duration-100 ${
                                i === active ? "bg-brand-cyan-light/60" : ""
                              }`}
                            >
                              <Icon className="size-4 text-brand-cyan shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium truncate">
                                  {row.title}
                                  {row.suffix && (
                                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                                      · {row.suffix}
                                    </span>
                                  )}
                                </div>
                                {row.sub && (
                                  <div className="text-xs text-muted-foreground truncate">{row.sub}</div>
                                )}
                              </div>
                              {row.chip && (
                                <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                  {row.chip}
                                </span>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer hint */}
          <div className="px-4 py-2 border-t border-border bg-secondary/40 text-[11px] text-muted-foreground">
            ↑↓ navigate · ↵ open · esc close
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
