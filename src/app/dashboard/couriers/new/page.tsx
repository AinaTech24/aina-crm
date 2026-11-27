import { redirect } from "next/navigation";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { CourierForm, type CourierFormValues } from "@/components/couriers/CourierForm";
import { COURIER_LABELS, DEFAULT_STATUS, type CourierField, type CourierType } from "@/lib/couriers/entry";
import { requireCourierPage } from "@/lib/couriers/page";
import { indiaToday } from "@/lib/fixed-deposits/terms";

export const dynamic = "force-dynamic";

/** `?type=outward` opens the form for an outward courier. */
export default async function NewCourierPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { canEdit } = await requireCourierPage();
  if (!canEdit) redirect("/dashboard/couriers");
  const type: CourierType = (await searchParams).type === "outward" ? "outward" : "inward";
  const blank = Object.fromEntries((Object.keys(COURIER_LABELS) as CourierField[]).map((k) => [k, ""])) as CourierFormValues;

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeaderCard
        title="Add courier"
        breadcrumb={[{ label: "Couriers", href: "/dashboard/couriers" }, { label: "Add courier" }]}
      />
      <CourierForm
        cancelHref="/dashboard/couriers"
        initial={{ ...blank, courierType: type, courierDate: indiaToday(), status: DEFAULT_STATUS[type] }}
      />
    </div>
  );
}
