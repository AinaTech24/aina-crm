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
import { reportDisplayName } from "@/lib/reports/display";

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
  equity_dmat: "DMAT Accounts",
  new_client: "New Clients",
  sip_rejection: "SIP Rejections",
  client_gap: "Client Data Gaps",
};
const TYPE_META: Record<string, { label: string; icon: typeof Table2 }> = {
  detailed: { label: "Detailed", icon: Table2 },
  summary: { label: "Summary", icon: Rows3 },
  matrix: { label: "Matrix", icon: Grid3x3 },
};
const SHARING: Record<string, string> = { private: "Only me", team: "Team", tenant: "Everyone" };

/** We Care's simpler list (2026-11-23): reports grouped by the area of work they answer. */
const AREAS: Array<{ label: string; subjects: string[] }> = [
  { label: "Business", subjects: ["business_line", "business_entry", "transaction"] },
  { label: "SIP", subjects: ["sip", "sip_rejection"] },
  { label: "Equity", subjects: ["equity_brokerage", "equity_dmat"] },
  { label: "Clients", subjects: ["investor", "new_client", "client_gap", "goal"] },
  { label: "Leads & meetings", subjects: ["lead", "review_meeting"] },
  { label: "Back office", subjects: ["task", "service_request"] },
  { label: "Insurance", subjects: ["insurance", "claim"] },
];
const areaOf = (subject: string) => AREAS.findIndex((a) => a.subjects.includes(subject));

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
  // The simpler list, for a firm with the Zoho import flag (We Care).
  const [simple, setSimple] = useState(false);
  useEffect(() => {
    fetch("/api/imports/zoho/contacts").then((r) => r.json()).then((j) => setSimple(!!j?.enabled)).catch(() => {});
  }, []);

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
      {!simple && (
        <Link href="/dashboard/reports" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 print:hidden">
          <ChevronLeft className="size-4" /> Back to reports
        </Link>
      )}

      <PageHeaderCard title={simple ? "Reports" : <><BarChart3 className="size-6 text-muted-foreground" /> Custom Reports</>} actions={<><Link href="/dashboard/reports/custom/new" className="btn-primary">
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
            ) : simple ? (
              <SimpleList
                rows={filtered}
                grouped={activeFolder === ALL && !q}
                isBin={isBin}
                when={isBin ? "Deleted" : activeFolder === RECENT ? "Last viewed" : null}
                onStar={toggleStar}
                onClone={clone}
                onDelete={del}
                onRestore={restoreReport}
                onErase={erase}
              />
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

/**
 * We Care's report list (2026-11-23): the report's name and what it answers,
 * grouped by area of work, the whole row opening the report. Module, type,
 * folder, creator and sharing columns — the same on nearly every row — are left out.
 */
function SimpleList({
  rows,
  grouped,
  isBin,
  when,
  onStar,
  onClone,
  onDelete,
  onRestore,
  onErase,
}: {
  rows: Report[];
  grouped: boolean;
  isBin: boolean;
  when: "Deleted" | "Last viewed" | null;
  onStar: (id: string, starred: boolean) => void;
  onClone: (id: string) => void;
  onDelete: (r: Report) => void;
  onRestore: (r: Report) => void;
  onErase: (r: Report) => void;
}) {
  const router = useRouter();
  const sections: Array<{ label: string | null; rows: Report[] }> = grouped
    ? [...AREAS.map((a) => a.label), "Other"]
        .map((label, i) => ({
          label,
          rows: rows
            .filter((r) => (areaOf(r.subject) === -1 ? i === AREAS.length : areaOf(r.subject) === i))
            .sort((a, b) => reportDisplayName(a.name).localeCompare(reportDisplayName(b.name))),
        }))
        .filter((s) => s.rows.length)
    : [{ label: null, rows }];

  return (
    <div className="divide-y divide-border">
      {sections.map((s) => (
        <section key={s.label ?? "all"}>
          {s.label && <h2 className="bg-secondary/40 px-4 py-2 text-xs font-semibold text-muted-foreground">{s.label}</h2>}
          <ul className="divide-y divide-border/60">
            {s.rows.map((r) => (
              <li
                key={r.id}
                className={`group flex items-center gap-3 px-4 py-3 ${isBin ? "" : "cursor-pointer hover:bg-secondary/30"}`}
                onClick={isBin ? undefined : () => router.push(`/dashboard/reports/custom/${r.id}`)}
              >
                {!isBin && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onStar(r.id, r.starred);
                    }}
                    aria-label={r.starred ? "Remove from favourites" : "Add to favourites"}
                    aria-pressed={r.starred}
                    className="btn-icon shrink-0 text-muted-foreground hover:text-warning"
                  >
                    <Star className={`size-4 ${r.starred ? "fill-warning text-warning" : ""}`} />
                  </button>
                )}
                <div className="min-w-0 flex-1">
                  {isBin ? (
                    <div className="font-medium">{reportDisplayName(r.name)}</div>
                  ) : (
                    <Link href={`/dashboard/reports/custom/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">
                      {reportDisplayName(r.name)}
                    </Link>
                  )}
                  {r.description && <div className="text-xs text-muted-foreground line-clamp-1">{r.description}</div>}
                </div>
                {when && (
                  <div className="shrink-0 text-xs text-muted-foreground">
                    {when} {formatDate(when === "Deleted" ? r.deletedAt : r.viewedAt)}
                  </div>
                )}
                <div className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                  {isBin ? (
                    <>
                      <button onClick={() => onRestore(r)} className="btn-icon" aria-label="Restore" title="Restore"><RotateCcw className="size-3.5" /></button>
                      <button onClick={() => onErase(r)} className="btn-icon hover:text-destructive" aria-label="Delete forever" title="Delete forever"><Trash2 className="size-3.5" /></button>
                    </>
                  ) : (
                    <div className="flex items-center gap-0.5 opacity-60 group-hover:opacity-100">
                      <button onClick={() => onClone(r.id)} className="btn-icon" aria-label="Make a copy" title="Make a copy"><Copy className="size-3.5" /></button>
                      {r.isMine && (
                        <Link href={`/dashboard/reports/custom/new?edit=${r.id}`} className="btn-icon" aria-label="Edit" title="Edit"><Pencil className="size-3.5" /></Link>
                      )}
                      {r.isMine && (
                        <button onClick={() => onDelete(r)} className="btn-icon hover:text-destructive" aria-label="Delete" title="Delete"><Trash2 className="size-3.5" /></button>
                      )}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
