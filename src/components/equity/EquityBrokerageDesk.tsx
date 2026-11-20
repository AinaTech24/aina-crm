"use client";

/**
 * Equity desk — daily brokerage (We Care, 2026-11-20). One row per trading day,
 * as the equity team kept it in Zoho's "Equity" module; the month's total is the
 * sum of its days and feeds the Equity Team MIS and the Brokerage MoM report.
 */

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { DateField } from "@/components/ui/DateField";
import { confirmDialog } from "@/components/ui/ConfirmProvider";
import { useToast } from "@/components/ui/Toast";
import { TableSkeleton } from "@/components/common/Skeleton";
import { formatDate } from "@/lib/format";

type Day = {
  id: string;
  tradeDate: string;
  brokerage: number;
  turnover: number | null;
  activeClients: number | null;
  notes: string | null;
  fromZoho: boolean;
  createdByName: string | null;
};
type MonthTotal = { period: string; amount: number; days: number | null };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (p: string) => `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const shift = (p: string, by: number) => {
  const d = new Date(Number(p.slice(0, 4)), Number(p.slice(5, 7)) - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const rupees = (n: number | null | undefined) => (n == null ? "—" : `₹${Math.round(n).toLocaleString("en-IN")}`);
const lakhs = (n: number) => `₹${(n / 1e5).toFixed(2)} L`;

type Draft = { tradeDate: string; brokerage: string; turnover: string; activeClients: string; notes: string };
const emptyDraft = (): Draft => ({ tradeDate: today(), brokerage: "", turnover: "", activeClients: "", notes: "" });
const toBody = (d: Draft) => ({
  tradeDate: d.tradeDate,
  brokerage: Number(d.brokerage),
  turnover: d.turnover.trim() ? Number(d.turnover) : null,
  activeClients: d.activeClients.trim() ? Math.round(Number(d.activeClients)) : null,
  notes: d.notes.trim() || null,
});
const valid = (d: Draft) =>
  !!d.tradeDate && d.brokerage.trim() !== "" && Number.isFinite(Number(d.brokerage)) && Number(d.brokerage) >= 0 &&
  (!d.turnover.trim() || Number.isFinite(Number(d.turnover))) && (!d.activeClients.trim() || Number.isFinite(Number(d.activeClients)));

export function EquityBrokerageDesk() {
  const toast = useToast();
  const [month, setMonth] = useState(today().slice(0, 7));
  const [days, setDays] = useState<Day[]>([]);
  const [months, setMonths] = useState<MonthTotal[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (m: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/equity/brokerage-days?month=${m}`, { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error ?? "Could not load brokerage.");
      setDays(j.days ?? []);
      setMonths(j.months ?? []);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not load brokerage.", "Load failed");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load(month);
  }, [month, load]);

  const save = async () => {
    if (!valid(draft)) return;
    setBusy(true);
    try {
      const res = await fetch(editing ? `/api/equity/brokerage-days/${editing}` : "/api/equity/brokerage-days", {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(toBody(draft)),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error ?? "Could not save.");
      toast.success(editing ? "Trading day updated." : `Brokerage for ${formatDate(draft.tradeDate)} saved.`, "Saved");
      const savedMonth = draft.tradeDate.slice(0, 7);
      setEditing(null);
      setDraft(emptyDraft());
      if (savedMonth !== month) setMonth(savedMonth);
      else await load(month);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save.", "Failed");
    } finally {
      setBusy(false);
    }
  };

  const edit = (d: Day) => {
    setEditing(d.id);
    setDraft({
      tradeDate: d.tradeDate,
      brokerage: String(d.brokerage),
      turnover: d.turnover == null ? "" : String(d.turnover),
      activeClients: d.activeClients == null ? "" : String(d.activeClients),
      notes: d.notes ?? "",
    });
  };

  const remove = async (d: Day) => {
    const ok = await confirmDialog({ title: `Delete brokerage for ${formatDate(d.tradeDate)}?`, message: `${rupees(d.brokerage)} comes off ${monthLabel(month)}'s total.`, confirmLabel: "Delete", tone: "danger" });
    if (!ok) return;
    const res = await fetch(`/api/equity/brokerage-days/${d.id}`, { method: "DELETE" });
    if (!res.ok) toast.error("Could not delete.", "Failed");
    else toast.success("Trading day deleted.", "Deleted");
    if (editing === d.id) {
      setEditing(null);
      setDraft(emptyDraft());
    }
    await load(month);
  };

  const total = days.reduce((s, d) => s + d.brokerage, 0);
  const turnover = days.reduce((s, d) => s + (d.turnover ?? 0), 0);
  const prev = months.find((m) => m.period === shift(month, -1));
  const inputCls = "input-base w-full";

  return (
    <div className="space-y-4">
      {/* Entry */}
      <div className="card-surface p-4 space-y-3">
        <div className="text-sm font-semibold">{editing ? "Correct a trading day" : "Add today's brokerage"}</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <Field label="Trading date" required>
            {(id) => <DateField id={id} value={draft.tradeDate} max={today()} onChange={(e) => setDraft((d) => ({ ...d, tradeDate: e.target.value }))} className={inputCls} />}
          </Field>
          <Field label="Brokerage (₹)" required>
            {(id) => <input id={id} inputMode="decimal" value={draft.brokerage} onChange={(e) => setDraft((d) => ({ ...d, brokerage: e.target.value }))} className={inputCls} placeholder="e.g. 18450" />}
          </Field>
          <Field label="Turnover (₹)" optional>
            {(id) => <input id={id} inputMode="decimal" value={draft.turnover} onChange={(e) => setDraft((d) => ({ ...d, turnover: e.target.value }))} className={inputCls} />}
          </Field>
          <Field label="Active clients" optional>
            {(id) => <input id={id} inputMode="numeric" value={draft.activeClients} onChange={(e) => setDraft((d) => ({ ...d, activeClients: e.target.value }))} className={inputCls} />}
          </Field>
          <div className="flex gap-2">
            <Button variant="primary" icon={editing ? undefined : <Plus className="size-4" />} loading={busy} disabled={!valid(draft)} onClick={save} className="flex-1 justify-center">
              {editing ? "Save" : "Add"}
            </Button>
            {editing && (
              <Button variant="ghost" onClick={() => { setEditing(null); setDraft(emptyDraft()); }}>
                Cancel
              </Button>
            )}
          </div>
        </div>
        <Field label="Notes" optional>
          {(id) => <input id={id} value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} className={inputCls} maxLength={500} />}
        </Field>
      </div>

      {/* Month */}
      <div className="card-surface p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <button type="button" className="btn-icon" aria-label="Previous month" onClick={() => setMonth((m) => shift(m, -1))}>
              <ChevronLeft className="size-4" />
            </button>
            <div className="text-sm font-semibold w-24 text-center">{monthLabel(month)}</div>
            <button type="button" className="btn-icon" aria-label="Next month" disabled={month >= today().slice(0, 7)} onClick={() => setMonth((m) => shift(m, 1))}>
              <ChevronRight className="size-4" />
            </button>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <span>
              <span className="text-muted-foreground">Brokerage </span>
              <span className="font-semibold tabular-nums">{rupees(total)}</span>
            </span>
            <span>
              <span className="text-muted-foreground">Trading days </span>
              <span className="font-semibold tabular-nums">{days.length}</span>
            </span>
            {turnover > 0 && (
              <span>
                <span className="text-muted-foreground">Turnover </span>
                <span className="font-semibold tabular-nums">{rupees(turnover)}</span>
              </span>
            )}
            {prev && prev.amount > 0 && (
              <span className="text-muted-foreground">
                {monthLabel(prev.period)}: <span className="tabular-nums">{lakhs(prev.amount)}</span>
              </span>
            )}
          </div>
        </div>

        {loading ? (
          <TableSkeleton rows={5} />
        ) : days.length === 0 ? (
          <div className="dash-empty text-sm text-muted-foreground p-6 text-center">No trading days entered for {monthLabel(month)}.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">Date</th>
                  <th className="text-right">Brokerage</th>
                  <th className="text-right">Turnover</th>
                  <th className="text-right">Active clients</th>
                  <th className="text-left">Notes</th>
                  <th className="text-left">Entered by</th>
                  <th className="relative w-20"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <tr key={d.id} className={editing === d.id ? "bg-primary/5" : ""}>
                    <td className="whitespace-nowrap">{formatDate(d.tradeDate)}</td>
                    <td className="text-right tabular-nums font-medium">{rupees(d.brokerage)}</td>
                    <td className="text-right tabular-nums">{rupees(d.turnover)}</td>
                    <td className="text-right tabular-nums">{d.activeClients ?? "—"}</td>
                    <td className="text-muted-foreground">{d.notes ?? ""}</td>
                    <td className="text-muted-foreground whitespace-nowrap">{d.fromZoho ? "Zoho" : d.createdByName ?? "—"}</td>
                    <td className="text-right whitespace-nowrap">
                      <button type="button" className="btn-icon" aria-label={`Edit ${d.tradeDate}`} onClick={() => edit(d)}>
                        <Pencil className="size-4" />
                      </button>
                      <button type="button" className="btn-icon hover:text-destructive" aria-label={`Delete ${d.tradeDate}`} onClick={() => remove(d)}>
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

      {/* Recent months */}
      {months.length > 0 && (
        <div className="card-surface p-4">
          <div className="text-sm font-semibold mb-2">Brokerage by month</div>
          <div className="flex flex-wrap gap-2">
            {months.map((m) => (
              <button
                key={m.period}
                type="button"
                onClick={() => setMonth(m.period)}
                aria-pressed={m.period === month}
                className={`rounded-lg px-3 py-2 text-left text-sm ${m.period === month ? "bg-primary/10 ring-1 ring-primary/30" : "bg-secondary/70 hover:bg-secondary"}`}
              >
                <div className="text-xs text-muted-foreground">{monthLabel(m.period)}</div>
                <div className="font-semibold tabular-nums">{lakhs(m.amount)}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
