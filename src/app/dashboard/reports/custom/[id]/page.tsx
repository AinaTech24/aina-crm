"use client";

/**
 * A custom report, as Zoho runs one (2026-11-19):
 *   - Filters: quick filters on top of the saved ones, for this view only (the
 *     creator can save them into the report). Export follows the view.
 *   - Click a summary group or a matrix cell → the records behind it.
 *   - A detailed report pages through every row (total shown) and sorts by
 *     any column header; each row opens its record.
 *   - Summary: Hide / Show details; charts on summary as well as matrix, with
 *     the saved target line.
 * A firm with the Zoho import flag (We Care) also gets its "Filter by" date
 * bar and Zoho's grouped summary layout (ReportFilterBar / GroupedSummaryTable).
 */

import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { notify } from "@/components/ui/Toast";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ChevronLeft, Download, Pencil, Loader2, BarChart3, AlertCircle, Copy, Mail, Printer, FileSpreadsheet, FileText, ChevronDown, Send, Filter, Star, X } from "lucide-react";
import { DownloadButton } from "@/components/common/SecureLinkButtons";
import { Button } from "@/components/ui/Button";
import { FilterBuilder } from "@/components/filter/FilterBuilder";
import { TeamMultiSelect } from "@/components/common/TeamMultiSelect";
import { DetailedTable, MatrixTable, SummaryTable, summaryAsChart, type Drill, type RunResult } from "@/components/reports/custom/ReportTables";
import { DrillSheet } from "@/components/reports/custom/DrillSheet";
import { CATALOGS } from "@/lib/filter/catalog";
import { ReportFilterBar, reportFilterQuery, type ReportFilter } from "@/components/reports/ReportFilterBar";
import { GroupedSummaryTable } from "@/components/reports/GroupedSummaryTable";
import { RecordPanelProvider } from "@/components/reports/RecordPanel";
import { isMonthKeys, periodLabel, reportDisplayName } from "@/lib/reports/display";

// Recharts is heavy + not tree-shakeable; load it only when a report actually
// has a chart, not on every report view.
const ReportChart = dynamic(() => import("@/components/reports/ReportChart"), {
  ssr: false,
  loading: () => <div className="skeleton h-72 w-full rounded-xl" />,
});

type Group = { type: "group"; op: "AND" | "OR"; not?: boolean; children: any[] };
type Meta = {
  name: string;
  description?: string | null;
  subject: string;
  reportType: string;
  chartType?: string | null;
  /** The firm's branch names for the Branch picker; empty when the module has no branch. */
  branches?: string[];
  desks?: Array<{ name: string; branch: string }>;
  clientPick?: { family: boolean; category: boolean } | null;
  chartOptions?: { target?: number | null; limit?: number | null } | null;
  ast?: Group | null;
  isMine?: boolean;
  starred?: boolean;
};

const PAGE = 100;
const emptyGroup = (): Group => ({ type: "group", op: "AND", children: [] });
/** Conditions actually set (a predicate, or a group holding one). */
const countConditions = (g: Group): number =>
  g.children.reduce((n, c) => n + (c.type === "group" ? countConditions(c) : 1), 0);

