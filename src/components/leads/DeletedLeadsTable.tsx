"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { DataTable } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { InlineEmpty } from "@/components/common/EmptyState";
import { notify } from "@/components/ui/Toast";
import { formatDate, formatPhone } from "@/lib/utils";
import { leadSourceLabel } from "@/lib/leads/sources";
import { stageLabel } from "@/lib/leads/stages";

export type DeletedLeadRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  source: string | null;
  deletedAt: string | null;
  ownerName: string | null;
};

export function DeletedLeadsTable({ rows }: { rows: DeletedLeadRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function restore(row: DeletedLeadRow) {
    setBusy(row.id);
    try {
      const res = await fetch(`/api/leads/${row.id}/restore`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify.error(j.error ?? "Could not restore the lead.");
        return;
      }
      notify.success(`${row.name} is back on the board (${stageLabel(j.stage)}).`);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card-surface">
      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        caption="Deleted leads"
        empty={<InlineEmpty message="No deleted leads." />}
        columns={[
          { key: "name", header: "Lead", cell: (r) => <span className="font-medium">{r.name}</span> },
          {
            key: "contact",
            header: "Contact",
            hideWhenEmpty: true,
            cell: (r) => [r.phone ? formatPhone(r.phone) : null, r.email].filter(Boolean).join(" · "),
          },
          { key: "source", header: "Source", hideOnMobile: true, cell: (r) => (r.source ? leadSourceLabel(r.source) : "") },
          { key: "owner", header: "Owner", hideOnMobile: true, hideWhenEmpty: true, cell: (r) => r.ownerName ?? "" },
          { key: "deleted", header: "Deleted", hideOnMobile: true, cell: (r) => (r.deletedAt ? formatDate(r.deletedAt) : "") },
          {
            key: "actions",
            header: <span className="sr-only">Actions</span>,
            align: "right",
            // sr-only needs a positioned cell inside a scrolling table.
            className: "relative",
            cell: (r) => (
              <Button
                size="sm"
                variant="secondary"
                loading={busy === r.id}
                icon={<RotateCcw className="size-3.5" aria-hidden />}
                onClick={() => restore(r)}
              >
                Restore
              </Button>
            ),
          },
        ]}
      />
      <p className="px-4 py-3 text-2xs text-muted-foreground border-t border-border">
        A restored lead goes back to the step it was on, with its owner. <Link href="/dashboard/leads" className="underline">Back to leads</Link>
      </p>
    </div>
  );
}
