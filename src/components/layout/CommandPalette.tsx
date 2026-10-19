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
  ChevronDown,
  Check,
  LayoutGrid,
  type LucideIcon,
} from "lucide-react";
import { ICONS } from "./CustomizableNav";
import { ALL_REPORTS, reportHaystack } from "@/lib/reports/catalog";
import { formatDate, formatMoney, humanise } from "@/lib/format";
import { buttonClass } from "@/components/ui/button-class";
import { MENU_ITEM } from "@/components/ui/menu-item-class";

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
  meetings?: any[];
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

/** The chip a recently visited record carries, by the section it was picked from. */
const RECORD_CHIP: Record<string, string> = {
  clients: "Client", leads: "Lead", families: "Family", tasks: "Task", meetings: "Meeting",
  requests: "Service request", policies: "Policy", folios: "Folio", sips: "SIP", documents: "Document",
};

/**
 * What the picker beside the search box can narrow the palette to. `id` is the
 * result section's id; `groups` the /api/search groups behind it (none for the
 * pages and reports, which match locally). `page` is the menu entry the module
 * belongs to: the module is offered only when the viewer's menu has it, so the
 * picker never lists a module the viewer cannot open. (The API gates the rows
 * themselves by capability and book either way.)
 */
const MODULES: Array<{ id: string; label: string; noun: string; icon: LucideIcon; groups: string[]; page?: string }> = [
  { id: "clients", label: "Clients", noun: "clients", icon: Users, groups: ["investors"], page: "/dashboard/investors" },
  { id: "leads", label: "Leads", noun: "leads", icon: Sparkles, groups: ["leads"], page: "/dashboard/leads" },
  { id: "families", label: "Families", noun: "families", icon: HeartHandshake, groups: ["families"], page: "/dashboard/families" },
  { id: "tasks", label: "Tasks", noun: "tasks", icon: ListChecks, groups: ["tasks"], page: "/dashboard/tasks" },
  { id: "meetings", label: "Meetings", noun: "meetings", icon: Calendar, groups: ["meetings"], page: "/dashboard/review-meetings" },
  { id: "requests", label: "Service requests", noun: "service requests", icon: LifeBuoy, groups: ["serviceRequests"], page: "/dashboard/service-requests" },
  { id: "policies", label: "Insurance policies", noun: "policies", icon: Shield, groups: ["policies"], page: "/dashboard/insurance" },
  { id: "folios", label: "Folios", noun: "folios", icon: FileText, groups: ["folios"], page: "/dashboard/investors" },
  { id: "sips", label: "SIPs", noun: "SIPs", icon: Repeat, groups: ["sips"], page: "/dashboard/sips" },
  { id: "documents", label: "Documents", noun: "documents", icon: FolderArchive, groups: ["documents"], page: "/dashboard/documents" },
  { id: "nav", label: "Pages", noun: "pages", icon: ArrowRight, groups: [] },
  { id: "reports", label: "Reports", noun: "reports", icon: BarChart3, groups: [] },
];
const ALL_MODULES = { id: "all", label: "All Modules", noun: "clients, leads, tasks, meetings or pages", icon: LayoutGrid, groups: [] as string[] };
const MODULE_STORAGE_KEY = "aina_palette_module";

/** `count` is the number of matches behind the rows shown (header badge). */
type Section = { id: string; label: string; icon: LucideIcon; rows: Row[]; count?: number };

