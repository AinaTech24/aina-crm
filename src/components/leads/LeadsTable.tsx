"use client";

/**
 * Leads table view with row selection + bulk actions + a sortable priority
 * Score column. Supports compact vs cozy table density and split-screen
 * side-peek drawer for rapid lead inspections.
 */

import { Fragment, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  ArrowUpDown,
  Eye,
} from "lucide-react";
import { RowActions } from "@/components/common/RowActions";
import { formatINR, formatDate } from "@/lib/utils";
import { leadScoreBand } from "@/lib/leads/scoring";
import { Avatar } from "@/components/ui/Avatar";
import { TableDensityToggle, useTableDensity } from "@/components/common/TableDensityToggle";
import { FloatingBulkBar } from "@/components/common/FloatingBulkBar";
import { LeadSidePeek, type SidePeekLead } from "@/components/leads/LeadSidePeek";
import { leadSourceLabel } from "@/lib/leads/sources";
import type { LeadExtraColumn } from "@/lib/leads/table-columns";

type Row = {
  id: string;
  name: string;
  avatarUrl: string | null;
  phone: string | null;
  email: string | null;
  stage: string;
  stageLabel: string;
  stageTone: string;
  source: string;
  intendedAmount: string | null;
  nextFollowUpAt: string | null;
  lastContactAt: string | null;
  createdAt: string | null;
  owner: string | null;
  score: number;
  /** Every other lead field, formatted on the server (null = blank). */
  cells: Record<string, string | null>;
  /** Values of the fields this person added from the column menu (`x:<field>` columns). */
  extra?: Record<string, string>;
};

/** The built-in columns in their default order (the extra lead fields follow, then Actions). */
const BASE_COLUMN_KEYS = ["score", "name", "stage", "intendedAmount", "source", "nextFollowUpAt", "lastContactAt", "owner", "createdAt"];

const toneStyles: Record<string, string> = {
  blue: "bg-blue-50 text-blue-700 border-blue-200",
  cyan: "bg-cyan-50 text-cyan-700 border-cyan-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  violet: "bg-violet-50 text-violet-700 border-violet-200",
  indigo: "bg-indigo-50 text-indigo-700 border-indigo-200",
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rose: "bg-rose-50 text-rose-700 border-rose-200",
  slate: "bg-secondary text-foreground border-border",
};
const sourceColors: Record<string, string> = {
  website: "bg-blue-50 text-blue-700 border-blue-200",
  referral: "bg-emerald-50 text-emerald-700 border-emerald-200",
  social_media: "bg-purple-50 text-purple-700 border-purple-200",
  meta_ads: "bg-purple-50 text-purple-700 border-purple-200",
  google: "bg-amber-50 text-amber-700 border-amber-200",
  cold_call: "bg-brand-cyan-light/50 text-brand-cyan-deep border-brand-cyan/30",
  existing_client: "bg-teal-50 text-teal-700 border-teal-200",
  manual: "bg-secondary text-foreground border-border",
  walk_in: "bg-teal-50 text-teal-700 border-teal-200",
  webinar: "bg-violet-50 text-violet-700 border-violet-200",
  other: "bg-secondary text-foreground border-border",
};

