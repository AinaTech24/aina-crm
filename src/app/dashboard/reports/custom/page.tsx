"use client";

/**
 * Custom Reports — the list, with Zoho's folder rail (2026-11-19): All,
 * Favourites, Recently viewed, Created by me, Shared with me, Scheduled,
 * Recently deleted (restore for 30 days), then the custom folders.
 */

import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { useEffect, useMemo, useState } from "react";
import { notify } from "@/components/ui/Toast";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BarChart3, Plus, Star, Search, Trash2, Pencil, Loader2, Table2, Grid3x3, Rows3, ChevronLeft, Copy, Folder, FolderOpen, Inbox,
  History, UserRound, Users, CalendarClock, RotateCcw,
} from "lucide-react";
import { confirmDialog } from "@/components/ui/ConfirmProvider";
import { formatDate } from "@/lib/format";

type Report = {
  id: string;
  name: string;
  description: string | null;
  subject: string;
  reportType: "detailed" | "summary" | "matrix";
  sharedScope: string;
  folder: string | null;
  starred: boolean;
  isMine: boolean;
  updatedAt: string;
  deletedAt: string | null;
  viewedAt: string | null;
  createdByName: string | null;
  scheduled: boolean;
};

const SUBJECT_LABEL: Record<string, string> = {
  investor: "Clients",
  lead: "Leads",
  task: "Tasks",
  user: "Users",
  transaction: "MF Transactions",
  sip: "SIPs",
  insurance: "Insurance",
  goal: "Goals",
  service_request: "Service Requests",
  claim: "Insurance Claims",
  review_meeting: "Meetings",
  business_line: "Business Entries",
  equity_brokerage: "Equity Brokerage",
};
const TYPE_META: Record<string, { label: string; icon: typeof Table2 }> = {
  detailed: { label: "Detailed", icon: Table2 },
  summary: { label: "Summary", icon: Rows3 },
  matrix: { label: "Matrix", icon: Grid3x3 },
};
const SHARING: Record<string, string> = { private: "Only me", team: "Team", tenant: "Everyone" };

const ALL = "__all__";
const FAV = "__fav__";
const RECENT = "__recent__";
const MINE = "__mine__";
const SHARED = "__shared__";
const SCHEDULED = "__scheduled__";
const DELETED = "__deleted__";

