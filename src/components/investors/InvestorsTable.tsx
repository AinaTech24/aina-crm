"use client";

/**
 * Investor (client) book table — row selection + bulk actions + sortable
 * columns. Mirrors the leads table pattern. The server page pre-computes each
 * row's health score and pre-sorts; this component owns selection state and
 * the bulk toolbar:
 *   · Reassign RM        → POST /api/investors/bulk {action:"assign"}
 *   · Set next review    → {action:"review"}   (feeds the review-cadence engine)
 *   · Set service tier   → {action:"tier"}
 *   · Set segment        → {action:"segment"}
 *
 * Preserves data-table / data-col attributes so the existing ColumnManager
 * keeps working, and honours the same field-gating (show*) flags the page
 * already computes from the tenant licence.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  Loader2, X, UserCog, CalendarClock, Layers, Tag, ArrowUpDown, Trash2,
} from "lucide-react";
import { RowActions } from "@/components/common/RowActions";
import { RmSelector } from "@/components/common/RmSelector";
import { formatINR } from "@/lib/utils";
import { healthBandClasses, type HealthBand } from "@/lib/investors/health";

export type InvestorTableRow = {
  id: string;
  name: string;
  pan: string | null;
  clientCategory: string | null;
  serviceTier: string | null;
  segmentTag: string | null;
  aum: number;
  sip: number;
  kycStatus: string | null;
  status: string | null;
  healthScore: number;
  healthBand: HealthBand;
  dormDays: number | null;
};

export type InvestorTableFlags = {
  showPan: boolean;
  showCategory: boolean;
  showTier: boolean;
  showSegment: boolean;
  showAum: boolean;
  showSip: boolean;
  showKyc: boolean;
  showStatus: boolean;
};

const segmentColors: Record<string, string> = {
  HNI: "bg-violet-50 text-violet-700",
  Affluent: "bg-emerald-50 text-emerald-700",
  Retail: "bg-blue-50 text-blue-700",
  NRI: "bg-pink-50 text-pink-700",
  Corporate: "bg-amber-50 text-amber-700",
};
const tierColors: Record<string, string> = {
  A: "bg-violet-100 text-violet-700",
  B: "bg-emerald-100 text-emerald-700",
  C: "bg-blue-100 text-blue-700",
};
const categoryColors: Record<string, string> = {
  A: "bg-amber-100 text-amber-800 border border-amber-300",
  B: "bg-sky-100 text-sky-800 border border-sky-300",
  C: "bg-slate-100 text-slate-700 border border-slate-300",
  D: "bg-rose-50 text-rose-700 border border-rose-200",
};

export function InvestorsTable({
  rows,
  sort,
  dir = "desc",
  flags,
}: {
  rows: InvestorTableRow[];
  sort: string;
  dir?: "asc" | "desc";
  flags: InvestorTableFlags;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<null | "assign" | "review" | "tier" | "segment" | "category">(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [assignRm, setAssignRm] = useState<string | null>(null);
  const [reviewDate, setReviewDate] = useState("");
  const [tierVal, setTierVal] = useState("A");
  const [segmentVal, setSegmentVal] = useState("HNI");
  const [categoryVal, setCategoryVal] = useState("A");

  const allSelected = rows.length > 0 && selected.size === rows.length;

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }

  function setSort(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "table");
    if (next === "aum") params.delete("sort");
    else params.set("sort", next);
    // Clicking the already-active column flips direction; switching to a new
    // column starts from that column's natural default.
    if (sort === next) {
      params.set("dir", dir === "asc" ? "desc" : "asc");
    } else {
      params.delete("dir");
    }
    // Re-sorting starts from the top of the new ordering.
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  async function runBulk() {
    if (!bulk) return;
    const ids = [...selected];
    let value: string | null = null;
    if (bulk === "assign") value = assignRm;
    if (bulk === "review") {
      if (!reviewDate) { setErr("Pick a review date."); return; }
      value = new Date(reviewDate).toISOString();
    }
    if (bulk === "tier") value = tierVal;
    if (bulk === "segment") value = segmentVal;
    if (bulk === "category") value = categoryVal;

    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/investors/bulk", {
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

  async function deleteSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (
      !window.confirm(
        `Archive ${ids.length} client${ids.length > 1 ? "s" : ""}? They'll be set to "closed" and removed from the active book — financial history is kept and they can be reactivated later.`
      )
    )
      return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/investors/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids, action: "delete" }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? `Failed (${res.status})`);
        return;
      }
      setSelected(new Set());
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const arrow = (key: string) => (sort === key ? (dir === "asc" ? "↑" : "↓") : "");

  return (
    <div className="card-surface overflow-hidden">
      {/* Bulk toolbar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 flex-wrap border-b bg-brand-cyan-light/40 px-4 py-2 text-sm">
          <span className="font-semibold">{selected.size} selected</span>
          <button onClick={() => setBulk("assign")} className="btn-ghost text-xs inline-flex items-center gap-1"><UserCog className="size-3.5" /> Reassign RM</button>
          <button onClick={() => setBulk("review")} className="btn-ghost text-xs inline-flex items-center gap-1"><CalendarClock className="size-3.5" /> Set next review</button>
          <button onClick={() => setBulk("tier")} className="btn-ghost text-xs inline-flex items-center gap-1"><Layers className="size-3.5" /> Set tier</button>
          <button onClick={() => setBulk("segment")} className="btn-ghost text-xs inline-flex items-center gap-1"><Tag className="size-3.5" /> Set segment</button>
          <button onClick={() => setBulk("category")} className="btn-ghost text-xs inline-flex items-center gap-1"><Layers className="size-3.5" /> Set category</button>
          <button onClick={deleteSelected} disabled={busy} className="btn-ghost text-xs inline-flex items-center gap-1 text-rose-600 hover:bg-rose-50 disabled:opacity-50"><Trash2 className="size-3.5" /> Delete</button>
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
          {bulk === "review" && (
            <input type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} className="input-base text-sm" />
          )}
          {bulk === "tier" && (
            <select value={tierVal} onChange={(e) => setTierVal(e.target.value)} className="input-base text-sm">
              <option value="A">A — Quarterly review</option>
              <option value="B">B — Half-yearly review</option>
              <option value="C">C — Annual review</option>
            </select>
          )}
          {bulk === "segment" && (
            <select value={segmentVal} onChange={(e) => setSegmentVal(e.target.value)} className="input-base text-sm">
              {["HNI", "Affluent", "Retail", "NRI", "Corporate"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          {bulk === "category" && (
            <select value={categoryVal} onChange={(e) => setCategoryVal(e.target.value)} className="input-base text-sm">
              {["A", "B", "C", "D"].map((c) => <option key={c} value={c}>{`Category ${c}`}</option>)}
            </select>
          )}
          <button onClick={runBulk} disabled={busy} className="btn-primary text-xs inline-flex items-center gap-1">
            {busy && <Loader2 className="size-3.5 animate-spin" />} Apply to {selected.size}
          </button>
          <button onClick={() => { setBulk(null); setErr(null); }} className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-0.5"><X className="size-3" /> Cancel</button>
          {err && <span className="text-xs text-rose-600">{err}</span>}
        </div>
      )}

      <table className="w-full text-sm" data-table="investors">
        <thead className="text-xs text-muted-foreground border-b">
          <tr>
            <th className="px-3 py-2 w-8">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} className="size-3.5 rounded" aria-label="Select all" />
            </th>
            <th data-col="name" className="text-left py-2 font-medium">
              <button onClick={() => setSort("name")} className="inline-flex items-center gap-1 hover:text-foreground">Name <ArrowUpDown className="size-3" />{arrow("name")}</button>
            </th>
            {flags.showPan && <th data-col="pan" className="text-left py-2 font-medium">PAN</th>}
            {flags.showCategory && <th data-col="category" className="text-left py-2 font-medium">Category</th>}
            {flags.showTier && <th data-col="tier" className="text-left py-2 font-medium">Tier</th>}
            {flags.showSegment && <th data-col="segment" className="text-left py-2 font-medium">Segment</th>}
            {flags.showAum && (
              <th data-col="aum" className="text-right py-2 font-medium">
                <button onClick={() => setSort("aum")} className="inline-flex items-center gap-1 hover:text-foreground">AUM <ArrowUpDown className="size-3" />{arrow("aum")}</button>
              </th>
            )}
            {flags.showSip && (
              <th data-col="sip" className="text-right py-2 font-medium">
                <button onClick={() => setSort("sip")} className="inline-flex items-center gap-1 hover:text-foreground">SIP <ArrowUpDown className="size-3" />{arrow("sip")}</button>
              </th>
            )}
            {flags.showKyc && <th data-col="kyc" className="text-left py-2 font-medium pl-4">KYC</th>}
            <th data-col="health" className="text-left py-2 font-medium">
              <button onClick={() => setSort("health")} className="inline-flex items-center gap-1 hover:text-foreground">Health <ArrowUpDown className="size-3" />{arrow("health")}</button>
            </th>
            {flags.showStatus && <th data-col="status" className="text-left py-2 font-medium">Status</th>}
            <th data-col="actions" className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => {
            const cls = healthBandClasses(i.healthBand);
            const dorm = i.dormDays != null && i.dormDays > 180;
            const isSel = selected.has(i.id);
            return (
              <tr key={i.id} className={`border-b last:border-0 hover:bg-accent/40 ${isSel ? "bg-brand-cyan-light/30" : ""}`}>
                <td className="px-3 py-3">
                  <input type="checkbox" checked={isSel} onChange={() => toggle(i.id)} className="size-3.5 rounded" aria-label={`Select ${i.name}`} />
                </td>
                <td data-col="name" className="py-3 font-medium">
                  <Link href={`/dashboard/investors/${i.id}`} className="hover:underline">{i.name}</Link>
                </td>
                {flags.showPan && <td data-col="pan" className="py-3 text-xs font-mono text-muted-foreground">{i.pan}</td>}
                {flags.showCategory && (
                  <td data-col="category" className="py-3">
                    {i.clientCategory ? (
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${categoryColors[i.clientCategory] ?? ""}`} title={`Client Category ${i.clientCategory}`}>{i.clientCategory}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                )}
                {flags.showTier && (
                  <td data-col="tier" className="py-3">
                    {i.serviceTier ? (
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${tierColors[i.serviceTier] ?? ""}`} title={i.serviceTier === "A" ? "Quarterly review" : i.serviceTier === "B" ? "Half-yearly review" : "Annual review"}>{i.serviceTier}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                )}
                {flags.showSegment && (
                  <td data-col="segment" className="py-3">
                    {i.segmentTag && <span className={`text-xs px-2 py-0.5 rounded-full ${segmentColors[i.segmentTag] ?? ""}`}>{i.segmentTag}</span>}
                  </td>
                )}
                {flags.showAum && <td data-col="aum" className="py-3 text-right tabular-nums">{formatINR(i.aum)}</td>}
                {flags.showSip && (
                  <td data-col="sip" className="py-3 text-right tabular-nums text-muted-foreground">
                    {i.sip > 0 ? `${formatINR(i.sip)}/mo` : "—"}
                  </td>
                )}
                {flags.showKyc && (
                  <td data-col="kyc" className="py-3 pl-4">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      i.kycStatus === "verified" ? "bg-emerald-50 text-emerald-700"
                        : i.kycStatus === "expired" ? "bg-rose-50 text-rose-700"
                        : "bg-amber-50 text-amber-700"
                    }`}>{i.kycStatus}</span>
                  </td>
                )}
                <td data-col="health" className="py-3">
                  <div className="flex items-center gap-1.5">
                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${cls.chip}`} title={cls.label}>
                      <span className={`size-1.5 rounded-full ${cls.dot}`} />
                      <span className="tabular-nums font-bold">{i.healthScore}</span>
                    </span>
                    {dorm && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700" title={`No transactions in ${i.dormDays} days`}>
                        {Math.floor((i.dormDays ?? 0) / 30)}mo idle
                      </span>
                    )}
                  </div>
                </td>
                {flags.showStatus && <td data-col="status" className="py-3 text-xs">{i.status}</td>}
                <td data-col="actions" className="px-4 py-3 text-right">
                  <RowActions
                    editHref={`/dashboard/investors/${i.id}`}
                    deleteUrl={`/api/investors/${i.id}`}
                    itemLabel="investor"
                    itemName={i.name}
                    verb="Mark exited"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
