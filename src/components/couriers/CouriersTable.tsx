"use client";

/** The Couriers list. A row opens the courier; its end holds Edit and Delete. */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { RowActions } from "@/components/common/RowActions";
import { Badge } from "@/components/ui/Badge";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { formatDate } from "@/lib/format";
import {
  COURIER_LABELS, COURIER_STATUSES, COURIER_TYPES, categoryText, formatCharges, optionLabel, statusTone,
} from "@/lib/couriers/entry";
import type { CourierRow } from "@/lib/couriers/service";

const day = (v: string | null) => (v ? <span className="whitespace-nowrap">{formatDate(v)}</span> : null);

export function CouriersTable({ rows, canEdit = false, empty }: { rows: CourierRow[]; canEdit?: boolean; empty?: React.ReactNode }) {
  const router = useRouter();
  const columns: Column<CourierRow>[] = [
    {
      key: "courier", header: "Courier",
      cell: (r) => (
        <div className="min-w-0">
          <Link href={`/dashboard/couriers/${r.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
            {r.courierCompany || "Courier"}
          </Link>
          {r.trackingNumber && <div className="text-xs text-muted-foreground tabular-nums break-all">{r.trackingNumber}</div>}
        </div>
      ),
    },
    {
      key: "type", header: "Type",
      cell: (r) => <Badge raw>{optionLabel(COURIER_TYPES, r.courierType)}</Badge>,
    },
    {
      key: "party", header: "Sender / Recipient", hideWhenEmpty: true,
      cell: (r) => {
        const name = r.courierType === "inward" ? r.senderName : r.recipientName;
        const company = r.courierType === "inward" ? r.senderCompany : r.recipientCompany;
        if (!name && !company) return null;
        return (
          <div className="min-w-0">
            <div>{name || company}</div>
            {name && company && <div className="text-xs text-muted-foreground">{company}</div>}
          </div>
        );
      },
    },
    { key: "date", header: COURIER_LABELS.courierDate, cell: (r) => day(r.courierDate) },
    { key: "category", header: "Category", hideOnMobile: true, hideWhenEmpty: true, cell: (r) => categoryText(r.category, r.categoryOther) },
    {
      key: "status", header: "Status",
      cell: (r) => <Badge raw tone={statusTone(r.status)}>{optionLabel(COURIER_STATUSES[r.courierType], r.status)}</Badge>,
    },
    { key: "moved", header: "Received / Dispatched", hideOnMobile: true, hideWhenEmpty: true, cell: (r) => day(r.courierType === "inward" ? r.receivedDate : r.dispatchDate) },
    { key: "delivered", header: "Delivered", hideOnMobile: true, hideWhenEmpty: true, cell: (r) => day(r.deliveredDate) },
    {
      key: "charges", header: "Charges", align: "right", hideOnMobile: true, hideWhenEmpty: true,
      cell: (r) => (r.courierCharges ? <span className="whitespace-nowrap tabular-nums">{formatCharges(r.courierCharges)}</span> : null),
    },
    ...(canEdit ? [{
      key: "actions", header: <span className="sr-only">Actions</span>, align: "right" as const, className: "relative",
      cell: (r: CourierRow) => (
        // A click on a button, or in its confirm box, must not also open the courier.
        <div onClick={(e) => e.stopPropagation()}>
          <RowActions
            inline
            editHref={`/dashboard/couriers/${r.id}/edit`}
            deleteUrl={`/api/couriers/${r.id}`}
            itemLabel="courier"
            itemName={r.trackingNumber || r.courierCompany || undefined}
            confirmNote="It is removed from the Couriers list."
          />
        </div>
      ),
    }] : []),
  ];
  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.id}
      onRowClick={(r) => router.push(`/dashboard/couriers/${r.id}`)}
      caption="Couriers"
      empty={empty}
    />
  );
}
