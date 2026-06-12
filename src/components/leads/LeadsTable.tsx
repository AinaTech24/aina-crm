"use client";

/**
 * Leads table view with row selection + bulk actions + a sortable priority
 * Score column. The server page computes each row's score (deterministic,
 * src/lib/leads/scoring.ts) and pre-sorts; this component owns selection
 * state and the bulk toolbar (reassign RM / set follow-up / change stage /
 * mark lost → POST /api/leads/bulk).
 *
 * Keeps the data-table / data-col attributes so the existing ColumnManager
 * continues to show/hide columns.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Loader2, X, UserCog, CalendarClock, ArrowRightLeft, Ban, ArrowUpDown } from "lucide-react";
import { RowActions } from "@/components/common/RowActions";
import { RmSelector } from "@/components/common/RmSelector";
import { formatINR, formatDate } from "@/lib/utils";
import { leadScoreBand } from "@/lib/leads/scoring";

type Row = {
  id: string;
  name: string;
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
};

const toneStyles: Record<string, string> = {
  blue: "bg-blue-50 text-blue-700 border-blue-200",
  cyan: "bg-cyan-50 text-cyan-700 border-cyan-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  violet: "bg-violet-50 text-violet-700 border-violet-200",
  indigo: "bg-indigo-50 text-indigo-700 border-indigo-200",
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rose: "bg-rose-50 text-rose-700 border-rose-200",
  slate: "bg-slate-50 text-slate-700 border-slate-200",
};
const sourceColors: Record<string, string> = {
  website: "bg-blue-50 text-blue-700 border-blue-200",
  referral: "bg-emerald-50 text-emerald-700 border-emerald-200",
  social_media: "bg-purple-50 text-purple-700 border-purple-200",
  meta_ads: "bg-purple-50 text-purple-700 border-purple-200",
  google: "bg-amber-50 text-amber-700 border-amber-200",
  cold_call: "bg-orange-50 text-orange-700 border-orange-200",
  existing_client: "bg-teal-50 text-teal-700 border-teal-200",
  manual: "bg-gray-50 text-gray-700 border-gray-200",
  walk_in: "bg-teal-50 text-teal-700 border-teal-200",
  webinar: "bg-violet-50 text-violet-700 border-violet-200",
  other: "bg-gray-50 text-gray-700 border-gray-200",
};

const STAGE_OPTIONS = [
  ["new", "New"],
  ["call_done", "Call Done"],
  ["call_back_later", "Call Back Later"],
  ["contact_in_future", "Contact in Future"],
  ["meeting_scheduled", "Meeting Scheduled"],
  ["meeting_pending", "Meeting Pending"],
  ["meeting_done", "Meeting Done"],
  ["won_lead", "Won Lead"],
] as const;

export function LeadsTable({ rows, sort, dir = "desc" }: { rows: Row[]; sort: string; dir?: "asc" | "desc" }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<null | "assign" | "follow_up" | "stage" | "lost">(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // bulk value inputs
  const [assignRm, setAssignRm] = useState<string | null>(null);
  const [followDate, setFollowDate] = useState("");
  const [stageVal, setStageVal] = useState<string>("call_done");
  const [lostReason, setLostReason] = useState("");

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
    // Re-clicking the active column flips ascending ↔ descending; switching to
    // a different column resets to that column's default (descending).
    if (sort === next) {
      params.set("dir", dir === "asc" ? "desc" : "asc");
    } else {
      params.delete("dir");
    }
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  async function runBulk() {
    if (!bulk) return;
    const ids = [...selected];
    let value: string | null = null;
    if (bulk === "assign") value = assignRm;
    if (bulk === "follow_up") {
      if (!followDate) { setErr("Pick a follow-up date."); return; }
      value = new Date(followDate).toISOString();
    }
    if (bulk === "stage") value = stageVal;
    if (bulk === "lost") value = lostReason || null;

    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/leads/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids, action: bulk, value }),
      });
      const j = await res.json();
      if (!res.ok) { setErr(j.error ?? `Failed (${res.status})`); return; }
      setBulk(null);
      setSelected(new Set());
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const sortArrow = (key: string) => (sort === key ? (dir === "asc" ? "↑" : "↓") : "");

  return (
    <div className="card-surface overflow-hidden">
      {/* Bulk toolbar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 flex-wrap border-b bg-brand-cyan-light/40 px-4 py-2 text-sm">
          <span className="font-semibold">{selected.size} selected</span>
          <button onClick={() => setBulk("assign")} className="btn-ghost text-xs inline-flex items-center gap-1"><UserCog className="size-3.5" /> Reassign RM</button>
          <button onClick={() => setBulk("follow_up")} className="btn-ghost text-xs inline-flex items-center gap-1"><CalendarClock className="size-3.5" /> Set follow-up</button>
          <button onClick={() => setBulk("stage")} className="btn-ghost text-xs inline-flex items-center gap-1"><ArrowRightLeft className="size-3.5" /> Change stage</button>
          <button onClick={() => setBulk("lost")} className="btn-ghost text-xs inline-flex items-center gap-1 text-rose-700"><Ban className="size-3.5" /> Mark lost</button>
          <button onClick={() => setSelected(new Set())} className="text-xs text-muted-foreground hover:underline ml-auto">Clear</button>
        </div>
      )}

      {/* Bulk value popover */}
      {bulk && (
        <div className="border-b bg-secondary/40 px-4 py-3 flex items-center gap-3 flex-wrap text-sm">
          {bulk === "assign" && (
            <div className="min-w-[240px]">
              <RmSelector value={assignRm} onChange={setAssignRm} placeholder="— Choose RM (or unassign) —" />
            </div>
          )}
          {bulk === "follow_up" && (
            <input type="date" value={followDate} onChange={(e) => setFollowDate(e.target.value)} className="input-base text-sm" />
          )}
          {bulk === "stage" && (
            <select value={stageVal} onChange={(e) => setStageVal(e.target.value)} className="input-base text-sm">
              {STAGE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          )}
          {bulk === "lost" && (
            <input value={lostReason} onChange={(e) => setLostReason(e.target.value)} placeholder="Lost reason (optional)" className="input-base text-sm w-72" />
          )}
          <button onClick={runBulk} disabled={busy} className="btn-primary text-xs">
            {busy && <Loader2 className="size-3.5 animate-spin" />} Apply to {selected.size}
          </button>
          <button onClick={() => { setBulk(null); setErr(null); }} className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-0.5"><X className="size-3" /> Cancel</button>
          {err && <span className="text-xs text-rose-600">{err}</span>}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm table-modern text-left" data-table="leads">
          <thead className="text-xs text-muted-foreground border-b">
            <tr>
              <th className="px-3 py-2.5 w-8">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="size-3.5 rounded" aria-label="Select all" />
              </th>
              <th data-col="score" className="py-2.5 font-medium">
                <button onClick={() => setSort("score")} className="inline-flex items-center gap-1 hover:text-foreground">
                  Score <ArrowUpDown className="size-3" /> {sortArrow("score")}
                </button>
              </th>
              <th data-col="name" className="px-1 py-2.5 font-medium">Name</th>
              <th data-col="stage" className="py-2.5 font-medium">Stage</th>
              <th data-col="intendedAmount" className="py-2.5 font-medium text-right pr-6">Intended Amount</th>
              <th data-col="source" className="py-2.5 font-medium">Source</th>
              <th data-col="nextFollowUpAt" className="py-2.5 font-medium">Next Follow-Up</th>
              <th data-col="lastContactAt" className="py-2.5 font-medium">Last Contacted</th>
              <th data-col="owner" className="py-2.5 font-medium">Owner (RM)</th>
              <th data-col="createdAt" className="py-2.5 font-medium">
                <button onClick={() => setSort("recent")} className="inline-flex items-center gap-1 hover:text-foreground">
                  Created <ArrowUpDown className="size-3" /> {sortArrow("recent")}
                </button>
              </th>
              <th data-col="actions" className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => {
              const band = leadScoreBand(l.score);
              const isSel = selected.has(l.id);
              return (
                <tr key={l.id} className={`border-b last:border-0 hover:bg-accent/40 ${isSel ? "bg-brand-cyan-light/30" : ""}`}>
                  <td className="px-3 py-3">
                    <input type="checkbox" checked={isSel} onChange={() => toggle(l.id)} className="size-3.5 rounded" aria-label={`Select ${l.name}`} />
                  </td>
                  <td data-col="score" className="py-3">
                    <span className={`inline-flex items-center gap-1 chip text-xs border font-bold tabular-nums ${band.chip}`}>
                      <span className={`size-1.5 rounded-full ${band.dot}`} />
                      {l.score}
                    </span>
                  </td>
                  <td data-col="name" className="px-1 py-3 font-medium">
                    <Link href={`/dashboard/leads/${l.id}`} className="hover:underline text-[14px]">{l.name}</Link>
                    {(l.phone || l.email) && (
                      <div className="text-[11px] text-muted-foreground mt-0.5 space-x-2 font-mono">
                        {l.phone && <span>{l.phone}</span>}
                        {l.phone && l.email && <span>·</span>}
                        {l.email && <span>{l.email}</span>}
                      </div>
                    )}
                  </td>
                  <td data-col="stage" className="py-3">
                    <span className={`chip text-xs border font-medium ${toneStyles[l.stageTone] ?? "bg-muted"}`}>{l.stageLabel}</span>
                  </td>
                  <td data-col="intendedAmount" className="py-3 text-right pr-6 tabular-nums font-semibold">
                    {l.intendedAmount ? formatINR(l.intendedAmount) : "—"}
                  </td>
                  <td data-col="source" className="py-3">
                    <span className={`chip text-xs border ${sourceColors[l.source] ?? "bg-muted"}`}>{l.source.replace(/_/g, " ")}</span>
                  </td>
                  <td data-col="nextFollowUpAt" className="py-3 text-xs text-muted-foreground tabular-nums">
                    {l.nextFollowUpAt ? formatDate(l.nextFollowUpAt) : "—"}
                  </td>
                  <td data-col="lastContactAt" className="py-3 text-xs text-muted-foreground tabular-nums">
                    {l.lastContactAt ? formatDate(l.lastContactAt) : "—"}
                  </td>
                  <td data-col="owner" className="py-3 text-xs font-medium">{l.owner ?? "—"}</td>
                  <td data-col="createdAt" className="py-3 text-xs text-muted-foreground tabular-nums">
                    {l.createdAt ? formatDate(l.createdAt) : "—"}
                  </td>
                  <td data-col="actions" className="px-4 py-3 text-right">
                    <RowActions editHref={`/dashboard/leads/${l.id}`} deleteUrl={`/api/leads/${l.id}`} itemLabel="lead" itemName={l.name} verb="Delete" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
