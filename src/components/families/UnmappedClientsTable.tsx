"use client";

/**
 * The unmapped-clients queue as a selectable table: tick clients (or the whole
 * page) and Delete them in one go. Delete goes through the same bulk route as
 * the Clients list (/api/investors/bulk, action "delete"): clients move to the
 * Trash, restorable for 30 days, and anyone who still holds money with the
 * registrar is kept and named.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, X } from "lucide-react";
import { formatINR } from "@/lib/utils";
import { buttonClass } from "@/components/ui/button-class";
import { confirmDialog } from "@/components/ui/ConfirmProvider";
import { notify } from "@/components/ui/Toast";
import { MapClientActions } from "@/components/families/MapClientActions";

export type UnmappedRow = {
  id: string;
  name: string;
  pan: string | null;
  phone: string | null;
  aum: string | number | null;
  segmentTag: string | null;
  rmName: string | null;
};

export function UnmappedClientsTable({ rows, canMap, canDelete }: { rows: UnmappedRow[]; canMap: boolean; canDelete: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const allOn = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someOn = selected.size > 0 && !allOn;

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function toggleAll() {
    setSelected(allOn ? new Set() : new Set(rows.map((r) => r.id)));
  }

  async function deleteSelected() {
    const ids = [...selected];
    if (!ids.length) return;
    const ok = await confirmDialog({
      title: `Delete ${ids.length} client${ids.length === 1 ? "" : "s"}?`,
      message:
        "They move to the Trash and can be restored for 30 days. A client who still holds money with the registrar is kept — mark them Exited instead.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch("/api/investors/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids, action: "delete" }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify.error(j.error ?? `Could not delete (${res.status})`);
        return;
      }
      if (j.keptMessage) notify.warning(j.keptMessage, "Some clients were kept");
      if (j.updated) notify.success(`${j.updated} client${j.updated === 1 ? "" : "s"} moved to the Trash.`);
      setSelected(new Set());
      router.refresh();
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Could not delete");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {canDelete && selected.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-secondary/50 px-4 py-2.5">
          <span className="text-sm font-medium">
            {selected.size} selected
          </span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setSelected(new Set())} className={buttonClass("ghost", "sm")}>
              <X className="size-4" /> Clear
            </button>
            <button type="button" onClick={deleteSelected} disabled={busy} className={buttonClass("danger", "sm")}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} Delete
            </button>
          </div>
        </div>
      )}
      <div className="table-scroll">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground border-b bg-card">
            <tr>
              {canDelete && (
                <th className="relative w-10 pl-4 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select all clients on this page"
                    checked={allOn}
                    ref={(el) => {
                      if (el) el.indeterminate = someOn;
                    }}
                    onChange={toggleAll}
                  />
                </th>
              )}
              <th className="text-left font-medium px-4 py-2">Client</th>
              <th className="text-left font-medium py-2">PAN</th>
              <th className="text-right font-medium py-2">AUM</th>
              <th className="text-left font-medium pl-4 py-2">RM</th>
              <th className="text-right font-medium px-4 py-2">Map into a household</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((i) => (
              <tr key={i.id} className={selected.has(i.id) ? "bg-secondary/40" : "hover:bg-secondary/30"}>
                {canDelete && (
                  <td className="w-10 pl-4 py-3">
                    <input type="checkbox" aria-label={`Select ${i.name}`} checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
                  </td>
                )}
                <td className="px-4 py-3">
                  <Link href={`/dashboard/investors/${i.id}`} className="font-medium hover:underline">
                    {i.name}
                  </Link>
                  <div className="text-2xs text-muted-foreground">
                    {[i.phone, i.segmentTag].filter(Boolean).join(" · ") || "—"}
                  </div>
                </td>
                <td className="py-3 font-mono text-xs text-muted-foreground">{i.pan ?? "—"}</td>
                <td className="py-3 text-right tabular-nums">{formatINR(Number(i.aum ?? 0))}</td>
                <td className="pl-4 py-3 text-xs text-muted-foreground">{i.rmName ?? "—"}</td>
                <td className="px-4 py-3">
                  {canMap ? <MapClientActions investorId={i.id} investorName={i.name} /> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
