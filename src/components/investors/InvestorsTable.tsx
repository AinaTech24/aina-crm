"use client";

/**
 * Investor (client) book table — row selection + bulk actions + sortable
 * columns. Supports high-density (compact) vs cozy view modes (the switch sits
 * in the filter bar) and a side-peek drawer: clicking a row opens the quick
 * view, clicking the name opens the full client page.
 *
 * Colour is a signal (CLAUDE.md, "The UI system"): segment, tier and category
 * are taxonomy and render neutral; KYC, health and status are tinted only
 * when they ask for attention, so a row of "verified · active" reads quiet and
 * the one "expired · dormant" row stands out.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, GitMerge, Loader2, PencilLine } from "lucide-react";
import { RowActions } from "@/components/common/RowActions";
import { RmSelector } from "@/components/common/RmSelector";
import { formatINR } from "@/lib/utils";
import { healthBandClasses, type HealthBand } from "@/lib/investors/health";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Avatar } from "@/components/ui/Avatar";
import { useTableDensity } from "@/components/common/TableDensityToggle";
import { Badge } from "@/components/ui/Badge";
import { FloatingBulkBar } from "@/components/common/FloatingBulkBar";
import { InvestorSidePeek, type SidePeekInvestor } from "@/components/investors/InvestorSidePeek";
import { MassUpdateDialog, type MassUpdateOptions } from "@/components/investors/MassUpdateDialog";
import { notify } from "@/components/ui/Toast";
import { MergeCompareDialog, type Member } from "@/components/investors/DuplicateMerge";

export type InvestorTableRow = {
  id: string;
  name: string;
  avatarUrl: string | null;
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
  completeness: number;
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

/** A status that is fine reads as plain text; only a problem gets a tint. */
function kycTone(k: string | null): "neutral" | "warning" | "danger" {
  if (k === "verified" || k === "registered") return "neutral";
  if (k === "expired" || k === "rejected" || k === "hold") return "danger";
  return "warning";
}
function statusTone(st: string | null): "neutral" | "warning" | "danger" {
  if (st === "dormant" || st === "inactive") return "warning";
  if (st === "redemption_risk") return "danger";
  return "neutral";
}

/** The merge dialog compares records side by side; the API takes up to ten. */
const MAX_MERGE = 10;

