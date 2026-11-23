"use client";

/**
 * The Families list: the table, and — for people who may edit families — row
 * selection with the same floating action bar as Clients: Reassign RM, Next
 * Review and "Update a field", on the rows ticked, on the whole page, or on
 * every family the current search and filters match ("Select all N matching
 * records" — the ids come from GET /api/families/ids, which uses the page's own
 * filter, so they are exactly the N the page counts).
 *
 * Changes go to POST /api/families/bulk (lib/families/bulk-update): the same
 * rules as editing one family.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PencilLine } from "lucide-react";
import { RowActions } from "@/components/common/RowActions";
import { FloatingBulkBar } from "@/components/common/FloatingBulkBar";
import { MassUpdateDialog, type MassUpdateOptions } from "@/components/investors/MassUpdateDialog";
import { Badge } from "@/components/ui/Badge";
import { notify } from "@/components/ui/Toast";
import { formatDate } from "@/lib/format";
import { formatINR } from "@/lib/utils";
import { FAMILY_BULK_FIELDS, FAMILY_BULK_GROUPS } from "@/lib/families/bulk-fields";

export type FamilyTableRow = {
  id: string;
  name: string;
  /** "FAM-0012 · HNI", already joined. */
  sub: string | null;
  /** The wealth band's label, or null for a family with no AUM. */
  bandLabel: string | null;
  head: string | null;
  rm: string | null;
  members: number;
  aum: number;
  sip: number;
  nextReviewAt: string | null;
  overdue: boolean;
  healthOk: boolean;
  /** The class string for the "At risk" chip. */
  healthChip: string;
  healthTip: string;
};

export type FamiliesBulk = {
  options: MassUpdateOptions;
  /** The list's own filters as a query string (no page) — for "Select all N matching". */
  query: string;
  /** How many families the filters match. */
  total: number;
};

const count = (n: number) => `${n.toLocaleString("en-IN")} ${n === 1 ? "family" : "families"}`;