export function CommandPalette({ navItems }: { navItems: PaletteNavItem[] }) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [results, setResults] = useState<SearchResults>({});
  const [busy, setBusy] = useState(false);
  const [recentRecords, setRecentRecords] = useState<RecentRecord[]>([]);
  const [moduleId, setModuleId] = useState("all");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQ, setPickerQ] = useState("");
  const [pickerActive, setPickerActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pickerInputRef = useRef<HTMLInputElement>(null);
  const pickerListRef = useRef<HTMLDivElement>(null);

  const availableModules = useMemo(() => {
    const pages = new Set(navItems.map((n) => n.href));
    return MODULES.filter((m) => !m.page || pages.has(m.page));
  }, [navItems]);
  // A remembered module the viewer no longer has falls back to All.
  const currentModule = availableModules.find((m) => m.id === moduleId) ?? ALL_MODULES;
  const pickerRows = useMemo(() => {
    const needle = pickerQ.trim().toLowerCase();
    return [ALL_MODULES, ...availableModules].filter((m) => !needle || m.label.toLowerCase().includes(needle));
  }, [availableModules, pickerQ]);

  useEffect(() => {
    setMounted(true);
    try {
      const saved = localStorage.getItem(RECENT_STORAGE_KEY);
      if (saved) setRecentRecords(JSON.parse(saved).slice(0, 5));
    } catch {
      // ignore storage error
    }
    try {
      const m = localStorage.getItem(MODULE_STORAGE_KEY);
      if (m) setModuleId(m);
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
    setPickerOpen(false);
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
    // Pages and reports match locally; no round-trip for them.
    const remote = currentModule.id === "all" || currentModule.groups.length > 0;
    if (!open || q.trim().length < 2 || !remote) {
      setResults({});
      setBusy(false);
      return;
    }
    let cancelled = false;
    // A newer keystroke cancels the older search, so the server stops working
    // on it (the route checks the request's abort signal between groups).
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const scope = currentModule.groups.length > 0 ? `&modules=${currentModule.groups.join(",")}` : "";
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}${scope}`, { signal: ctrl.signal });
        const j = await res.json();
        if (!cancelled) setResults(j);
      } catch {
        if (!cancelled) setResults({});
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, open, currentModule]);

  // Focus the picker's box on open; keep its highlighted row in view.
  useEffect(() => {
    if (!pickerOpen) return;
    const t = setTimeout(() => pickerInputRef.current?.focus(), 10);
    return () => clearTimeout(t);
  }, [pickerOpen]);
  useEffect(() => {
    pickerListRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [pickerActive, pickerOpen]);

  function chooseModule(id: string) {
    setModuleId(id);
    try {
      localStorage.setItem(MODULE_STORAGE_KEY, id);
    } catch {
      // ignore
    }
    setPickerOpen(false);
    setPickerQ("");
    setActive(0);
    setTimeout(() => inputRef.current?.focus(), 10);
  }

  function closePicker() {
    setPickerOpen(false);
    setPickerQ("");
    setTimeout(() => inputRef.current?.focus(), 10);
  }

  function onPickerKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setPickerActive((i) => (i + 1) % Math.max(1, pickerRows.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setPickerActive((i) => (i - 1 + pickerRows.length) % Math.max(1, pickerRows.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (pickerRows[pickerActive]) chooseModule(pickerRows[pickerActive].id);
    } else if (e.key === "Escape") {
      // Closes the picker only; the palette stays open.
      e.preventDefault();
      e.stopPropagation();
      closePicker();
    }
  }

  const saveRecent = (row: Row, chip?: string) => {
    if (row.key.startsWith("act:") || row.key.startsWith("nav:") || row.key.startsWith("report:") || row.key.startsWith("all:")) return;
    try {
      const rec: RecentRecord = {
        id: row.key,
        href: row.href,
        title: row.title,
        sub: row.sub,
        chip: row.chip ?? chip,
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

    const only = currentModule.id !== "all";
    const recentRows: Row[] = (needle === "" && recentRecords.length > 0)
      ? recentRecords
        .filter((r) => !only || (RECORD_CHIP[currentModule.id] != null && r.chip === RECORD_CHIP[currentModule.id]))
        .map((r) => ({
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
      .slice(0, only ? 12 : cleanNeedle ? 8 : 6)
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

    // Records, one section per kind — Clients, Leads, Families, Tasks,
    // Meetings… — each showing up to 5 and its full match count, ending in a
    // "See all" row onto that list (searched for the same text) when there
    // are more. A single mixed "Matching records" list made a client's tasks
    // and documents read as more clients.
    const enc = encodeURIComponent(q.trim());
    const totalOf = (rows: any[] | undefined) => Number(rows?.[0]?.total ?? rows?.length ?? 0);
    const kinds: Array<{
      id: string; label: string; noun: string; icon: LucideIcon; data: any[] | undefined;
      list?: string; row: (r: any) => Omit<Row, "icon" | "key"> & { key: string };
    }> = [
      {
        id: "clients", label: "Clients", noun: "clients", icon: Users, data: results.investors, list: `/dashboard/investors?q=${enc}`,
        row: (r) => ({
          key: `inv:${r.id}`,
          href: `/dashboard/investors/${r.id}`,
          title: r.name,
          suffix: r.client_category ? `Cat ${r.client_category}` : undefined,
          sub: [
            r.pan_display ?? (r.minor ? "Minor" : null),
            r.rm_name ? `RM ${r.rm_name}` : null,
            Number(r.aum) > 0 ? `AUM ${formatMoney(Number(r.aum))}` : null,
            r.status && r.status !== "active" ? humanise(r.status) : null,
          ].filter(Boolean).join(" · ") || undefined,
        }),
      },
      {
        id: "leads", label: "Leads", noun: "leads", icon: Sparkles, data: results.leads, list: `/dashboard/leads?q=${enc}`,
        row: (r) => ({
          key: `lead:${r.id}`,
          href: `/dashboard/leads/${r.id}`,
          title: r.name,
          sub: [r.stage ? humanise(r.stage) : null, r.source ? humanise(r.source) : null, r.owner_name].filter(Boolean).join(" · ") || undefined,
        }),
      },
      {
        id: "families", label: "Families", noun: "families", icon: HeartHandshake, data: results.families, list: `/dashboard/families?q=${enc}`,
        row: (r) => ({
          key: `fam:${r.id}`,
          href: `/dashboard/families/${r.id}`,
          // Same fallback as the Families list: many households only have a head name.
          title: r.family_name || r.head_name || "Unnamed family",
          sub: [r.family_name ? r.head_name : null, r.family_code].filter(Boolean).join(" · ") || undefined,
        }),
      },
      {
        id: "tasks", label: "Tasks", noun: "tasks", icon: ListChecks, data: results.tasks, list: `/dashboard/tasks?q=${enc}`,
        row: (r) => ({
          key: `task:${r.id}`,
          href: `/dashboard/tasks?task=${r.id}`,
          title: r.title,
          sub: [
            r.investor_name,
            r.status ? humanise(r.status) : null,
            r.due_at ? `Due ${formatDate(r.due_at)}` : null,
            r.assignee_name,
          ].filter(Boolean).join(" · ") || undefined,
        }),
      },
      {
        id: "meetings", label: "Meetings", noun: "meetings", icon: Calendar, data: results.meetings, list: `/dashboard/review-meetings?q=${enc}`,
        row: (r) => ({
          key: `mtg:${r.id}`,
          href: `/dashboard/review-meetings/${r.id}`,
          title: r.subject || `${humanise(r.category ?? "meeting")} with ${r.person_name ?? "—"}`,
          sub: [
            r.meeting_date ? formatDate(r.meeting_date) : null,
            r.subject ? r.person_name : null,
            r.status ? humanise(r.status) : null,
            r.rm_name,
          ].filter(Boolean).join(" · ") || undefined,
        }),
      },
      {
        id: "requests", label: "Service requests", noun: "service requests", icon: LifeBuoy, data: results.serviceRequests,
        list: `/dashboard/service-requests?q=${enc}`,
        row: (r) => ({
          key: `sr:${r.id}`,
          href: `/dashboard/service-requests/${r.id}`,
          title: r.subject,
          sub: [r.ticket_no, r.investor_name, r.status ? humanise(r.status) : null].filter(Boolean).join(" · ") || undefined,
        }),
      },
      {
        id: "policies", label: "Insurance policies", noun: "policies", icon: Shield, data: results.policies, list: `/dashboard/insurance?q=${enc}`,
        row: (r) => ({
          key: `pol:${r.id}`,
          href: `/dashboard/insurance/${r.id}`,
          title: r.policy_number ?? "(no number)",
          sub: [r.insurer, r.policy_type ? humanise(r.policy_type) : null, r.investor_name].filter(Boolean).join(" · ") || undefined,
        }),
      },
      {
        id: "folios", label: "Folios", noun: "folios", icon: FileText, data: results.folios,
        row: (r) => ({
          key: `folio:${r.id}`,
          href: r.investor_id ? `/dashboard/investors/${r.investor_id}` : "/dashboard/investors",
          title: r.folio_number,
          sub: [r.amc_name, r.investor_name].filter(Boolean).join(" · ") || undefined,
        }),
      },
      {
        id: "sips", label: "SIPs", noun: "SIPs", icon: Repeat, data: results.sips, list: `/dashboard/sips?q=${enc}`,
        row: (r) => ({
          key: `sip:${r.id}`,
          href: r.investor_id ? `/dashboard/investors/${r.investor_id}` : "/dashboard/sips",
          title: r.scheme_name,
          sub: [r.amount ? `${formatMoney(Number(r.amount))} a month` : null, r.investor_name, r.status ? humanise(r.status) : null]
            .filter(Boolean).join(" · ") || undefined,
        }),
      },
      {
        id: "documents", label: "Documents", noun: "documents", icon: FolderArchive, data: results.documents,
        row: (r) => ({
          key: `doc:${r.id}`,
          href: "/dashboard/documents",
          title: r.name,
          sub: r.category ? humanise(r.category) : undefined,
        }),
      },
    ];
    const recordSections: Section[] = kinds
      .filter((k) => (k.data?.length ?? 0) > 0)
      .map((k) => {
        const rows: Row[] = k.data!.map((r) => ({ ...k.row(r), icon: k.icon }));
        const count = totalOf(k.data);
        if (k.list && count > rows.length) {
          rows.push({ key: `all:${k.id}`, href: k.list, title: `See all ${count} ${k.noun}`, icon: ArrowRight });
        }
        return { id: k.id, label: k.label, icon: k.icon, rows, count };
      });

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
    out.push(...recordSections);
    if (reportRows.length > 0) {
      out.push({ id: "reports", label: "Reports", icon: BarChart3, rows: reportRows });
    }
    // One module picked: only its own section (and the recents of its kind).
    if (only) return out.filter((s) => s.id === currentModule.id || s.id === "recent");
    return out;
  }, [q, navItems, results, recentRecords, currentModule]);

  const flatRows = useMemo(() => sections.flatMap((s) => s.rows), [sections]);

  // Keep active index in bounds
  useEffect(() => {
    if (active >= flatRows.length) setActive(Math.max(0, flatRows.length - 1));
  }, [flatRows.length, active]);

  /** Which section a row sits in, so a recent record keeps its kind as a chip. */
  const sectionOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const sec of sections) for (const r of sec.rows) m.set(r.key, sec.id);
    return m;
  }, [sections]);

  function pick(row: Row) {
    saveRecent(row, RECORD_CHIP[sectionOf.get(row.key) ?? ""]);
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
      <div className={`relative w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-scale-in text-foreground ${pickerOpen ? "min-h-96" : ""}`}>
        {/* Search bar */}
        <div className="relative flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 border-b border-border bg-card">
          <button
            type="button"
            onClick={() => {
              setPickerOpen((v) => !v);
              setPickerQ("");
              setPickerActive(Math.max(0, [ALL_MODULES, ...availableModules].findIndex((m) => m.id === currentModule.id)));
            }}
            aria-haspopup="listbox"
            aria-expanded={pickerOpen}
            aria-label={`Search in: ${currentModule.label}`}
            className={buttonClass("secondary", "sm", "shrink-0 max-w-32 sm:max-w-44 min-w-0")}
          >
            <span className="truncate">{currentModule.label}</span>
            <ChevronDown className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${pickerOpen ? "rotate-180" : ""}`} />
          </button>
          {pickerOpen && (
            <>
              <div className="fixed inset-0 z-10" onMouseDown={closePicker} />
              <div
                className="absolute left-3 sm:left-4 top-full z-20 mt-1 w-64 max-w-[calc(100%-1.5rem)] rounded-xl border border-border bg-card p-2 shadow-xl"
                onKeyDown={onPickerKeyDown}
              >
                <div className="flex items-center gap-2 rounded-lg border border-border px-2.5 h-8 focus-within:border-primary">
                  <Search className="size-3.5 text-muted-foreground shrink-0" />
                  <input
                    ref={pickerInputRef}
                    type="text"
                    value={pickerQ}
                    onChange={(e) => {
                      setPickerQ(e.target.value);
                      setPickerActive(0);
                    }}
                    aria-label="Search modules"
                    placeholder="Search Modules"
                    className="w-full bg-transparent border-0 outline-hidden text-sm placeholder:text-muted-foreground focus:ring-0"
                  />
                </div>
                <div ref={pickerListRef} role="listbox" aria-label="Modules" className="mt-1.5 max-h-60 overflow-y-auto space-y-0.5">
                  {pickerRows.length === 0 ? (
                    <div className="px-2.5 py-3 text-sm text-muted-foreground">No modules</div>
                  ) : (
                    pickerRows.map((m, i) => {
                      const selected = m.id === currentModule.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          data-active={i === pickerActive}
                          onClick={() => chooseModule(m.id)}
                          onMouseEnter={() => setPickerActive(i)}
                          className={`${MENU_ITEM} ${i === pickerActive ? "bg-secondary text-foreground" : ""}`}
                        >
                          <span className="size-4 shrink-0 grid place-items-center">
                            {selected && <Check className="size-4 text-primary" />}
                          </span>
                          <span className="truncate">{m.label}</span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </>
          )}
          <Search className="hidden sm:block size-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            aria-label={`Search ${currentModule.noun}`}
            placeholder={
              currentModule.id === "all"
                ? "Search clients, leads, tasks, meetings or pages (type > for actions)…"
                : `Search ${currentModule.noun}…`
            }
            className="w-full min-w-0 bg-transparent border-0 outline-hidden text-sm placeholder:text-muted-foreground focus:ring-0"
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
              {q.trim() === "" ? (
                <p className="text-sm font-medium">Start typing to search {currentModule.noun}</p>
              ) : (
                <>
                  <p className="text-sm font-medium">No results found for “{q}”</p>
                  {currentModule.id === "all" && (
                    <p className="text-xs text-muted-foreground mt-1">Try a client name, PAN, mobile, folio number or a page name.</p>
                  )}
                </>
              )}
            </div>
          ) : (
            sections.map((section) => (
              <div key={section.id} className="space-y-1">
                <div className="px-3 py-1 text-2xs font-bold tracking-wider uppercase text-muted-foreground flex items-center gap-1.5">
                  <section.icon className="size-3 text-brand-navy" />
                  <span>{section.label}</span>
                  {section.count != null && section.count > 0 && (
                    <span className="ml-0.5 rounded bg-muted px-1.5 font-semibold tabular-nums normal-case tracking-normal">{section.count}</span>
                  )}
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
