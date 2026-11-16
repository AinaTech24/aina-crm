"use client";

/**
 * Working a pay run: the totals, everyone's figures, and — on a draft —
 * days without pay, one-time earnings / deductions and holds; then approve
 * (by someone other than the preparer, unless the owner), mark paid, download.
 */

import { Fragment, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Pause, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { confirmDialog, promptDialog } from "@/components/ui/ConfirmProvider";
import { notify } from "@/components/ui/Toast";
import { DownloadButton } from "@/components/common/SecureLinkButtons";
import type { PayAdjustment } from "@/db/schema/payroll";

export type ItemRow = {
  id: string;
  userId: string;
  name: string;
  code: string | null;
  payableDays: number;
  baseDays: number;
  lopDays: number;
  lopOverride: boolean;
  lopWhy: string | null;
  onHold: boolean;
  adjustments: PayAdjustment[];
  gross: number;
  pf: number;
  esi: number;
  pt: number;
  tds: number;
  net: number;
  warnings: string[];
};

type Run = {
  id: string;
  status: string;
  period: string;
  preparedBy: string | null;
  approvedBy: string | null;
  paidBy: string | null;
  paidOn: string | null;
  youPrepared: boolean;
  youAreOwner: boolean;
  totals: { employees: number; gross: number; net: number; tds: number; pf: number; esi: number; pt: number; employerCost: number; onHold: number };
};

const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-bold tabular-nums">{value}</div>
      {hint && <div className="text-2xs text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

function Adjustments({ runId, row, onDone }: { runId: string; row: ItemRow; onDone: () => void }) {
  const [list, setList] = useState<PayAdjustment[]>(row.adjustments);
  const [draft, setDraft] = useState<PayAdjustment>({ label: "", amount: 0, kind: "earning", taxable: true });
  const [busy, setBusy] = useState(false);
  async function save(next: PayAdjustment[]) {
    setBusy(true);
    try {
      const res = await fetch(`/api/payroll/runs/${runId}/items/${row.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ adjustments: next }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Could not save");
      setList(next);
      notify.success("Saved and recalculated.");
      onDone();
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3 rounded-lg bg-secondary/50 p-4 text-sm">
      <div className="font-medium">One-time payments and deductions for {row.name}</div>
      {list.length === 0 && <div className="text-muted-foreground">None this month.</div>}
      {list.map((a, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1">{a.label}</span>
          <Badge tone="neutral">{a.kind === "earning" ? (a.taxable ? "Payment" : "Payment, not taxed") : "Deduction"}</Badge>
          <span className="tabular-nums">{rupees(a.amount)}</span>
          <button type="button" className="btn-icon" aria-label={`Remove ${a.label}`} disabled={busy} onClick={() => save(list.filter((_, k) => k !== i))}>
            <Trash2 className="size-4" />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex-1 min-w-[10rem]">
          <span className="block text-xs text-muted-foreground mb-1">What for</span>
          <input className="input-base w-full" placeholder="e.g. Diwali bonus, advance recovery" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
        </label>
        <label className="w-32">
          <span className="block text-xs text-muted-foreground mb-1">Amount (₹)</span>
          <input className="input-base w-full" inputMode="numeric" value={draft.amount || ""} onChange={(e) => setDraft({ ...draft, amount: Number(e.target.value.replace(/\D/g, "")) })} />
        </label>
        <label>
          <span className="block text-xs text-muted-foreground mb-1">Type</span>
          <select
            className="input-base"
            value={draft.kind === "deduction" ? "deduction" : draft.taxable ? "earning" : "earning_free"}
            onChange={(e) => setDraft({ ...draft, kind: e.target.value === "deduction" ? "deduction" : "earning", taxable: e.target.value !== "earning_free" })}
          >
            <option value="earning">Payment (taxed)</option>
            <option value="earning_free">Payment, not taxed (reimbursement)</option>
            <option value="deduction">Deduction</option>
          </select>
        </label>
        <Button variant="secondary" disabled={busy || draft.label.trim().length < 2 || draft.amount <= 0} onClick={() => { void save([...list, { ...draft, label: draft.label.trim() }]); setDraft({ label: "", amount: 0, kind: "earning", taxable: true }); }}>
          <Plus className="size-4" /> Add
        </Button>
      </div>
    </div>
  );
}

export function RunWorkspace({ run, rows, canManage }: { run: Run; rows: ItemRow[]; canManage: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const draft = run.status === "draft" && canManage;

  async function act(label: string, url: string, init: RequestInit, done: string) {
    setBusy(label);
    try {
      const res = await fetch(url, { headers: { "content-type": "application/json" }, ...init });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Could not do that");
      notify.success(done);
      router.refresh();
      return true;
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Could not do that");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function editLop(r: ItemRow) {
    const days = await promptDialog({ title: `Days without pay — ${r.name}`, label: "Days (half days allowed, e.g. 1.5)", defaultValue: String(r.lopDays), confirmLabel: "Next" });
    if (days == null) return;
    const n = Number(days);
    if (!Number.isFinite(n) || n < 0 || n > 31) return notify.error("Enter a number of days between 0 and 31.");
    const reason = await promptDialog({ title: "Why?", label: "Reason (kept on the record)", placeholder: "e.g. 2 days absent without notice", confirmLabel: "Save" });
    if (!reason || reason.trim().length < 3) return notify.error("A reason is needed.");
    await act("lop", `/api/payroll/runs/${run.id}/items/${r.id}`, { method: "PATCH", body: JSON.stringify({ lopDays: n, lopReason: reason }) }, "Saved and recalculated.");
  }

  const canApprove = run.status === "draft" && canManage && (!run.youPrepared || run.youAreOwner);
  const warnings = rows.reduce((n, r) => n + (r.warnings.length ? 1 : 0), 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        {run.preparedBy && <span>Prepared by {run.preparedBy}</span>}
        {run.approvedBy && <span>· Approved by {run.approvedBy}</span>}
        {run.paidBy && <span>· Paid{run.paidOn ? ` on ${run.paidOn}` : ""} (marked by {run.paidBy})</span>}
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Tile label="People paid" value={String(run.totals.employees)} hint={run.totals.onHold ? `${run.totals.onHold} on hold` : undefined} />
        <Tile label="Gross pay" value={rupees(run.totals.gross)} />
        <Tile label="Net pay to bank" value={rupees(run.totals.net)} />
        <Tile label="Cost to firm" value={rupees(run.totals.employerCost)} hint={`PF ${rupees(run.totals.pf)} · ESI ${rupees(run.totals.esi)} · PT ${rupees(run.totals.pt)} · TDS ${rupees(run.totals.tds)}`} />
      </div>

      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          {run.status === "draft" && (
            <>
              <Button variant="secondary" disabled={!!busy} onClick={() => act("recalc", `/api/payroll/runs/${run.id}`, { method: "PATCH", body: JSON.stringify({ action: "recalculate" }) }, "Recalculated from the latest salaries, leave and attendance.")}>
                {busy === "recalc" ? "Working…" : "Recalculate"}
              </Button>
              <Button
                variant="primary"
                disabled={!!busy || !canApprove}
                title={canApprove ? undefined : "The person who prepared the run cannot approve it — the owner or another payroll manager approves."}
                onClick={async () => {
                  const ok = await confirmDialog({ title: "Approve this pay run?", message: `Net pay ${rupees(run.totals.net)} to ${run.totals.employees} people. Payslips become visible in My pay and the figures are frozen.`, confirmLabel: "Approve" });
                  if (ok) await act("approve", `/api/payroll/runs/${run.id}`, { method: "PATCH", body: JSON.stringify({ action: "approve" }) }, "Approved.");
                }}
              >
                Approve
              </Button>
              <Button
                variant="ghost"
                disabled={!!busy}
                onClick={async () => {
                  const ok = await confirmDialog({ title: "Delete this draft?", message: "The draft and any days or adjustments entered on it are removed.", confirmLabel: "Delete", tone: "danger" });
                  if (ok && (await act("delete", `/api/payroll/runs/${run.id}`, { method: "DELETE" }, "Draft deleted."))) router.push("/dashboard/payroll");
                }}
              >
                Delete draft
              </Button>
            </>
          )}
          {run.status === "approved" && (
            <>
              <Button
                variant="primary"
                disabled={!!busy}
                onClick={async () => {
                  const on = await promptDialog({ title: "Mark as paid", label: "Paid on (yyyy-mm-dd)", defaultValue: new Date().toISOString().slice(0, 10), confirmLabel: "Mark paid" });
                  if (on && /^\d{4}-\d{2}-\d{2}$/.test(on)) await act("paid", `/api/payroll/runs/${run.id}`, { method: "PATCH", body: JSON.stringify({ action: "paid", paidOn: on }) }, "Marked paid — the run is locked.");
                  else if (on) notify.error("Use the form yyyy-mm-dd.");
                }}
              >
                Mark paid
              </Button>
              <Button variant="ghost" disabled={!!busy} onClick={() => act("reopen", `/api/payroll/runs/${run.id}`, { method: "PATCH", body: JSON.stringify({ action: "reopen" }) }, "Reopened as a draft.")}>
                Reopen
              </Button>
            </>
          )}
          <span className="ml-auto flex flex-wrap gap-2">
            <DownloadButton url={`/api/payroll/runs/${run.id}/export?kind=register`} className="btn-secondary">Salary register</DownloadButton>
            {run.status !== "draft" && <DownloadButton url={`/api/payroll/runs/${run.id}/export?kind=bank`} className="btn-secondary">Bank file</DownloadButton>}
          </span>
        </div>
      )}

      {warnings > 0 && (
        <div className="rounded-xl border border-warning/50 bg-warning/5 p-3 text-sm flex items-center gap-2">
          <AlertTriangle className="size-4 shrink-0" /> {warnings} {warnings === 1 ? "person has" : "people have"} something to check — open their payslip.
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="text-left">Employee</th>
              <th className="text-right">Paid days</th>
              <th className="text-right">Without pay</th>
              <th className="text-right">Gross</th>
              <th className="text-right">PF</th>
              <th className="text-right">ESI</th>
              <th className="text-right">PT</th>
              <th className="text-right">TDS</th>
              <th className="text-right">Net pay</th>
              <th className="relative"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={10} className="py-6 text-center text-muted-foreground">Nobody on this run — set salaries under Employees, then Recalculate.</td></tr>
            )}
            {rows.map((r) => (
              <Fragment key={r.id}>
                <tr className={r.onHold ? "opacity-60" : undefined}>
                  <td>
                    <Link href={`/dashboard/payroll/runs/${run.id}/payslip/${r.userId}`} className="font-medium hover:underline">{r.name}</Link>
                    <div className="text-2xs text-muted-foreground">
                      {[r.code, r.onHold ? "On hold" : null, r.adjustments.length ? `${r.adjustments.length} one-time item${r.adjustments.length === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ")}
                      {r.warnings.length > 0 && <span className="text-warning"> · check payslip</span>}
                    </div>
                  </td>
                  <td className="text-right tabular-nums">{r.payableDays}/{r.baseDays}</td>
                  <td className="text-right tabular-nums">
                    {draft ? (
                      <button type="button" className="underline decoration-dotted" title={r.lopWhy ?? "From leave and attendance"} onClick={() => editLop(r)}>{r.lopDays}</button>
                    ) : (
                      <span title={r.lopWhy ?? undefined}>{r.lopDays}</span>
                    )}
                    {r.lopOverride && <span className="block text-2xs text-muted-foreground">by hand</span>}
                  </td>
                  <td className="text-right tabular-nums">{rupees(r.gross)}</td>
                  <td className="text-right tabular-nums">{r.pf ? rupees(r.pf) : "—"}</td>
                  <td className="text-right tabular-nums">{r.esi ? rupees(r.esi) : "—"}</td>
                  <td className="text-right tabular-nums">{r.pt ? rupees(r.pt) : "—"}</td>
                  <td className="text-right tabular-nums">{r.tds ? rupees(r.tds) : "—"}</td>
                  <td className="text-right tabular-nums font-semibold">{rupees(r.net)}</td>
                  <td className="text-right whitespace-nowrap">
                    {draft && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setOpen(open === r.id ? null : r.id)}>Adjust</Button>
                        <button
                          type="button"
                          className="btn-icon"
                          aria-label={r.onHold ? `Release ${r.name}'s salary` : `Hold ${r.name}'s salary`}
                          title={r.onHold ? "Release" : "Hold this salary"}
                          disabled={!!busy}
                          onClick={() => act("hold", `/api/payroll/runs/${run.id}/items/${r.id}`, { method: "PATCH", body: JSON.stringify({ onHold: !r.onHold }) }, r.onHold ? "Released." : "On hold — left out of the bank file.")}
                        >
                          <Pause className="size-4" />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
                {open === r.id && draft && (
                  <tr>
                    <td colSpan={10}><Adjustments runId={run.id} row={r} onDone={() => router.refresh()} /></td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
