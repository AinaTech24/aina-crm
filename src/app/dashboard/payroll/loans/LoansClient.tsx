"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { DataTable } from "@/components/ui/DataTable";
import { confirmDialog, promptDialog } from "@/components/ui/ConfirmProvider";
import { notify } from "@/components/ui/Toast";
import { LOAN_STATUS } from "@/lib/payroll/labels";
import { errText, inr, monthText, monthsFrom, send } from "@/components/payroll/send";

export type LoanRow = {
  id: string;
  name: string;
  kind: "loan" | "advance";
  principal: number;
  emi: number;
  start: string;
  status: string;
  note: string | null;
  recovered: number;
};

const num = (s: string) => Number(s.replace(/[^\d.]/g, "")) || 0;

function NewLoan({ staff, onDone }: { staff: Array<{ id: string; name: string }>; onDone: () => void }) {
  const months = monthsFrom(0, 6);
  const [v, setV] = useState({ userId: "", kind: "advance" as "loan" | "advance", principal: "", emi: "", startMonth: months[0], note: "" });
  const [busy, setBusy] = useState(false);
  const p = num(v.principal);
  const e = num(v.emi);
  const instalments = p > 0 && e > 0 ? Math.ceil(p / e) : null;
  async function save() {
    setBusy(true);
    try {
      await send("/api/payroll/loans", "POST", { userId: v.userId, kind: v.kind, principal: p, emi: e, startMonth: v.startMonth, note: v.note || undefined });
      notify.success("Saved. The next pay run recovers the first instalment.");
      onDone();
    } catch (err) {
      notify.error(errText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader title="New loan or advance" />
      <CardBody>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Team member">
          {(id) => (
            <select id={id} className="input-base w-full" value={v.userId} onChange={(ev) => setV({ ...v, userId: ev.target.value })}>
              <option value="">Choose…</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
        </Field>
        <Field label="Type">
          {(id) => (
            <select id={id} className="input-base w-full" value={v.kind} onChange={(ev) => setV({ ...v, kind: ev.target.value as "loan" | "advance" })}>
              <option value="advance">Salary advance</option>
              <option value="loan">Loan</option>
            </select>
          )}
        </Field>
        <Field label="Amount (₹)">
          {(id) => <input id={id} className="input-base w-full" inputMode="numeric" value={v.principal} onChange={(ev) => setV({ ...v, principal: ev.target.value })} />}
        </Field>
        <Field label="Monthly instalment (₹)" hint={instalments ? `${instalments} month${instalments === 1 ? "" : "s"}` : undefined}>
          {(id, d) => <input id={id} aria-describedby={d} className="input-base w-full" inputMode="numeric" value={v.emi} onChange={(ev) => setV({ ...v, emi: ev.target.value })} />}
        </Field>
        <Field label="First month recovered">
          {(id) => (
            <select id={id} className="input-base w-full" value={v.startMonth} onChange={(ev) => setV({ ...v, startMonth: ev.target.value })}>
              {months.map((m) => <option key={m} value={m}>{monthText(m)}</option>)}
            </select>
          )}
        </Field>
        <Field label="Note" optional>
          {(id) => <input id={id} className="input-base w-full" value={v.note} onChange={(ev) => setV({ ...v, note: ev.target.value })} />}
        </Field>
      </div>
      <div className="mt-4 flex justify-end">
        <Button variant="primary" disabled={busy || !v.userId || p <= 0 || e <= 0} onClick={save}>{busy ? "Saving…" : "Save"}</Button>
      </div>
      </CardBody>
    </Card>
  );
}

export function LoansClient({ rows, staff, canManage }: { rows: LoanRow[]; staff: Array<{ id: string; name: string }>; canManage: boolean }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  async function patch(id: string, body: Record<string, unknown>, done: string) {
    try {
      await send(`/api/payroll/loans/${id}`, "PATCH", body);
      notify.success(done);
      router.refresh();
    } catch (e) {
      notify.error(errText(e));
    }
  }
  return (
    <div className="space-y-4">
      {canManage && !adding && (
        <Button variant="secondary" onClick={() => setAdding(true)}><Plus className="size-4" /> New loan or advance</Button>
      )}
      {canManage && adding && <NewLoan staff={staff} onDone={() => { setAdding(false); router.refresh(); }} />}
      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        empty="No loans or advances. One given here is recovered from salary each month until repaid."
        columns={[
          { key: "who", header: "Team member", cell: (r) => <div><div className="font-medium">{r.name}</div>{r.note && <div className="text-2xs text-muted-foreground">{r.note}</div>}</div> },
          { key: "kind", header: "Type", cell: (r) => <Badge tone="neutral">{r.kind === "advance" ? "Advance" : "Loan"}</Badge>, hideOnMobile: true },
          { key: "amount", header: "Amount", cell: (r) => inr(r.principal), align: "right" },
          { key: "emi", header: "Instalment", cell: (r) => inr(r.emi), align: "right", hideOnMobile: true },
          { key: "from", header: "From", cell: (r) => monthText(r.start), hideOnMobile: true },
          { key: "recovered", header: "Recovered", cell: (r) => inr(r.recovered), align: "right", hideOnMobile: true },
          { key: "balance", header: "Balance", cell: (r) => inr(Math.max(0, r.principal - r.recovered)), align: "right" },
          { key: "status", header: "Status", cell: (r) => <Badge tone={LOAN_STATUS[r.status]?.tone ?? "neutral"}>{LOAN_STATUS[r.status]?.label ?? r.status}</Badge> },
          {
            key: "act",
            header: "",
            cell: (r) =>
              canManage && r.status === "active" ? (
                <span className="flex justify-end gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      const v = await promptDialog({ title: `Instalment — ${r.name}`, label: "Monthly instalment (₹)", defaultValue: String(r.emi), confirmLabel: "Save" });
                      if (v != null && num(v) > 0) await patch(r.id, { emi: num(v) }, "Instalment changed from the next pay run.");
                    }}
                  >
                    Change
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      const ok = await confirmDialog({ title: "Stop recovering?", message: `${inr(Math.max(0, r.principal - r.recovered))} is still outstanding. Stop only if it was repaid another way or written off.`, confirmLabel: "Stop", tone: "danger" });
                      if (ok) await patch(r.id, { action: "cancel" }, "Stopped.");
                    }}
                  >
                    Stop
                  </Button>
                </span>
              ) : null,
          },
        ]}
      />
    </div>
  );
}
