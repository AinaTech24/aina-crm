"use client";

/**
 * ProposalsBulkTable — the proposals list rendered through the generic BulkTable
 * so rows can be selected and bulk-deleted (select-all → Delete → clear). Per-row
 * edit/cancel stays available via RowActions. Each column keeps its `data-col`
 * so <ColumnManager moduleKey="proposals"> still shows/hides columns.
 *
 * A draft or sent proposal past its valid-till date reads Expired (the page
 * computes `lapsed` in SQL on the IST calendar), and Renew gives it the same
 * 30 days a new proposal gets.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, RotateCcw } from "lucide-react";
import { formatINR } from "@/lib/utils";
import { formatDate, formatRelative } from "@/lib/format";
import { RowActions } from "@/components/common/RowActions";
import { BulkTable, type BulkColumn, type BulkAction } from "@/components/common/BulkTable";
import { Avatar } from "@/components/ui/Avatar";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { confirmDialog } from "@/components/ui/ConfirmProvider";
import { notify } from "@/components/ui/Toast";
import { PdfModal } from "@/components/common/PdfModal";

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  ready: { label: "Ready", tone: "info" },
  sent: { label: "Sent", tone: "warning" },
  viewed: { label: "Viewed", tone: "info" },
  accepted: { label: "Accepted", tone: "success" },
  partially_approved: { label: "Partially approved", tone: "warning" },
  rejected: { label: "Rejected", tone: "danger" },
  expired: { label: "Expired", tone: "danger" },
  executed: { label: "Executed", tone: "success" },
};
const TYPE_LABEL: Record<string, string> = {
  comprehensive: "Comprehensive", mutual_fund: "Mutual Fund", insurance: "Insurance", pms: "PMS", aif: "AIF", mixed: "Mixed",
};
const TYPE_TONE: Record<string, string> = {
  comprehensive: "bg-violet-50 text-violet-700", mutual_fund: "bg-emerald-50 text-emerald-700", insurance: "bg-blue-50 text-blue-700",
  pms: "bg-amber-50 text-amber-700", aif: "bg-rose-50 text-rose-700", mixed: "bg-purple-50 text-purple-700",
};
const RECIPIENT_KIND: Record<string, string> = { lead: "Lead", investor: "Client", family: "Family" };
/** The validity a new proposal gets (proposals/new), so a renewal matches it. */
const RENEW_DAYS = 30;
const WEEK_MS = 7 * 86_400_000;

type Row = Record<string, any> & { id: string };

const actions: BulkAction[] = [{ kind: "delete", label: "Delete" }];

const isExpired = (p: Row) => p.status === "expired" || p.lapsed === true;

/** Within a week either side, how long; further out, the valid-till date itself. */
function validTill(p: Row): string {
  if (!p.valid_until) return "—";
  const lapses = new Date(p.lapses_at).getTime();
  return Math.abs(lapses - Date.now()) < WEEK_MS
    ? formatRelative(p.lapses_at, { future: true })
    : formatDate(p.valid_date ?? p.valid_until);
}

