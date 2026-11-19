"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { DateField } from "@/components/ui/DateField";
import { notify } from "@/components/ui/Toast";
import { CLAIM_CATEGORIES } from "@/lib/payroll/labels";
import { errText, send } from "@/components/payroll/send";

const blank = { category: "", claimDate: "", amount: "", billNumber: "", description: "" };

export function NewClaim() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(blank);
  const [busy, setBusy] = useState(false);
  const amount = Number(v.amount.replace(/[^\d.]/g, "")) || 0;
  async function save() {
    setBusy(true);
    try {
      await send("/api/me/pay/claims", "POST", { category: v.category, claimDate: v.claimDate, amount, billNumber: v.billNumber || undefined, description: v.description });
      notify.success("Claim sent to your manager.");
      setV(blank);
      setOpen(false);
      router.refresh();
    } catch (e) {
      notify.error(errText(e));
    } finally {
      setBusy(false);
    }
  }
  if (!open) return <Button variant="primary" onClick={() => setOpen(true)}><Plus className="size-4" /> Claim an expense</Button>;
  return (
    <Card>
      <CardHeader title="Claim an expense" />
      <CardBody>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="What for">
          {(id) => (
            <select id={id} className="input-base w-full" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}>
              <option value="">Choose…</option>
              {CLAIM_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          )}
        </Field>
        <Field label="Date on the bill">
          {(id) => <DateField id={id} value={v.claimDate} onChange={(e) => setV({ ...v, claimDate: e.target.value })} />}
        </Field>
        <Field label="Amount (₹)">
          {(id) => <input id={id} className="input-base w-full" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />}
        </Field>
        <Field label="Bill or invoice number" optional hint="Keep the bill — your manager may ask for it.">
          {(id, d) => <input id={id} aria-describedby={d} className="input-base w-full" value={v.billNumber} onChange={(e) => setV({ ...v, billNumber: e.target.value })} />}
        </Field>
        <div className="sm:col-span-2">
          <Field label="Details">
            {(id) => <input id={id} className="input-base w-full" placeholder="e.g. Client visit to Vadodara — Mehta family review" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />}
          </Field>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        <Button variant="primary" disabled={busy || !v.category || !v.claimDate || amount <= 0 || v.description.trim().length < 3} onClick={save}>{busy ? "Sending…" : "Send for approval"}</Button>
      </div>
      </CardBody>
    </Card>
  );
}