export default function ReportViewPage() {
  const id = (useParams() as { id: string }).id;
  const router = useRouter();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  // The viewer's quick filters: a draft being edited, and what is applied.
  const [showFilters, setShowFilters] = useState(false);
  const [draft, setDraft] = useState<Group>(emptyGroup());
  const [applied, setApplied] = useState<Group | null>(null);
  const [sort, setSort] = useState<{ field: string; dir: "asc" | "desc" } | null | undefined>(undefined);
  const [offset, setOffset] = useState(0);
  const [showDetails, setShowDetails] = useState(true);
  const [drill, setDrill] = useState<Drill[] | null>(null);
  // Zoho-style "Filter by" date range + "Show details" — for a firm with the
  // Zoho import flag (We Care, 2026-11-19). They narrow this run only.
  const [zohoParity, setZohoParity] = useState(false);
  const [zFilter, setZFilter] = useState<ReportFilter | null>(null);
  const [zQuery, setZQuery] = useState("");
  useEffect(() => {
    fetch("/api/imports/zoho/contacts").then((r) => r.json()).then((j) => setZohoParity(!!j?.enabled)).catch(() => {});
  }, []);
  const dateFields: Array<{ key: string; label: string }> = useMemo(
    () => (meta?.subject ? (CATALOGS[meta.subject]?.fields ?? []).filter((f) => f.type === "date" || f.type === "datetime") : []),
    [meta?.subject],
  );
  // The bar starts on the module's first date field, all time.
  useEffect(() => {
    if (zohoParity && meta && !zFilter) {
      // The first run must follow the bar too: details off until "Show details" is ticked.
      const initial: ReportFilter = { field: dateFields[0]?.key ?? "", period: "", from: "", to: "", details: false };
      setZFilter(initial);
      setZQuery(reportFilterQuery(initial));
    }
  }, [zohoParity, meta, zFilter, dateFields]);
  function applyZFilter(f: ReportFilter) {
    setZFilter(f);
    setZQuery(reportFilterQuery(f));
    setOffset(0);
  }

  useEffect(() => {
    fetch(`/api/reports/saved/${id}`)
      .then(async (r) => {
        const m = await r.json();
        if (!r.ok) throw new Error(m.error ?? "Report not found");
        setMeta(m);
      })
      .catch((e) => setErr(e.message));
  }, [id]);

  const run = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/reports/saved/${id}/run${zQuery ? `?${zQuery}` : ""}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filter: applied, ...(sort !== undefined ? { sort } : {}), limit: PAGE, offset }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Failed to run report");
      setResult(j.result);
    } catch (e: any) {
      setErr(e.message ?? "Failed to run report");
    } finally {
      setLoading(false);
    }
  }, [id, applied, sort, offset, zQuery]);
  useEffect(() => {
    void run();
  }, [run]);

  const filterCount = applied ? countConditions(applied) : 0;
  const exportQuery = filterCount ? `&filter=${encodeURIComponent(JSON.stringify(applied))}` : "";

  function applyFilters() {
    setApplied(countConditions(draft) ? draft : null);
    setOffset(0);
    setShowFilters(false);
  }
  function clearFilters() {
    setDraft(emptyGroup());
    setApplied(null);
    setOffset(0);
  }
  async function saveFiltersToReport() {
    if (!applied || !meta) return;
    const saved = meta.ast && countConditions(meta.ast) ? meta.ast : null;
    const ast = saved ? { type: "group", op: "AND", children: [saved, applied] } : applied;
    const r = await fetch(`/api/reports/saved/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ast }) });
    const j = await r.json();
    if (!r.ok) return notify.error(j.error ?? "Could not save the filters");
    setMeta((m) => (m ? { ...m, ast: ast as Group } : m));
    clearFilters();
    notify.success("Filters saved into the report");
  }

  function sortBy(field: string) {
    const current = sort === undefined ? null : sort;
    setSort(current?.field === field ? { field, dir: current.dir === "asc" ? "desc" : "asc" } : { field, dir: "asc" });
    setOffset(0);
  }

  async function clone() {
    const r = await fetch(`/api/reports/saved/${id}/clone`, { method: "POST" });
    const j = await r.json();
    if (r.ok && j.id) router.push(`/dashboard/reports/custom/new?edit=${j.id}`);
    else notify.error(j.error ?? "Clone failed");
  }
  async function toggleStar() {
    if (!meta) return;
    const star = !meta.starred;
    setMeta({ ...meta, starred: star });
    await fetch(`/api/reports/saved/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ star }) });
  }

  const chart = useMemo(() => {
    if (!result || !meta?.chartType || meta.chartType === "none") return null;
    if (result.kind === "matrix") return result;
    if (result.kind === "summary") {
      const c = summaryAsChart(result);
      if (!zohoParity) return c;
      // We Care: months read "Nov 2026", and with no period picked the chart shows the
      // last 12 months — all time since 2017 squeezed the months that matter.
      const months = isMonthKeys(c.rows.map((r) => r.key));
      const rows = months && !zFilter?.period ? c.rows.slice(-12) : c.rows;
      return { ...c, rows: rows.map((r) => ({ ...r, label: periodLabel(r.label) })) };
    }
    return null;
  }, [result, meta?.chartType, zohoParity, zFilter?.period]);

  const sortForTable = sort === undefined ? null : sort;

  return (
    <div className={`space-y-4 print:max-w-none ${zohoParity ? "" : "max-w-6xl"}`}>
      {!zohoParity && (
        <div className="print:hidden">
          <Link href="/dashboard/reports/custom" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
            <ChevronLeft className="size-4" /> Back to custom reports
          </Link>
        </div>
      )}

      <PageHeaderCard
        title={
          <>
            {!zohoParity && <BarChart3 className="size-6 text-muted-foreground print:hidden" />}{" "}
            {meta ? (zohoParity ? reportDisplayName(meta.name) : meta.name) : "Report"}
            {meta && (
              <button type="button" onClick={toggleStar} className="btn-icon print:hidden" aria-label={meta.starred ? "Remove from favourites" : "Add to favourites"} aria-pressed={!!meta.starred}>
                <Star className={`size-4 ${meta.starred ? "fill-warning text-warning" : "text-muted-foreground"}`} />
              </button>
            )}
          </>
        }
        actions={
          zohoParity ? (
            <div className="flex flex-wrap gap-2 print:hidden">
              <Button size="sm" variant="secondary" icon={<Filter className="size-3.5" />} onClick={() => setShowFilters((s) => !s)}>
                Filters{filterCount ? ` (${filterCount})` : ""}
              </Button>
              <MoreMenu id={id} canEdit={!!meta?.isMine} onClone={clone} />
              <ExportMenu id={id} query={exportQuery} />
            </div>
          ) : (
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button size="sm" variant={filterCount ? "primary" : "secondary"} icon={<Filter className="size-3.5" />} onClick={() => setShowFilters((s) => !s)}>
              Filters{filterCount ? ` (${filterCount})` : ""}
            </Button>
            {meta?.isMine && (
              <Link href={`/dashboard/reports/custom/new?edit=${id}`} className="btn-secondary text-xs">
                <Pencil className="size-3.5" /> Edit
              </Link>
            )}
            <Button size="sm" icon={<Copy className="size-3.5" />} onClick={clone}>
              Clone
            </Button>
            <SendMenu id={id} />
            <ExportMenu id={id} query={exportQuery} />
          </div>
          )
        }
      >
        {meta?.description && <p className="page-subtitle">{meta.description}</p>}
      </PageHeaderCard>

      {zohoParity && meta && zFilter && (
        <ReportFilterBar dateFields={dateFields} showDetailsSwitch={meta.reportType === "summary"} value={zFilter} onApply={applyZFilter} branches={meta.branches ?? []} desks={meta.desks ?? []} clientPick={meta.clientPick ?? null} />
      )}

      {showFilters && meta && (
        <div className="card-surface p-4 space-y-3 print:hidden">
          <div className="text-sm font-medium">Filter this view</div>
          <FilterBuilder subject={meta.subject} value={draft} onChange={setDraft} teamLookup={zohoParity} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={applyFilters}>
              Apply
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowFilters(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {filterCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm print:hidden">
          <span className="chip bg-primary/10 text-primary">
            {filterCount} filter{filterCount === 1 ? "" : "s"} on this view
          </span>
          <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={clearFilters}>
            Clear
          </Button>
          {meta?.isMine && (
            <Button size="sm" variant="ghost" onClick={saveFiltersToReport}>
              Save into the report
            </Button>
          )}
        </div>
      )}

      {!loading && !err && chart && meta?.chartType && (
        <div className="card-surface p-5">
          <ReportChart chartType={meta.chartType as any} matrix={chart} target={meta.chartOptions?.target ?? null} limit={meta.chartOptions?.limit ?? null} />
        </div>
      )}

      {result?.kind === "summary" && result.showDetailRows && !zohoParity && (
        <div className="flex justify-end print:hidden">
          <Button size="sm" variant="ghost" onClick={() => setShowDetails((s) => !s)}>
            {showDetails ? "Hide details" : "Show details"}
          </Button>
        </div>
      )}

      <RecordPanelProvider
        subject={meta?.subject ?? ""}
        linkBase={result && "linkBase" in result ? result.linkBase : null}
        onSaved={() => {
          void run();
          setDrill((d) => (d ? [...d] : d));
        }}
      >
      <div className={`card-surface overflow-hidden ${loading && result ? "opacity-60" : ""}`}>
        {loading && !result ? (
          <div className="p-12 grid place-items-center text-muted-foreground">
            <Loader2 className="size-6 animate-spin" />
          </div>
        ) : err ? (
          <div className="p-8 text-center text-sm text-destructive flex flex-col items-center gap-2">
            <AlertCircle className="size-6" /> {err}
          </div>
        ) : result?.kind === "detailed" ? (
          <DetailedTable r={result} sort={sortForTable} onSort={sortBy} />
        ) : result?.kind === "matrix" ? (
          <MatrixTable
            r={
              zohoParity
                ? { ...result, colLabels: result.colLabels.map(periodLabel), rows: result.rows.map((row) => ({ ...row, label: periodLabel(row.label) })) }
                : result
            }
            onDrill={setDrill}
          />
        ) : result?.kind === "summary" ? (
          zohoParity ? <GroupedSummaryTable r={result} /> : <SummaryTable r={result} showDetails={showDetails} onDrill={setDrill} />
        ) : null}
      </div>

      {result?.kind === "detailed" && result.total > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground print:hidden">
          <span>
            {(offset + 1).toLocaleString("en-IN")}–{(offset + result.rows.length).toLocaleString("en-IN")} of {result.total.toLocaleString("en-IN")}
          </span>
          <Button size="sm" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
            Previous
          </Button>
          <Button size="sm" disabled={offset + result.rows.length >= result.total || loading} onClick={() => setOffset(offset + PAGE)}>
            Next
          </Button>
        </div>
      )}
      {!zohoParity && (result?.kind === "summary" || result?.kind === "matrix") && (
        <p className="text-xs text-muted-foreground print:hidden">Click a group or a number to see the records behind it.</p>
      )}

      <DrillSheet reportId={id} drill={drill} filter={applied} query={zQuery} onClose={() => setDrill(null)} />
      </RecordPanelProvider>
    </div>
  );
}