/** Today + n days as the form's YYYY-MM-DD, on the viewer's own calendar. */
function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function ProposalsBulkTable({ rows, canRenew = false }: { rows: Row[]; canRenew?: boolean }) {
  const router = useRouter();
  const [preview, setPreview] = useState<Row | null>(null);
  const [renewing, setRenewing] = useState<string | null>(null);

  async function renew(p: Row) {
    const until = inDays(RENEW_DAYS);
    // The expiry job stored "expired"; give it back the state it lapsed from.
    const back = p.status === "expired" ? (p.viewed_at ? "viewed" : p.sent_at ? "sent" : "ready") : null;
    const ok = await confirmDialog({
      title: "Renew this proposal?",
      message: `${p.proposal_number} will be valid till ${formatDate(until)}, ${RENEW_DAYS} days from today.${
        p.sent_at ? " The copy the client has still shows the old date; send it again from the proposal if they need the new one." : ""
      }`,
      confirmLabel: "Renew",
    });
    if (!ok) return;
    setRenewing(p.id);
    try {
      const res = await fetch(`/api/proposals/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ validUntil: until, ...(back ? { status: back } : {}) }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        notify.error(j?.error ?? "Could not renew the proposal.");
        return;
      }
      notify.success(`${p.proposal_number} is valid till ${formatDate(until)}.`);
      router.refresh();
    } finally {
      setRenewing(null);
    }
  }

  const columns: BulkColumn<Row>[] = [
    {
      key: "number", colKey: "number", header: "#", thClass: "text-left px-4 py-2 font-medium", tdClass: "px-4 py-3 text-xs whitespace-nowrap",
      render: (p) => (
        <Link href={`/dashboard/proposals/${p.id}`} className="text-brand-cyan-deep hover:underline font-semibold" title={p.proposal_number}>{p._seq ?? p.proposal_number}</Link>
      ),
    },
    {
      key: "title", colKey: "title", header: "Title", tdClass: "py-3 text-xs",
      render: (p) => (
        <>
          <div className="font-medium text-foreground">{p.title}</div>
          {p.risk_rating && <div className="text-2xs text-muted-foreground capitalize">Risk · {p.risk_rating}</div>}
        </>
      ),
    },
    {
      key: "recipient", colKey: "recipient", header: "Client", tdClass: "py-3 text-xs whitespace-nowrap",
      render: (p) => {
        const isLead = p.recipient_type === "lead";
        const eid = isLead ? p.lead_id : p.investor_id;
        const avatarUrl = isLead ? p.lead_avatar_url : p.investor_avatar_url;
        return (
          <div className="flex items-center gap-2">
            <Avatar
              src={eid && avatarUrl ? `/api/${isLead ? "leads" : "investors"}/${eid}/avatar` : null}
              name={p.recipient_name}
              size={26}
            />
            <span className="font-medium">{p.recipient_name}</span>
            <Badge raw>{RECIPIENT_KIND[p.recipient_type] ?? "Client"}</Badge>
          </div>
        );
      },
    },
    {
      key: "type", colKey: "type", header: "Type", tdClass: "py-3",
      render: (p) => <span className={`chip ${TYPE_TONE[p.type] ?? ""} text-2xs`}>{TYPE_LABEL[p.type] ?? p.type}</span>,
    },
    {
      key: "invest", colKey: "invest", header: "Invest amount", thClass: "text-right py-2 font-medium", tdClass: "py-3 text-right tabular-nums text-xs whitespace-nowrap",
      render: (p) => (p.total_investment ? formatINR(Number(p.total_investment)) : "—"),
    },
    {
      key: "corpus", colKey: "corpus", header: "Projected corpus", thClass: "text-right py-2 font-medium pr-6", tdClass: "py-3 pr-6 text-right tabular-nums text-xs text-emerald-700 font-medium whitespace-nowrap",
      render: (p) => (p.expected_corpus ? formatINR(Number(p.expected_corpus)) : "—"),
    },
    {
      key: "status", colKey: "status", header: "Status", thClass: "text-left py-2 font-medium pl-3", tdClass: "py-3 pl-3",
      render: (p) => {
        if (isExpired(p)) {
          const was = p.status === "expired" ? null : STATUS[p.status]?.label.toLowerCase();
          return (
            // Stacked, not side by side: a row wide enough for both overflowed the table at 1440px.
            <span className="inline-flex flex-col items-start gap-0.5 whitespace-nowrap">
              <span title={was ? `Past its valid-till date; still ${was}` : "Past its valid-till date"}>
                <Badge raw tone="danger">Expired</Badge>
              </span>
              {canRenew && (
                <button
                  type="button"
                  onClick={() => renew(p)}
                  disabled={renewing === p.id}
                  className="inline-flex min-h-6 items-center gap-1 rounded text-xs font-medium text-primary hover:underline disabled:opacity-50"
                >
                  <RotateCcw className="size-3.5" aria-hidden /> Renew
                </button>
              )}
            </span>
          );
        }
        const s = STATUS[p.status];
        return <Badge raw tone={s?.tone ?? "neutral"}>{s?.label ?? String(p.status)}</Badge>;
      },
    },
    {
      key: "valid_till", colKey: "valid_till", header: "Valid till", tdClass: "py-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap",
      // Relative to now, so the server's and the browser's render can straddle
      // an hour ("in 5h" / "in 4h"); the text is meant to differ, not the markup.
      render: (p) => (
        <span suppressHydrationWarning title={p.valid_until ? `Valid till ${formatDate(p.valid_date ?? p.valid_until)}` : undefined}>{validTill(p)}</span>
      ),
    },
    { key: "prepared_by", colKey: "prepared_by", header: "Prepared by", tdClass: "py-3 text-xs whitespace-nowrap", render: (p) => p.prepared_by ?? "—" },
    {
      key: "created", colKey: "created", header: "Created", tdClass: "py-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap",
      render: (p) => formatDate(p.created_at),
    },
    {
      key: "actions", colKey: "actions", header: "", thClass: "px-4 py-2", tdClass: "px-4 py-3 text-right",
      render: (p) => (
        <RowActions inline deleteIcon={Ban} editHref={`/dashboard/proposals/${p.id}`} deleteUrl={`/api/proposals/${p.id}`} itemLabel="proposal" itemName={p.proposal_number} verb="Cancel" />
      ),
    },
  ];

  return (
    <>
      <BulkTable
        rows={rows}
        columns={columns}
        endpoint="/api/proposals/bulk"
        actions={actions}
        itemLabel="proposal"
        tableKey="proposals"
        scrollBody
        onRowClick={(p) => setPreview(p)}
      />
      {preview && (
        <PdfModal
          title={`Proposal · ${preview.recipient_name ?? preview.proposal_number}`}
          pdfUrl={`/api/proposals/${preview.id}/pdf`}
          downloadUrl={`/api/proposals/${preview.id}/pdf?download=1`}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}