export function LeadsTable({
  rows,
  extraColumns,
  sort,
  dir = "desc",
  colOrder,
  addedCols = [],
}: {
  rows: Row[];
  extraColumns: LeadExtraColumn[];
  sort: string;
  dir?: "asc" | "desc";
  /** Column keys in the order to draw them (built-in keys and `x:<field>`); server-decided from the person's cookie. */
  colOrder?: string[];
  /** Fields the person added from "Manage columns" — drawn as `x:<key>`. */
  addedCols?: { key: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { density, toggleDensity, isCompact } = useTableDensity("cozy");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sidePeekLead, setSidePeekLead] = useState<SidePeekLead | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const allSelected = rows.length > 0 && selected.size === rows.length;

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }

  function setSort(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "table");
    if (next === "recent") params.delete("sort");
    else params.set("sort", next);
    if (sort === next) {
      params.set("dir", dir === "asc" ? "desc" : "asc");
    } else {
      params.delete("dir");
    }
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  async function handleBulkApply(action: string, payload: Record<string, any>) {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBusy(true);
    setErr(null);
    try {
      let value: string | null = null;
      if (action === "assign") value = payload.rmId ?? null;
      if (action === "stage") value = payload.stage ?? "call_done";

      const res = await fetch("/api/leads/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids, action, value }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? `Failed (${res.status})`);
        return;
      }
      // A lead whose journey is finished cannot be moved; say so rather than imply it moved.
      if (j.skipped) setErr(`${j.skipped} lead${j.skipped === 1 ? "" : "s"} not moved — the journey is already completed.`);
      setSelected(new Set());
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Bulk action failed");
    } finally {
      setBusy(false);
    }
  }

  const sortArrow = (key: string) => (sort === key ? (dir === "asc" ? "↑" : "↓") : "");

  // ── Columns, in the order this person chose ──────────────────────────────
  // Built-in columns, the other lead fields, and any field they added
  // (`x:<field>`); the server reads their cookie and hands the order down, so
  // nothing reshuffles after paint.
  const py = isCompact ? "py-1.5" : "py-2.5";
  const defaultOrder = [...BASE_COLUMN_KEYS, ...extraColumns.map((c) => c.key), "actions"];
  const known = new Set([...defaultOrder, ...addedCols.map((c) => `x:${c.key}`)]);
  const order = (colOrder && colOrder.length ? colOrder : defaultOrder).filter((k) => known.has(k));
  const extraByKey = new Map(extraColumns.map((c) => [c.key, c]));
  const addedLabel = (k: string) => addedCols.find((c) => `x:${c.key}` === k)?.label ?? k.slice(2);

  const heads: Record<string, ReactNode> = {
    score: (
      <th data-col="score" className={`${py} font-medium`}>
        <button onClick={() => setSort("score")} className="inline-flex items-center gap-1 hover:text-foreground">
          Score <ArrowUpDown className="size-3" /> {sortArrow("score")}
        </button>
      </th>
    ),
    name: <th data-col="name" className={`px-1 ${py} font-medium`}>Name</th>,
    stage: <th data-col="stage" className={`${py} font-medium`}>Stage</th>,
    intendedAmount: <th data-col="intendedAmount" className={`${py} font-medium text-right pr-6`}>Intended Amount</th>,
    source: <th data-col="source" className={`${py} font-medium`}>Source</th>,
    nextFollowUpAt: <th data-col="nextFollowUpAt" className={`${py} font-medium`}>Next Follow-Up</th>,
    lastContactAt: <th data-col="lastContactAt" className={`${py} font-medium`}>Last Contacted</th>,
    owner: <th data-col="owner" className={`${py} font-medium`}>Owner (RM)</th>,
    createdAt: (
      <th data-col="createdAt" className={`${py} font-medium`}>
        <button onClick={() => setSort("recent")} className="inline-flex items-center gap-1 hover:text-foreground">
          Created <ArrowUpDown className="size-3" /> {sortArrow("recent")}
        </button>
      </th>
    ),
    actions: <th data-col="actions" className={`px-4 ${py} text-right font-medium`}>Actions</th>,
  };
  for (const c of extraColumns) {
    heads[c.key] = <th data-col={c.key} className={`${py} font-medium whitespace-nowrap`}>{c.label}</th>;
  }
  for (const k of order) {
    if (k.startsWith("x:")) {
      heads[k] = <th data-col={k} className={`${py} font-medium whitespace-nowrap`}>{addedLabel(k)}</th>;
    }
  }

  function cellFor(k: string, l: Row, band: ReturnType<typeof leadScoreBand>): ReactNode {
    switch (k) {
      case "score":
        return (
          <td data-col="score" className={py}>
            <span className={`inline-flex items-center gap-1 chip text-xs border font-bold tabular-nums ${band.chip}`}>
              <span className={`size-1.5 rounded-full ${band.dot}`} />
              {l.score}
            </span>
          </td>
        );
      case "name":
        return (
          <td data-col="name" className={`px-1 ${py} font-medium`}>
            <div className="flex items-center gap-2">
              <Avatar src={l.avatarUrl ? `/api/leads/${l.id}/avatar` : null} name={l.name} size={isCompact ? 22 : 28} />
              <div>
                <Link href={`/dashboard/leads/${l.id}`} className="hover:text-brand-navy hover:underline">{l.name}</Link>
                {(l.phone || l.email) && (
                  <div className="text-2xs text-muted-foreground mt-0.5 space-x-2 font-mono">
                    {l.phone && <span>{l.phone}</span>}
                    {l.phone && l.email && <span>·</span>}
                    {l.email && <span>{l.email}</span>}
                  </div>
                )}
              </div>
            </div>
          </td>
        );
      case "stage":
        return (
          <td data-col="stage" className={py}>
            <span className={`chip text-xs border font-medium ${toneStyles[l.stageTone] ?? "bg-muted"}`}>{l.stageLabel}</span>
          </td>
        );
      case "intendedAmount":
        return (
          <td data-col="intendedAmount" className={`${py} text-right pr-6 tabular-nums font-semibold`}>
            {l.intendedAmount ? formatINR(l.intendedAmount) : "—"}
          </td>
        );
      case "source":
        return (
          <td data-col="source" className={py}>
            <span className={`chip text-xs border ${sourceColors[l.source] ?? "bg-muted"}`}>{leadSourceLabel(l.source)}</span>
          </td>
        );
      case "nextFollowUpAt":
        return (
          <td data-col="nextFollowUpAt" className={`${py} text-xs text-muted-foreground tabular-nums`}>
            {l.nextFollowUpAt ? formatDate(l.nextFollowUpAt) : "—"}
          </td>
        );
      case "lastContactAt":
        return (
          <td data-col="lastContactAt" className={`${py} text-xs text-muted-foreground tabular-nums`}>
            {l.lastContactAt ? formatDate(l.lastContactAt) : "—"}
          </td>
        );
      case "owner":
        return <td data-col="owner" className={`${py} text-xs font-medium`}>{l.owner ?? "—"}</td>;
      case "createdAt":
        return (
          <td data-col="createdAt" className={`${py} text-xs text-muted-foreground tabular-nums`}>
            {l.createdAt ? formatDate(l.createdAt) : "—"}
          </td>
        );
      case "actions":
        return (
          <td data-col="actions" className={`px-4 ${py} text-right`}>
            <div className="flex items-center justify-end gap-1" data-no-row-nav>
              <button
                type="button"
                onClick={() => setSidePeekLead(l)}
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
                title="Side-Peek Snapshot"
              >
                <Eye className="size-3.5" />
              </button>
              <RowActions inline editHref={`/dashboard/leads/${l.id}`} deleteUrl={`/api/leads/${l.id}`} itemLabel="lead" itemName={l.name} verb="Delete" />
            </div>
          </td>
        );
      default: {
        if (k.startsWith("x:")) {
          const v = l.extra?.[k.slice(2)];
          return (
            <td data-col={k} className={`${py} text-xs whitespace-nowrap ${v ? "" : "text-muted-foreground"}`}>
              {v ?? "—"}
            </td>
          );
        }
        const c = extraByKey.get(k);
        if (!c) return null;
        const v = l.cells[c.key];
        return (
          <td
            data-col={c.key}
            title={c.long && v ? v : undefined}
            className={`${py} text-xs ${v ? "" : "text-muted-foreground"} ${c.long ? "max-w-xs truncate" : "whitespace-nowrap"}`}
          >
            {v ?? "—"}
          </td>
        );
      }
    }
  }

  return (
    <div className="card-surface overflow-hidden relative">
      {/* Table Sub-header with Density Switcher */}
      <div className="flex items-center justify-between px-4 py-2 bg-muted/20 border-b border-border text-xs">
        <div className="flex items-center gap-2">
          {/* Count lives in the filter bar above; repeating it here was noise. */}
        </div>
        <div className="flex items-center gap-2">
          <TableDensityToggle density={density} onToggle={toggleDensity} />
        </div>
      </div>

      <div className="table-scroll">
        <table className={`w-full ${isCompact ? "text-xs" : "text-sm"} table-modern text-left`} data-table="leads">
          <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card">
            <tr>
              <th className={`px-3 ${isCompact ? "py-1.5" : "py-2.5"} w-8`}>
                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="size-4 rounded" aria-label="Select all" />
              </th>
              {order.map((k) => (
                <Fragment key={k}>{heads[k] ?? null}</Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => {
              const band = leadScoreBand(l.score);
              const isSel = selected.has(l.id);
              return (
                <tr
                  key={l.id}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("a, button, input, select, [role='menu'], [data-no-row-nav]")) return;
                    // One click opens the lead workspace; the eye button keeps the quick preview.
                    router.push(`/dashboard/leads/${l.id}`);
                  }}
                  className={`border-b last:border-0 hover:bg-accent/40 cursor-pointer transition-colors ${
                    isSel ? "bg-brand-cyan-light/30" : ""
                  }`}
                >
                  <td className={`px-3 ${isCompact ? "py-1.5" : "py-2.5"}`}>
                    <input type="checkbox" checked={isSel} onChange={() => toggle(l.id)} className="size-3.5 rounded" aria-label={`Select ${l.name}`} />
                  </td>
                  {order.map((k) => (
                    <Fragment key={k}>{cellFor(k, l, band)}</Fragment>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Floating Bulk Action Bar */}
      <FloatingBulkBar
        selectedCount={selected.size}
        onClear={() => setSelected(new Set())}
        onApplyAction={handleBulkApply}
        busy={busy}
        error={err}
        showStage={true}
        showReview={false}
        showTier={false}
        showSegment={false}
        showCategory={false}
      />

      {/* Split-Screen Side-Peek Drawer */}
      <LeadSidePeek lead={sidePeekLead} onClose={() => setSidePeekLead(null)} />
    </div>
  );
}
