"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { notify } from "@/components/ui/Toast";
import { PROOF_ITEMS, type Declaration, type ProofKey, type Proofs } from "@/lib/payroll/tax";
import { PROOF_STATUS } from "@/lib/payroll/labels";
import { errText, inr, send } from "@/components/payroll/send";

export type DeclRow = {
  userId: string;
  id: string | null;
  name: string;
  regime: "new" | "old";
  submitted: boolean;
  declared: Declaration;
  proofs: Proofs;
  self: boolean;
};

function Verify({ row, onDone }: { row: DeclRow; onDone: () => void }) {
  const [amt, setAmt] = useState<Partial<Record<ProofKey, string>>>({});
  const [busy, setBusy] = useState(false);
  async function decide(k: ProofKey, status: "verified" | "rejected") {
    setBusy(true);
    try {
      const fallback = row.proofs[k]?.amount ?? row.declared[k] ?? 0;
      const amount = amt[k] ? Number(amt[k]!.replace(/[^\d.]/g, "")) || 0 : fallback;
      await send(`/api/payroll/declarations/${row.id}`, "PATCH", { proofs: { [k]: { status, amount } } });
      notify.success(status === "verified" ? "Verified." : "Rejected.");
      onDone();
    } catch (e) {
      notify.error(errText(e));
    } finally {
      setBusy(false);
    }
  }
  const items = PROOF_ITEMS.filter((p) => (row.declared[p.key] ?? 0) > 0 || row.proofs[p.key]);
  if (!items.length) return <div className="p-3 text-sm text-muted-foreground">Nothing declared that needs a proof.</div>;
  return (
    <div className="divide-y divide-border rounded-lg bg-secondary/50 px-4 text-sm">
      {items.map((p) => {
        const pr = row.proofs[p.key];
        return (
          <div key={p.key} className="flex flex-wrap items-center gap-3 py-2">
            <span className="min-w-0 flex-1">
              {p.label}
              <span className="block text-2xs text-muted-foreground">
                Declared {inr(row.declared[p.key] ?? 0)}{pr?.amount != null ? ` · proof for ${inr(pr.amount)}` : " · no proof yet"}
                {p.key === "rentPaid" && row.declared.landlordPan ? ` · landlord PAN ${row.declared.landlordPan}` : ""}
              </span>
            </span>
            {pr && <Badge tone={PROOF_STATUS[pr.status]?.tone ?? "neutral"}>{PROOF_STATUS[pr.status]?.label}</Badge>}
            {!row.self && (
              <>
                <label className="w-32">
                  <span className="sr-only">Verified amount for {p.label}</span>
                  <input className="input-base w-full" inputMode="numeric" placeholder={String(pr?.amount ?? row.declared[p.key] ?? 0)} value={amt[p.key] ?? ""} onChange={(e) => setAmt({ ...amt, [p.key]: e.target.value })} />
                </label>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => decide(p.key, "verified")}>Verify</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide(p.key, "rejected")}>Reject</Button>
              </>
            )}
          </div>
        );
      })}
      {row.self && <div className="py-2 text-muted-foreground">Someone else verifies your own proofs.</div>}
    </div>
  );
}

export function DeclarationsClient({ rows, fyLabel, canManage }: { rows: DeclRow[]; fyLabel: string; canManage: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const pending = (r: DeclRow) => Object.values(r.proofs).filter((p) => p?.status === "submitted").length;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Financial year {fyLabel}. Team members declare in My pay → Tax declaration.</p>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="text-left">Team member</th>
              <th className="text-left">Regime</th>
              <th className="text-left">Declaration</th>
              <th className="text-right">Proofs to verify</th>
              <th className="relative"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">Nobody with a salary yet.</td></tr>}
            {rows.map((r) => (
              <Fragment key={r.userId}>
                <tr>
                  <td className="font-medium">{r.name}</td>
                  <td><Badge tone="neutral">{r.regime === "old" ? "Old" : "New"}</Badge></td>
                  <td>{r.submitted ? "Submitted" : <span className="text-muted-foreground">Not submitted — nothing declared</span>}</td>
                  <td className="text-right tabular-nums">{pending(r) || "—"}</td>
                  <td className="text-right">
                    {canManage && r.id && r.regime === "old" && (
                      <Button size="sm" variant="ghost" onClick={() => setOpen(open === r.userId ? null : r.userId)}>{open === r.userId ? "Close" : "Proofs"}</Button>
                    )}
                  </td>
                </tr>
                {open === r.userId && (
                  <tr><td colSpan={5}><Verify row={r} onDone={() => router.refresh()} /></td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