export default function CustomReportsPage() {
  const router = useRouter();
  const [reports, setReports] = useState<Report[]>([]);
  const [deleted, setDeleted] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [activeFolder, setActiveFolder] = useState<string>(ALL);

  async function load() {
    setLoading(true);
    try {
      const [live, bin] = await Promise.all([
        fetch("/api/reports/saved").then((r) => r.json()),
        fetch("/api/reports/saved?deleted=1").then((r) => r.json()),
      ]);
      setReports(live.reports ?? []);
      setDeleted(bin.reports ?? []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function toggleStar(id: string, starred: boolean) {
    setReports((rs) => rs.map((r) => (r.id === id ? { ...r, starred: !starred } : r)));
    await fetch(`/api/reports/saved/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ star: !starred }),
    });
  }
  async function del(r: Report) {
    if (!(await confirmDialog({ title: `Delete "${r.name}"?`, message: "It moves to Recently deleted, where you can restore it for 30 days.", confirmLabel: "Delete", tone: "danger" }))) return;
    const res = await fetch(`/api/reports/saved/${r.id}`, { method: "DELETE" });
    if (!res.ok) notify.error((await res.json()).error ?? "Delete failed");
    load();
  }
  async function restoreReport(r: Report) {
    const res = await fetch(`/api/reports/saved/${r.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ restore: true }) });
    if (!res.ok) return notify.error((await res.json()).error ?? "Restore failed");
    notify.success(`"${r.name}" restored`);
    load();
  }
  async function erase(r: Report) {
    if (!(await confirmDialog({ title: `Delete "${r.name}" for good?`, message: "This cannot be undone.", confirmLabel: "Delete forever", tone: "danger" }))) return;
    const res = await fetch(`/api/reports/saved/${r.id}?permanent=1`, { method: "DELETE" });
    if (!res.ok) notify.error((await res.json()).error ?? "Delete failed");
    load();
  }
  async function clone(id: string) {
    const r = await fetch(`/api/reports/saved/${id}/clone`, { method: "POST" });
    const j = await r.json();
    if (r.ok && j.id) router.push(`/dashboard/reports/custom/new?edit=${j.id}`);
    else notify.error(j.error ?? "Clone failed");
  }

  // Folder list (custom folders, sorted) + counts.
  const folders = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of reports) if (r.folder) m.set(r.folder, (m.get(r.folder) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [reports]);

  const inView = (r: Report) => {
    switch (activeFolder) {
      case ALL:
        return true;
      case FAV:
        return r.starred;
      case RECENT:
        return !!r.viewedAt;
      case MINE:
        return r.isMine;
      case SHARED:
        return !r.isMine;
      case SCHEDULED:
        return r.scheduled;
      default:
        return r.folder === activeFolder;
    }
  };
  const isBin = activeFolder === DELETED;
  const ql = q.toLowerCase();
  const filtered = (isBin ? deleted : reports.filter(inView))
    .filter((r) => r.name.toLowerCase().includes(ql) || (r.description ?? "").toLowerCase().includes(ql))
    .sort((a, b) =>
      activeFolder === RECENT ? (b.viewedAt ?? "").localeCompare(a.viewedAt ?? "") : (b.starred ? 1 : 0) - (a.starred ? 1 : 0)
    );

  const counts = {
    [ALL]: reports.length,
    [FAV]: reports.filter((r) => r.starred).length,
    [RECENT]: reports.filter((r) => r.viewedAt).length,
    [MINE]: reports.filter((r) => r.isMine).length,
    [SHARED]: reports.filter((r) => !r.isMine).length,
    [SCHEDULED]: reports.filter((r) => r.scheduled).length,
    [DELETED]: deleted.length,
  };

  const FolderBtn = ({ value, label, count, icon: Icon }: { value: string; label: string; count: number; icon: typeof Folder }) => (
    <button
      onClick={() => setActiveFolder(value)}
      aria-current={activeFolder === value ? "page" : undefined}
      className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-md text-sm transition-colors ${activeFolder === value ? "bg-brand-navy text-white" : "hover:bg-secondary/60 text-foreground/80"}`}
    >
      <span className="flex items-center gap-2 truncate"><Icon className="size-3.5 shrink-0" /> {label}</span>
      <span className={`text-xs ${activeFolder === value ? "text-white/70" : "text-muted-foreground"}`}>{count}</span>
    </button>
  );

  return (
    <div className="space-y-4">
      <Link href="/dashboard/reports" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 print:hidden">
        <ChevronLeft className="size-4" /> Back to reports
      </Link>

      <PageHeaderCard title={<><BarChart3 className="size-6 text-muted-foreground" /> Custom Reports</>} actions={<><Link href="/dashboard/reports/custom/new" className="btn-primary">
          <Plus className="size-4" /> New report
        </Link></>} />

      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-4">
        {/* Folder rail */}
        <aside className="card-surface p-2 h-fit space-y-0.5">
          <FolderBtn value={ALL} label="All Reports" count={counts[ALL]} icon={Inbox} />
          <FolderBtn value={FAV} label="Favourites" count={counts[FAV]} icon={Star} />
          <FolderBtn value={RECENT} label="Recently viewed" count={counts[RECENT]} icon={History} />
          <FolderBtn value={MINE} label="Created by me" count={counts[MINE]} icon={UserRound} />
          <FolderBtn value={SHARED} label="Shared with me" count={counts[SHARED]} icon={Users} />
          <FolderBtn value={SCHEDULED} label="Scheduled" count={counts[SCHEDULED]} icon={CalendarClock} />
          <FolderBtn value={DELETED} label="Recently deleted" count={counts[DELETED]} icon={Trash2} />
          {folders.length > 0 && <div className="px-3 pt-2 pb-1 text-2xs uppercase tracking-wide text-muted-foreground">Folders</div>}
          {folders.map(([name, count]) => (
            <FolderBtn key={name} value={name} label={name} count={count} icon={activeFolder === name ? FolderOpen : Folder} />
          ))}
        </aside>

        <div className="space-y-3">
          <div className="relative max-w-sm">
            <Search className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search reports…" aria-label="Search reports" className="input-base pl-9" />
          </div>
          {isBin && <p className="text-xs text-muted-foreground">Deleted reports stay here for 30 days, then they are removed for good.</p>}

          <div className="card-surface overflow-hidden">
            {loading ? (
              <div className="p-12 grid place-items-center text-muted-foreground"><Loader2 className="size-6 animate-spin" /></div>
            ) : filtered.length === 0 ? (
              <div className="p-12 text-center text-sm text-muted-foreground">
                <BarChart3 className="size-8 mx-auto text-muted-foreground/40" />
                <div className="mt-2 font-medium">{isBin ? "Nothing deleted." : reports.length === 0 ? "No custom reports yet." : "No reports here."}</div>
                {!isBin && (
                  <Link href="/dashboard/reports/custom/new" className="text-brand-cyan-deep hover:underline text-xs mt-1 inline-block">
                    + Build your first report
                  </Link>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      {!isBin && <th className="relative w-8 px-3 py-2"><span className="sr-only">Favourite</span></th>}
                      <th className="text-left px-2 py-2">Name</th>
                      <th className="text-left py-2">Module</th>
                      <th className="text-left py-2">Type</th>
                      <th className="text-left py-2">Folder</th>
                      <th className="text-left py-2">Created by</th>
                      <th className="text-left py-2">{isBin ? "Deleted" : activeFolder === RECENT ? "Last viewed" : "Sharing"}</th>
                      <th className="text-right py-2 px-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => {
                      const tm = TYPE_META[r.reportType] ?? TYPE_META.detailed;
                      const TIcon = tm.icon;
                      return (
                        <tr key={r.id}>
                          {!isBin && (
                            <td className="px-3 py-2.5">
                              <button onClick={() => toggleStar(r.id, r.starred)} aria-label={r.starred ? "Remove from favourites" : "Add to favourites"} aria-pressed={r.starred} className="text-muted-foreground hover:text-warning">
                                <Star className={`size-4 ${r.starred ? "fill-warning text-warning" : ""}`} />
                              </button>
                            </td>
                          )}
                          <td className="px-2 py-2.5">
                            {isBin ? (
                              <span className="font-medium">{r.name}</span>
                            ) : (
                              <Link href={`/dashboard/reports/custom/${r.id}`} className="font-medium hover:underline">{r.name}</Link>
                            )}
                            {r.description && <div className="text-xs text-muted-foreground line-clamp-1">{r.description}</div>}
                          </td>
                          <td className="py-2.5 text-xs">{SUBJECT_LABEL[r.subject] ?? r.subject}</td>
                          <td className="py-2.5">
                            <span className="chip bg-secondary/70 text-foreground/80 inline-flex items-center gap-1">
                              <TIcon className="size-3" /> {tm.label}
                            </span>
                            {r.scheduled && !isBin && <CalendarClock className="inline size-3.5 ml-1.5 text-muted-foreground" aria-label="Scheduled" />}
                          </td>
                          <td className="py-2.5 text-xs text-muted-foreground">{r.folder ?? "—"}</td>
                          <td className="py-2.5 text-xs text-muted-foreground">{r.isMine ? "Me" : (r.createdByName ?? "—")}</td>
                          <td className="py-2.5 text-xs text-muted-foreground">
                            {isBin ? formatDate(r.deletedAt) : activeFolder === RECENT ? formatDate(r.viewedAt) : (SHARING[r.sharedScope] ?? r.sharedScope)}
                          </td>
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            {isBin ? (
                              <>
                                <button onClick={() => restoreReport(r)} className="btn-icon inline-grid" aria-label="Restore" title="Restore"><RotateCcw className="size-3.5" /></button>
                                <button onClick={() => erase(r)} className="btn-icon inline-grid hover:text-destructive" aria-label="Delete forever" title="Delete forever"><Trash2 className="size-3.5" /></button>
                              </>
                            ) : (
                              <>
                                <button onClick={() => clone(r.id)} className="btn-icon inline-grid" aria-label="Clone" title="Clone"><Copy className="size-3.5" /></button>
                                {r.isMine && (
                                  <Link href={`/dashboard/reports/custom/new?edit=${r.id}`} className="btn-icon inline-grid" aria-label="Edit" title="Edit"><Pencil className="size-3.5" /></Link>
                                )}
                                {r.isMine && (
                                  <button onClick={() => del(r)} className="btn-icon inline-grid hover:text-destructive" aria-label="Delete" title="Delete"><Trash2 className="size-3.5" /></button>
                                )}
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
