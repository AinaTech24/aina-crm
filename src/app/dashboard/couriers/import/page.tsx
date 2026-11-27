import { redirect } from "next/navigation";
import { SheetImport } from "@/components/imports/SheetImport";
import { allowedText } from "@/lib/imports/sheet/spec";
import { couriersSpec } from "@/lib/imports/sheet/specs/couriers";
import { requireCourierPage } from "@/lib/couriers/page";

export const dynamic = "force-dynamic";

/** Import couriers from Excel or CSV. The API refuses anyone who may not add one; this page sends them back. */
export default async function ImportCouriersPage() {
  const { canEdit } = await requireCourierPage();
  if (!canEdit) redirect("/dashboard/couriers");
  return (
    <SheetImport
      label="Couriers"
      singular="courier"
      backHref="/dashboard/couriers"
      importUrl="/api/couriers/import"
      sampleUrl="/api/couriers/import/sample"
      sampleCsvUrl="/api/couriers/import/sample?format=csv"
      maxRows={couriersSpec.maxRows}
      columns={couriersSpec.columns.map((c) => ({ header: c.required ? `${c.header} *` : c.header, required: !!c.required, help: c.help, allowed: allowedText(c) }))}
      notes={couriersSpec.notes}
    />
  );
}
