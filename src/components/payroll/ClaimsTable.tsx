"use client";

/**
 * Reimbursement claims in a table — the claimant's own ("mine": withdraw a
 * pending one), or claims someone may decide ("decide": approve / reject with
 * a reason). Amounts only; never a salary.
 */

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { confirmDialog, promptDialog } from "@/components/ui/ConfirmProvider";
import { notify } from "@/components/ui/Toast";
import { CLAIM_STATUS, claimCategoryLabel } from "@/lib/payroll/labels";
import { errText, inr, send } from "./send";

export type ClaimRow = {
  id: string;
  name?: string;
  category: string;
  claimDate: string;
  amount: number;
  billNumber: string | null;
  description: string | null;
  status: string;
  decisionNote: string | null;
  inRun: string | null;
  canDecide?: boolean;
};

const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function ClaimsTable({ rows, mode, empty }: { rows: ClaimRow[]; mode: "mine" | "decide"; empty: string }) {
  const router = useRouter();
  async function decide(r: ClaimRow, action: "approve" | "reject") {
    let note: string | undefined;
    if (action === "reject") {
      const why = await promptDialog({ title: `Reject ${inr(r.amount)}?`, label: "Reason (the claimant sees it)", confirmLabel: "Reject" });
      if (!why || why.trim().length < 3) return;
      note = why.trim();
    }
    try {
      await send(`/api/payroll/claims/${r.id}`, "PATCH", { action, note });
      notify.success(action === "approve" ? "Approved — the next pay run repays it." : "Rejected.");
      router.refresh();
    } catch (e) {
      notify.error(errText(e));
    }
  }
  async function withdraw(r: ClaimRow) {
    if (!(await confirmDialog({ title: "Withdraw this claim?", message: `${claimCategoryLabel(r.category)}, ${inr(r.amount)}.`, confirmLabel: "Withdraw" }))) return;
    try {
      await send(`/api/me/pay/claims/${r.id}`, "PATCH", { action: "withdraw" });
      notify.success("Withdrawn.");
      router.refresh();
    } catch (e) {
      notify.error(errText(e));
    }
  }
  return (
    <DataTable
      rows={rows}
      rowKey={(r) => r.id}
      empty={empty}
      columns={[
        ...(mode === "decide" ? [{ key: "who", header: "Claimed by", cell: (r: ClaimRow) => <span className="font-medium">{r.name}</span> }] : []),
        {
          key: "what",
          header: "Expense",
          cell: (r) => (
            <div>
              <div className={mode === "mine" ? "font-medium" : undefined}>{claimCategoryLabel(r.category)}</div>
              <div className="text-2xs text-muted-foreground">{[r.description, r.billNumber ? `Bill ${r.billNumber}` : null].filter(Boolean).join(" · ")}</div>
              {r.decisionNote && <div className="text-2xs text-muted-foreground">Note: {r.decisionNote}</div>}
            </div>
          ),
        },
        { key: "date", header: "Bill date", cell: (r) => day(r.claimDate), hideOnMobile: true },
        { key: "amount", header: "Amount", cell: (r) => inr(r.amount), align: "right" },
        {
          key: "status",
          header: "Status",
          cell: (r) => (
            <div>
              <Badge tone={CLAIM_STATUS[r.status]?.tone ?? "neutral"}>{CLAIM_STATUS[r.status]?.label ?? r.status}</Badge>
              {r.inRun && r.status === "approved" && <div className="text-2xs text-muted-foreground mt-0.5">In {r.inRun} payroll</div>}
            </div>
          ),
        },
        {
          key: "act",
          header: "",
          cell: (r) =>
            mode === "mine" ? (
              r.status === "submitted" ? <Button size="sm" variant="ghost" onClick={() => withdraw(r)}>Withdraw</Button> : null
            ) : r.canDecide && (r.status === "submitted" || (r.status === "approved" && !r.inRun)) ? (
              <span className="flex justify-end gap-1">
                {r.status === "submitted" && <Button size="sm" variant="secondary" onClick={() => decide(r, "approve")}>Approve</Button>}
                <Button size="sm" variant="ghost" onClick={() => decide(r, "reject")}>Reject</Button>
              </span>
            ) : null,
        },
      ]}
    />
  );
}