export function InvestorsTable({
  rows,
  sort,
  dir = "desc",
  flags,
  allIds = [],
  total = 0,
  massUpdate,
  canMerge = false,
}: {
  rows: InvestorTableRow[];
  sort: string;
  dir?: "asc" | "desc";
  flags: InvestorTableFlags;
  allIds?: string[];
  total?: number;
  /** Choices for "Update a field"; omitted for people who can't bulk-edit. */
  massUpdate?: MassUpdateOptions;
  /** Owners / branch heads — the people POST /api/investors/merge accepts. */
  canMerge?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { isCompact } = useTableDensity("cozy");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sidePeekInvestor, setSidePeekInvestor] = useState<SidePeekInvestor | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [massOpen, setMassOpen] = useState(false);
  // "Merge" in the bulk bar: the same compare-and-merge dialog as Merge
  // Clients (pick the record to keep, field by field, type MERGE; undoable).
  const [mergeMembers, setMergeMembers] = useState<Member[] | null>(null);
  const [mergeLoading, setMergeLoading] = useState(false);
  const canOfferMerge = canMerge && selected.size >= 2 && selected.size <= MAX_MERGE;

  async function openMerge() {
    setMergeLoading(true);
    try {
      const ids = [...selected].join(",");
      const res = await fetch(`/api/investors/merge-search?ids=${encodeURIComponent(ids)}`, { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      const results = (j.results ?? []) as Array<{ id: string; name: string; pan: string | null; phone: string | null; email: string | null; aum: number; folios: number }>;
      if (!res.ok) {
        notify.error(j.error ?? "Couldn't load those clients.");
        return;
      }
      if (results.length < 2) {
        notify.error("At least two of the selected clients must still be live to merge them.");
        return;
      }
      setMergeMembers(results.map((r) => ({
        id: r.id, name: r.name, pan: r.pan, phone: r.phone, email: r.email, aum: r.aum, folios: r.folios, rm_name: null,
      })));
    } finally {
      setMergeLoading(false);
    }
  }

  /** "Update a field" — returns an error message for the dialog, or null. */
  async function applyMassUpdate(field: string, value: string | null): Promise<string | null> {
    const ids = [...selected];
    try {
      const res = await fetch("/api/investors/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids, action: "field", field, value }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return j.error ?? `That didn't go through (${res.status}). Nothing was changed.`;
      const n = Number(j.updated ?? 0);
      notify.success(`Updated ${n.toLocaleString("en-IN")} ${n === 1 ? "client" : "clients"}.`);
      setSelected(new Set());
      router.refresh();
      return null;
    } catch {
      return "Network error. Nothing was changed.";
    }
  }

  // A column the licence PERMITS is not the same as a column the data USES.
  // Category and Tier were rendering an em dash on every row and still taking
  // their width. Hide a permitted column when nothing in the current result set
  // fills it; it comes back by itself as soon as one record does.
  const hasCategory = rows.some((r) => !!r.clientCategory);
  const hasTier = rows.some((r) => !!r.serviceTier);
  const hasSegment = rows.some((r) => !!r.segmentTag);

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const allMatchingSelected = allIds.length > 0 && selected.size >= allIds.length;

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
    // Always explicit: the list's default is newest-first, so dropping the
    // param for AUM (as this used to) sorted by date instead.
    params.set("sort", next);
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
      if (action === "review") value = payload.nextReviewAt ? new Date(payload.nextReviewAt).toISOString() : null;
      if (action === "tier") value = payload.serviceTier ?? null;
      if (action === "segment") value = payload.segmentTag ?? null;
      if (action === "category") value = payload.clientCategory ?? null;

      const res = await fetch("/api/investors/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids, action, value }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? `Failed (${res.status})`);
        return;
      }
      setSelected(new Set());
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Bulk action failed");
    } finally {
      setBusy(false);
    }
  }

  const py = isCompact ? "py-1.5" : "py-2.5";

  /** One sort cue per header: a faint ⇅ until sorted, then ↑ or ↓. */
  function sortHeader(k: string, label: string, align: "left" | "right" = "left") {
    const on = sort === k;
    const Icon = !on ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <button
        type="button"
        onClick={() => setSort(k)}
        className={`inline-flex items-center gap-1 hover:text-foreground ${on ? "text-foreground" : ""} ${align === "right" ? "flex-row-reverse" : ""}`}
        aria-label={`Sort by ${label}`}
      >
        {label}
        <Icon className={`size-3 ${on ? "" : "opacity-40"}`} aria-hidden />
      </button>
    );
  }

  return (
    <div className="card-surface overflow-hidden relative">
      {/* Phones get card rows — a 12-column table can't shrink to 390px. */}
      <ul className="sm:hidden divide-y divide-border">
        {rows.map((i) => (
          <li key={i.id}>
            <button
              type="button"
              onClick={() => setSidePeekInvestor(i)}
              className="w-full text-left px-4 py-3 flex items-center gap-3 active:bg-secondary/60"
            >
              <div className="size-9 shrink-0 rounded-full bg-secondary grid place-items-center text-2xs font-bold text-muted-foreground">
                {i.name.split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{i.name}</div>
                <div className="text-2xs text-muted-foreground truncate">
                  {i.sip > 0 ? `SIP ${formatINR(i.sip)}/mo` : "No active SIP"}
                  {i.status && i.status !== "active" ? ` · ${i.status}` : ""}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-semibold tabular-nums">{formatINR(i.aum)}</div>
                <div className="text-2xs text-muted-foreground">AUM</div>
              </div>
            </button>
          </li>
        ))}
      </ul>

      <div className="table-scroll hidden sm:block">
        <table className={`w-full ${isCompact ? "text-xs" : "text-sm"}`} data-table="investors">
          <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card">
            <tr>
              <th className={`px-3 ${py} w-8`}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="size-4 rounded"
                  aria-label="Select all"
                />
              </th>
              <th data-col="name" className={`text-left ${py} font-medium`}>
                {sortHeader("name", "Name")}
              </th>
              {flags.showPan && <th data-col="pan" className={`text-left ${py} font-medium`}>PAN</th>}
              {flags.showCategory && hasCategory && <th data-col="category" className={`text-left ${py} font-medium`}>Category</th>}
              {flags.showTier && hasTier && <th data-col="tier" className={`text-left ${py} font-medium`}>Tier</th>}
              {flags.showSegment && hasSegment && <th data-col="segment" className={`text-left ${py} font-medium`}>Segment</th>}
              {flags.showAum && (
                <th data-col="aum" className={`text-right ${py} font-medium`}>
                  {sortHeader("aum", "AUM", "right")}
                </th>
              )}
              {flags.showSip && (
                <th data-col="sip" className={`text-right ${py} font-medium`}>
                  {sortHeader("sip", "SIP / month", "right")}
                </th>
              )}
              {flags.showKyc && <th data-col="kyc" className={`text-left ${py} font-medium pl-4`}>KYC</th>}
              {/* Both of these columns are bare numbers with no unit, so say
                  what they measure on hover — otherwise "100/100" and "13%"
                  mean nothing to someone opening this list for the first time. */}
              <th
                data-col="health"
                className={`text-left ${py} font-medium`}
                title="Relationship health, 0–100. Drops when you haven't been in touch, a review is overdue, KYC/FATCA is expiring, or a nominee, bank or risk profile is missing."
              >
                {sortHeader("health", "Health")}
              </th>
              <th
                data-col="complete"
                className={`text-left ${py} font-medium`}
                title="How much of the client record is filled in — PAN, date of birth, email, mobile, address, KYC, nominee, bank and risk profile."
              >
                Profile
              </th>
              {flags.showStatus && <th data-col="status" className={`text-left ${py} font-medium`}>Status</th>}
              <th data-col="actions" className={`px-4 ${py} text-right font-medium`}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => {
              const cls = healthBandClasses(i.healthBand);
              const dorm = i.dormDays != null && i.dormDays > 180;
              const isSel = selected.has(i.id);
              return (
                <tr
                  key={i.id}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("a, button, input, select, [role='menu'], [data-no-row-nav]")) return;
                    setSidePeekInvestor(i);
                  }}
                  className={`border-b last:border-0 hover:bg-accent/40 cursor-pointer transition-colors ${
                    isSel ? "bg-accent" : ""
                  }`}
                >
                  <td className={`px-3 ${py}`}>
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => toggle(i.id)}
                      className="size-3.5 rounded"
                      aria-label={`Select ${i.name}`}
                    />
                  </td>
                  <td data-col="name" className={`${py} font-medium`}>
                    <div className="flex items-center gap-2">
                      <Avatar
                        src={i.avatarUrl ? `/api/investors/${i.id}/avatar` : null}
                        name={i.name}
                        size={isCompact ? 22 : 28}
                      />
                      <Link href={`/dashboard/investors/${i.id}`} className="hover:text-primary hover:underline">{i.name}</Link>
                    </div>
                  </td>
                  {flags.showPan && (
                    <td data-col="pan" className={`${py} font-mono text-muted-foreground ${isCompact ? "text-2xs" : "text-xs"}`}>
                      {i.pan}
                    </td>
                  )}
                  {flags.showCategory && hasCategory && (
                    <td data-col="category" className={`${py}`}>
                      {i.clientCategory ? (
                        <span title={`Client category ${i.clientCategory}`}><Badge raw>{i.clientCategory}</Badge></span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  )}
                  {flags.showTier && hasTier && (
                    <td data-col="tier" className={`${py}`}>
                      {i.serviceTier ? (
                        <span title={i.serviceTier === "A" ? "Quarterly review" : i.serviceTier === "B" ? "Half-yearly review" : "Annual review"}>
                          <Badge raw>{i.serviceTier}</Badge>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  )}
                  {flags.showSegment && hasSegment && (
                    <td data-col="segment" className={`${py}`}>
                      {i.segmentTag && <Badge raw>{i.segmentTag}</Badge>}
                    </td>
                  )}
                  {flags.showAum && (
                    <td data-col="aum" className={`${py} text-right tabular-nums font-semibold`}>
                      {formatINR(i.aum)}
                    </td>
                  )}
                  {flags.showSip && (
                    <td data-col="sip" className={`${py} text-right tabular-nums text-muted-foreground`}>
                      {i.sip > 0 ? formatINR(i.sip) : "—"}
                    </td>
                  )}
                  {flags.showKyc && (
                    <td data-col="kyc" className={`${py} pl-4`}>
                      {kycTone(i.kycStatus) === "neutral" ? (
                        <span className="text-xs capitalize text-muted-foreground">{i.kycStatus}</span>
                      ) : (
                        <Badge tone={kycTone(i.kycStatus)}>{i.kycStatus ?? "pending"}</Badge>
                      )}
                    </td>
                  )}
                  <td data-col="health" className={`${py}`}>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${cls.chip}`}>
                      {i.healthScore}/100
                    </span>
                  </td>
                  <td data-col="complete" className={`${py}`}>
                    <div className="flex items-center gap-1.5">
                      <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-foreground/40 rounded-full"
                          style={{ width: `${i.completeness}%` }}
                        />
                      </div>
                      <span className="text-2xs text-muted-foreground tabular-nums">{i.completeness}%</span>
                    </div>
                  </td>
                  {flags.showStatus && (
                    <td data-col="status" className={`${py}`}>
                      {statusTone(i.status) === "neutral" ? (
                        <span className="text-xs capitalize text-muted-foreground">{(i.status ?? "active").replace(/_/g, " ")}</span>
                      ) : (
                        <Badge tone={statusTone(i.status)}>{i.status ?? "active"}</Badge>
                      )}
                    </td>
                  )}
                  <td data-col="actions" className={`px-4 ${py} text-right`}>
                    <div className="flex items-center justify-end gap-1" data-no-row-nav>
                      <RowActions
                        itemLabel="client"
                        items={[
                          { label: "Open client page", href: `/dashboard/investors/${i.id}` },
                          { label: "Create proposal", href: `/dashboard/proposals/new?investorId=${i.id}` },
                          { label: "Schedule review", href: `/dashboard/review-meetings/new?investorId=${i.id}` },
                          { label: "Log service request", href: `/dashboard/service-requests/new?investorId=${i.id}` },
                        ]}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Floating Bulk Action Bar */}
      <FloatingBulkBar
        selectedCount={selected.size}
        totalMatching={total}
        allSelected={allSelected}
        allMatchingSelected={allMatchingSelected}
        onSelectAllMatching={() => setSelected(new Set(allIds))}
        onClear={() => setSelected(new Set())}
        onApplyAction={handleBulkApply}
        busy={busy}
        error={err}
        customActions={
          massUpdate || canOfferMerge ? (
            <>
              {canOfferMerge && (
                <button
                  type="button"
                  onClick={() => void openMerge()}
                  disabled={mergeLoading}
                  title="These records are one person — compare them and merge into one"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-secondary/80 hover:bg-secondary text-foreground transition-colors disabled:opacity-60"
                >
                  {mergeLoading ? <Loader2 className="size-3.5 animate-spin" /> : <GitMerge className="size-3.5" />} Merge
                </button>
              )}
              {massUpdate && (
                <button
                  type="button"
                  onClick={() => setMassOpen(true)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-secondary/80 hover:bg-secondary text-foreground transition-colors"
                >
                  <PencilLine className="size-3.5" /> Update a field
                </button>
              )}
            </>
          ) : undefined
        }
      />
      {massUpdate && (
        <MassUpdateDialog
          open={massOpen}
          onOpenChange={setMassOpen}
          count={selected.size}
          options={massUpdate}
          onApply={applyMassUpdate}
        />
      )}

      {mergeMembers && (
        <MergeCompareDialog
          members={mergeMembers}
          onClose={() => setMergeMembers(null)}
          onMerged={() => {
            setMergeMembers(null);
            setSelected(new Set());
            router.refresh();
          }}
        />
      )}

      {/* Split-Screen Side-Peek Drawer */}
      <InvestorSidePeek investor={sidePeekInvestor} onClose={() => setSidePeekInvestor(null)} />
    </div>
  );
}
