import { notFound } from "next/navigation";
import { withTenant } from "@/db/client";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { CourierActions } from "@/components/couriers/CourierActions";
import { formatDate } from "@/lib/format";
import {
  COURIER_LABELS, COURIER_STATUSES, COURIER_TYPES, INWARD_FIELDS, OUTWARD_FIELDS, PAYMENT_MODES,
  categoryText, formatCharges, optionLabel, statusTone, type CourierField,
} from "@/lib/couriers/entry";
import { requireCourierPage } from "@/lib/couriers/page";
import { getCourier, type CourierRow } from "@/lib/couriers/service";

export const dynamic = "force-dynamic";

const DATES: CourierField[] = ["courierDate", "receivedDate", "dispatchDate", "deliveredDate"];
const WIDE: CourierField[] = ["description", "remarks", "senderAddress", "recipientAddress"];
const INFORMATION: CourierField[] = [
  "courierType", "courierDate", "courierCompany", "trackingNumber", "status", "category", "description", "remarks",
];

/** A field of the courier as it reads on the page. */
function shown(c: CourierRow, field: CourierField): string {
  if (field === "courierType") return optionLabel(COURIER_TYPES, c.courierType) ?? "—";
  if (field === "status") return optionLabel(COURIER_STATUSES[c.courierType], c.status) ?? "—";
  if (field === "category") return categoryText(c.category, c.categoryOther) ?? "—";
  if (field === "paymentMode") return optionLabel(PAYMENT_MODES, c.paymentMode) ?? "—";
  if (field === "courierCharges") return formatCharges(c.courierCharges);
  if (DATES.includes(field)) return c[field] ? formatDate(c[field]) : "—";
  return c[field] || "—";
}

function Details({ courier, title, fields }: { courier: CourierRow; title: string; fields: readonly CourierField[] }) {
  return (
    <Card>
      <CardHeader title={title} />
      <dl className="grid gap-4 px-5 pb-5 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f} className={WIDE.includes(f) ? "sm:col-span-2" : undefined}>
            <dt className="text-xs text-muted-foreground">{COURIER_LABELS[f]}</dt>
            <dd className="mt-0.5 whitespace-pre-line break-words text-sm font-medium">{shown(courier, f)}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

export default async function CourierPage({ params }: { params: Promise<{ id: string }> }) {
  const { session, canEdit, context } = await requireCourierPage();
  const { id } = await params;
  const courier = await withTenant(session.tenantId, (tx) => getCourier(tx, session.tenantId, id), context);
  if (!courier) notFound();

  const inward = courier.courierType === "inward";
  const title = [courier.courierCompany, courier.trackingNumber].filter(Boolean).join(" · ")
    || `${optionLabel(COURIER_TYPES, courier.courierType)} courier`;

  return (
    <div className="space-y-4 max-w-3xl">
      <PageHeaderCard
        title={title}
        subtitle={`${optionLabel(COURIER_TYPES, courier.courierType)} courier of ${formatDate(courier.courierDate)}`}
        breadcrumb={[{ label: "Couriers", href: "/dashboard/couriers" }, { label: title }]}
        actions={canEdit && <CourierActions id={courier.id} name={title} />}
      />
      <div>
        <Badge raw dot tone={statusTone(courier.status)}>{shown(courier, "status")}</Badge>
      </div>
      <Details courier={courier} title="Courier Information" fields={INFORMATION} />
      <Details courier={courier} title={inward ? "Sender Details" : "Recipient Details"} fields={inward ? INWARD_FIELDS : OUTWARD_FIELDS} />
      <p className="text-xs text-muted-foreground">
        Recorded{courier.createdByName ? ` by ${courier.createdByName}` : ""} on {formatDate(courier.createdAt, "dateTime")}
      </p>
    </div>
  );
}