function useClickAway(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open, close]);
  return ref;
}

function ExportMenu({ id, query }: { id: string; query: string }) {
  const [open, setOpen] = useState(false);
  const ref = useClickAway(open, () => setOpen(false));
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="btn-primary text-xs">
        <Download className="size-4" /> Export <ChevronDown className="size-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-44 rounded-lg border border-border bg-card shadow-lg z-20 py-1 text-sm">
          <DownloadButton url={`/api/reports/saved/${id}/export?format=xlsx${query}`} className="w-full text-left flex items-center gap-2 px-3 py-2 hover:bg-secondary/50">
            <FileSpreadsheet className="size-4 text-success" /> Excel (.xlsx)
          </DownloadButton>
          <DownloadButton url={`/api/reports/saved/${id}/export?format=csv${query}`} className="w-full text-left flex items-center gap-2 px-3 py-2 hover:bg-secondary/50">
            <FileText className="size-4 text-primary" /> CSV (.csv)
          </DownloadButton>
          <button
            onClick={() => {
              setOpen(false);
              window.print();
            }}
            className="w-full text-left flex items-center gap-2 px-3 py-2 hover:bg-secondary/50"
          >
            <Printer className="size-4 text-muted-foreground" /> Print / PDF
          </button>
        </div>
      )}
    </div>
  );
}