export function FamiliesTable({
  rows,
  sortKey,
  aumHref,
  healthHref,
  canDelete,
  bulk,
}: {
  rows: FamilyTableRow[];
  sortKey: "aum" | "health";
  aumHref: string;
  healthHref: string;
  canDelete: boolean;
  /** Present only for people who may edit families. */
  bulk?: FamiliesBulk;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [massOpen, setMassOpen] = useState(false);

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));

  /** POST the change; an error message for the pop-up, or null on success. */
  async function send(body: Record<string, unknown>): Promise<string | null> {
    try {
      const res = await fetch("/api/families/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [...selected], ...body }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return j.error ?? `That didn't go through (${res.status}). Nothing was changed.`;
      const updated = Number(j.updated ?? 0);
      const unchanged = Number(j.unchanged ?? 0);
      const notVisible = Number(j.notVisible ?? 0);
      const notes = [
        unchanged ? `${count(unchanged)} already had it` : "",
        notVisible ? `${count(notVisible)} not in your book` : "",
      ].filter(Boolean);
      notify.success(`Updated ${count(updated)}.${notes.length ? ` ${notes.join(" · ")}.` : ""}`);
      setSelected(new Set());
      router.refresh();
      return null;
    } catch {
      return "Network error. Nothing was changed.";
    }
  }

  async function handleBulkApply(action: string, payload: Record<string, unknown>): Promise<boolean> {
    if (selected.size === 0) return true;
    setBusy(true);
    setErr(null);
    const value = action === "assign" ? ((payload.rmId as string | null) ?? null) : ((payload.nextReviewAt as string | null) ?? null);
    const e = await send({ action, value });
    setBusy(false);
    if (e) {
      setErr(e);
      return false; // keep the pop-up open so the message is seen
    }
    return true;
  }

  async function selectAllMatching() {
    if (!bulk) return;
    try {
      const res = await fetch(`/api/families/ids${bulk.query ? `?${bulk.query}` : ""}`, { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify.error(j.error ?? "Couldn't load the matching families.");
        return;
      }
      const ids = (j.ids ?? []) as string[];
      setSelected(new Set(ids));
      if (Number(j.total) > ids.length) {
        notify.warning(
          `Selected the first ${ids.length.toLocaleString("en-IN")} of ${Number(j.total).toLocaleString("en-IN")} matching families — the most one update can change. Apply it, then repeat for the rest.`,
          "Part of the list is selected"
        );
      }
    } catch {
      notify.error("Network error. Nothing was selected.");
    }
  }

  return (
    <>
      <div className="table-scroll">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 border-b bg-card text-xs text-muted-foreground">
            <tr>
              {bulk && (
                <th className="w-8 px-4 py-2">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} className="size-4 rounded" aria-label="Select all families on this page" />
                </th>
              )}
              <th className={`${bulk ? "pl-0 pr-4" : "px-4"} py-2 text-left font-medium`}>Family</th>
              <th className="py-2 text-left font-medium">Head</th>
              <th className="py-2 text-left font-medium">RM</th>
              <th className="py-2 text-right font-medium">Members</th>
              <th className="py-2 text-right font-medium">
                <Link href={aumHref} className={`hover:underline ${sortKey === "aum" ? "text-foreground" : ""}`}>
                  Combined AUM {sortKey === "aum" ? "↓" : ""}
                </Link>
              </th>
              <th className="py-2 text-right font-medium">SIP / month</th>
              <th className="py-2 pl-4 text-left font-medium">Next review</th>
              <th className="py-2 pl-4 text-left font-medium">
                <Link href={healthHref} className={`hover:underline ${sortKey === "health" ? "text-foreground" : ""}`}>
                  Health {sortKey === "health" ? "↑" : ""}
                </Link>
              </th>
              {canDelete && <th className="px-4 py-2"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.id} className={`border-b last:border-0 hover:bg-accent/40 ${selected.has(f.id) ? "bg-accent/30" : ""}`}>
                {bulk && (
                  <td className="w-8 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(f.id)}
                      onChange={() => toggle(f.id)}
                      className="size-4 rounded"
                      aria-label={`Select ${f.name}`}
                    />
                  </td>
                )}
                <td className={`${bulk ? "pl-0 pr-4" : "px-4"} py-3`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/dashboard/families/${f.id}`} className="font-medium hover:underline">
                      {f.name}
                    </Link>
                    {f.bandLabel && <Badge raw>{f.bandLabel}</Badge>}
                  </div>
                  {f.sub && <div className="mt-0.5 text-xs text-muted-foreground">{f.sub}</div>}
                </td>
                <td className="py-3 text-sm">{f.head ?? <span className="text-xs text-muted-foreground">Not set</span>}</td>
                <td className="py-3 text-sm">{f.rm ?? <span className="text-xs text-muted-foreground">Not assigned</span>}</td>
                <td className="py-3 text-right tabular-nums">{f.members}</td>
                <td className="py-3 text-right tabular-nums">{formatINR(f.aum)}</td>
                <td className="py-3 text-right tabular-nums text-muted-foreground">{f.sip > 0 ? formatINR(f.sip) : "—"}</td>
                <td className={`py-3 pl-4 text-sm ${f.overdue ? "text-destructive" : ""}`}>
                  {f.nextReviewAt ? <>{formatDate(f.nextReviewAt)}{f.overdue ? " · overdue" : ""}</> : <span className="text-xs text-muted-foreground">Not scheduled</span>}
                </td>
                <td className="py-3 pl-4">
                  {/* ONE badge: OK or At risk; the score and reasons on hover. */}
                  <span
                    className={`w-fit rounded-full border px-1.5 py-0.5 text-2xs font-medium ${
                      f.healthOk ? "border-border bg-secondary text-muted-foreground" : f.healthChip
                    }`}
                    title={f.healthTip}
                  >
                    {f.healthOk ? "OK" : "At risk"}
                  </span>
                </td>
                {canDelete && (
                  <td className="px-4 py-3 text-right">
                    {/* Only an empty family can be deleted (the API refuses one with members). */}
                    {f.members === 0 && (
                      <RowActions deleteUrl={`/api/families/${f.id}`} itemLabel="family" itemName={f.name} verb="Delete" permanent inline />
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {bulk && (
        <>
          <FloatingBulkBar
            selectedCount={selected.size}
            totalMatching={bulk.total}
            allSelected={allSelected}
            onSelectAllMatching={selectAllMatching}
            onClear={() => setSelected(new Set())}
            onApplyAction={handleBulkApply}
            busy={busy}
            error={err}
            noun="families"
            showTier={false}
            showSegment={false}
            showCategory={false}
            showDelete={false}
            customActions={
              <button
                type="button"
                onClick={() => setMassOpen(true)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-secondary/80 hover:bg-secondary text-foreground transition-colors"
              >
                <PencilLine className="size-3.5" /> Update a field
              </button>
            }
          />
          <MassUpdateDialog
            open={massOpen}
            onOpenChange={setMassOpen}
            count={selected.size}
            options={bulk.options}
            fields={FAMILY_BULK_FIELDS}
            groups={FAMILY_BULK_GROUPS}
            noun={{ one: "family", many: "families" }}
            onApply={(field, value) => send({ action: "field", field, value })}
          />
        </>
      )}
    </>
  );
}
