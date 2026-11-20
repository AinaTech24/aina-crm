"use client";

/** DMAT account registry — add / close / delete. Drives New-DMAT + Active-Client
 *  counts in the Equity Team MIS. */

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { useToast } from "@/components/ui/Toast";
import { TableSkeleton } from "@/components/common/Skeleton";
import { DateField } from "@/components/ui/DateField";
import Link from "next/link";
import { FamilyHeadPicker, type HeadCandidate } from "@/components/families/FamilyHeadPicker";
import { confirmDialog } from "@/components/ui/ConfirmProvider";

type Account = {
  id: string;
  clientName: string;
  dmatNumber: string | null;
  broker: string | null;
  openedDate: string;
  closedDate: string | null;
  status: string;
  investorId?: string | null;
  rmName?: string | null;
};

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * `enhanced` (the Equity desk, We Care 2026-11-20): the account is picked from
 * the client book (name + RM come from the client, and the client's Cross-sell
 * shows Demat as held with us), with broker / DP, and a confirm before delete.
 */
export function EquityDmatManager({ enhanced = false }: { enhanced?: boolean } = {}) {
  const toast = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ clientName: "", dmatNumber: "", broker: "", openedDate: todayStr() });
  const [busy, setBusy] = useState(false);
  const [client, setClient] = useState<HeadCandidate | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/equity/dmat", { cache: "no-store" });
      if (!res.ok) throw new Error();
      const d = await res.json();
      setAccounts(d.accounts ?? []);
    } catch {
      toast.error("Could not load DMAT accounts.", "Load failed");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    if ((!form.clientName.trim() && !client) || !form.openedDate) return;
    setBusy(true);
    try {
      const res = await fetch("/api/equity/dmat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientName: form.clientName.trim() || null,
          investorId: client?.id ?? null,
          dmatNumber: form.dmatNumber.trim() || null,
          broker: form.broker.trim() || null,
          openedDate: form.openedDate,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "");
      toast.success("DMAT account added.", "Saved");
      setForm({ clientName: "", dmatNumber: "", broker: "", openedDate: todayStr() });
      setClient(null);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Could not add account.", "Failed");
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (id: string, status: string) => {
    setAccounts((a) => a.map((x) => (x.id === id ? { ...x, status, closedDate: status === "closed" ? todayStr() : x.closedDate } : x)));
    try {
      await fetch(`/api/equity/dmat/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, ...(status === "closed" ? { closedDate: todayStr() } : {}) }),
      });
      load();
    } catch {
      toast.error("Could not update.", "Failed");
      load();
    }
  };

  const remove = async (id: string) => {
    if (enhanced) {
      const a = accounts.find((x) => x.id === id);
      const ok = await confirmDialog({ title: `Delete the DMAT account of ${a?.clientName ?? "this client"}?`, message: "It also comes off the New DMAT count for its month. To record a closed account, set its status to Closed instead.", confirmLabel: "Delete", tone: "danger" });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await fetch(`/api/equity/dmat/${id}`, { method: "DELETE" });
      toast.success("Account removed.", "Deleted");
      await load();
    } catch {
      toast.error("Could not delete.", "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Add */}
      {enhanced ? (
        <div className="card-surface p-4 space-y-3">
          <div className="text-sm font-semibold">New DMAT account</div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="space-y-1">
              <span className="block text-muted-foreground text-xs">Client</span>
              <FamilyHeadPicker label="Client" value={client} onPick={(c) => { setClient(c); if (c) setForm((f) => ({ ...f, clientName: "" })); }} />
            </div>
            <label className="text-sm">
              <span className="block text-muted-foreground mb-1 text-xs">…or the account holder's name (not yet a client)</span>
              <input value={form.clientName} disabled={!!client} onChange={(e) => setForm((f) => ({ ...f, clientName: e.target.value }))} className="input-base w-full" />
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
            <label className="text-sm">
              <span className="block text-muted-foreground mb-1 text-xs">Broker / DP</span>
              <input value={form.broker} onChange={(e) => setForm((f) => ({ ...f, broker: e.target.value }))} className="input-base w-full" placeholder="e.g. Zerodha, ICICI Direct" />
            </label>
            <label className="text-sm">
              <span className="block text-muted-foreground mb-1 text-xs">DP ID / Client ID</span>
              <input value={form.dmatNumber} onChange={(e) => setForm((f) => ({ ...f, dmatNumber: e.target.value }))} className="input-base w-full" />
            </label>
            <label className="text-sm">
              <span className="block text-muted-foreground mb-1 text-xs">Opened on *</span>
              <DateField value={form.openedDate} onChange={(e) => setForm((f) => ({ ...f, openedDate: e.target.value }))} className="input-base w-full" />
            </label>
            <button type="button" onClick={add} disabled={busy || (!form.clientName.trim() && !client)} className="btn-primary justify-center">
              <Plus className="size-4" /> Add account
            </button>
          </div>
        </div>
      ) : (
      <div className="rounded-xl border border-border p-3 grid grid-cols-1 sm:grid-cols-5 gap-2 items-end">
        <label className="text-sm sm:col-span-2">
          <span className="block text-muted-foreground mb-1 text-xs">Client name *</span>
          <input value={form.clientName} onChange={(e) => setForm((f) => ({ ...f, clientName: e.target.value }))} className="w-full rounded-md border border-border px-2 py-1.5 text-sm focus:outline-none focus:border-brand-cyan" />
        </label>
        <label className="text-sm">
          <span className="block text-muted-foreground mb-1 text-xs">DMAT no.</span>
          <input value={form.dmatNumber} onChange={(e) => setForm((f) => ({ ...f, dmatNumber: e.target.value }))} className="w-full rounded-md border border-border px-2 py-1.5 text-sm focus:outline-none focus:border-brand-cyan" />
        </label>
        <label className="text-sm">
          <span className="block text-muted-foreground mb-1 text-xs">Opened date *</span>
          <DateField value={form.openedDate} onChange={(e) => setForm((f) => ({ ...f, openedDate: e.target.value }))} className="w-full rounded-md border border-border px-2 py-1.5 text-sm focus:outline-none focus:border-brand-cyan" />
        </label>
        <button type="button" onClick={add} disabled={busy || !form.clientName.trim()} className="btn-primary justify-center">
          <Plus className="size-4" /> Add
        </button>
      </div>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground py-8 text-center" aria-busy="true"><TableSkeleton rows={4} /></div>
      ) : accounts.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">No DMAT accounts yet.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/40 text-left">
                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Client</th>
                {enhanced && <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Broker</th>}
                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">{enhanced ? "DP ID / Client ID" : "DMAT no."}</th>
                {enhanced && <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">RM</th>}
                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Opened</th>
                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">Status</th>
                <th className="px-3 py-2 w-10" />
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} className="border-t border-border">
                  <td className="px-3 py-1.5 font-medium">
                    {enhanced && a.investorId ? <Link href={`/dashboard/investors/${a.investorId}`} className="hover:underline">{a.clientName}</Link> : a.clientName}
                  </td>
                  {enhanced && <td className="px-3 py-1.5 text-muted-foreground">{a.broker ?? "—"}</td>}
                  <td className="px-3 py-1.5 text-muted-foreground">{a.dmatNumber ?? "—"}</td>
                  {enhanced && <td className="px-3 py-1.5 text-muted-foreground">{a.rmName ?? "—"}</td>}
                  <td className="px-3 py-1.5 tabular-nums">{a.openedDate}</td>
                  <td className="px-3 py-1.5">
                    <SelectField className="w-32" value={a.status} onChange={(e) => setStatus(a.id, e.target.value)}>
                      <option value="active">Active</option>
                      <option value="dormant">Dormant</option>
                      <option value="closed">Closed</option>
                    </SelectField>
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    <button type="button" onClick={() => remove(a.id)} className="text-muted-foreground hover:text-rose-600" aria-label="Delete">
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