/** We Care's simpler header (2026-11-23): Edit, Clone and Email folded into one menu. */
function MoreMenu({ id, canEdit, onClone }: { id: string; canEdit: boolean; onClone: () => void }) {
  const [open, setOpen] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const ref = useClickAway(open, () => {
    setOpen(false);
    setEmailing(false);
  });
  const item = "w-full text-left flex items-center gap-2 px-3 py-2 hover:bg-secondary/50";
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="btn-secondary text-xs" aria-expanded={open}>
        More <ChevronDown className="size-3.5" />
      </button>
      {open && (
        <div className={`absolute right-0 mt-1 rounded-lg border border-border bg-card shadow-lg z-20 text-sm ${emailing ? "w-80 p-3" : "w-44 py-1"}`}>
          {emailing ? (
            <SendForm id={id} />
          ) : (
            <>
              {canEdit && (
                <Link href={`/dashboard/reports/custom/new?edit=${id}`} className={item}>
                  <Pencil className="size-4 text-muted-foreground" /> Edit report
                </Link>
              )}
              <button onClick={() => { setOpen(false); onClone(); }} className={item}>
                <Copy className="size-4 text-muted-foreground" /> Make a copy
              </button>
              <button onClick={() => setEmailing(true)} className={item}>
                <Mail className="size-4 text-muted-foreground" /> Email this report
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SendForm({ id }: { id: string }) {
  const [userIds, setUserIds] = useState<string[]>([]);
  const [emails, setEmails] = useState("");
  const [attach, setAttach] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function send() {
    setBusy(true);
    setMsg(null);
    try {
      const list = emails.split(",").map((s) => s.trim()).filter(Boolean);
      const picked = list.length || userIds.length;
      const r = await fetch(`/api/reports/saved/${id}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(picked ? { emails: list, userIds } : {}), attach }),
      });
      const j = await r.json();
      setMsg(r.ok ? `Sent to ${j.sent} recipient${j.sent === 1 ? "" : "s"}.` : (j.error ?? "Send failed"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">Email this report now. With nobody picked it goes to the schedule's recipients.</div>
      <TeamMultiSelect value={userIds} onChange={setUserIds} max={50} placeholder="+ Add a team member" />
      <input value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="Other emails, comma separated" aria-label="Other emails" className="input-base text-xs" />
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} /> Attach as Excel
      </label>
      <Button size="sm" variant="primary" className="w-full justify-center" loading={busy} icon={<Send className="size-3.5" />} onClick={send}>
        Send now
      </Button>
      {msg && <div className="text-xs text-muted-foreground">{msg}</div>}
    </div>
  );
}

function SendMenu({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [userIds, setUserIds] = useState<string[]>([]);
  const [emails, setEmails] = useState("");
  const [attach, setAttach] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const ref = useClickAway(open, () => setOpen(false));
  async function send() {
    setBusy(true);
    setMsg(null);
    try {
      const list = emails.split(",").map((s) => s.trim()).filter(Boolean);
      const picked = list.length || userIds.length;
      const r = await fetch(`/api/reports/saved/${id}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(picked ? { emails: list, userIds } : {}), attach }),
      });
      const j = await r.json();
      setMsg(r.ok ? `Sent to ${j.sent} recipient${j.sent === 1 ? "" : "s"}.` : (j.error ?? "Send failed"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="btn-secondary text-xs">
        <Mail className="size-3.5" /> Email
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-80 rounded-lg border border-border bg-card shadow-lg z-20 p-3 space-y-2 text-sm">
          <div className="text-xs text-muted-foreground">Email this report now. With nobody picked it goes to the schedule's recipients.</div>
          <TeamMultiSelect value={userIds} onChange={setUserIds} max={50} placeholder="+ Add a team member" />
          <input value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="Other emails, comma separated" aria-label="Other emails" className="input-base text-xs" />
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} /> Attach as Excel
          </label>
          <Button size="sm" variant="primary" className="w-full justify-center" loading={busy} icon={<Send className="size-3.5" />} onClick={send}>
            Send now
          </Button>
          {msg && <div className="text-xs text-muted-foreground">{msg}</div>}
        </div>
      )}
    </div>
  );
}
