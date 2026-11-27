import { notFound, redirect } from "next/navigation";
import { withTenant } from "@/db/client";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { CourierForm, type CourierFormValues } from "@/components/couriers/CourierForm";
import { COURIER_LABELS, type CourierField } from "@/lib/couriers/entry";
import { requireCourierPage } from "@/lib/couriers/page";
import { getCourier } from "@/lib/couriers/service";

export const dynamic = "force-dynamic";

export default async function EditCourierPage({ params }: { params: Promise<{ id: string }> }) {
  const { session, canEdit, context } = await requireCourierPage();
  const { id } = await params;
  if (!canEdit) redirect("/dashboard/couriers");
  const courier = await withTenant(session.tenantId, (tx) => getCourier(tx, session.tenantId, id), context);
  if (!courier) notFound();

  const initial = Object.fromEntries(
    (Object.keys(COURIER_LABELS) as CourierField[]).map((k) => [k, courier[k] ?? ""]),
  ) as CourierFormValues;
  const name = courier.trackingNumber || courier.courierCompany || "Courier";
  const back = `/dashboard/couriers/${courier.id}`;

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeaderCard
        title="Edit courier"
        breadcrumb={[{ label: "Couriers", href: "/dashboard/couriers" }, { label: name, href: back }, { label: "Edit" }]}
      />
      <CourierForm id={courier.id} cancelHref={back} initial={initial} />
    </div>
  );
}
