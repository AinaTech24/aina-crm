import { redirect } from "next/navigation";
import { SheetImport } from "@/components/imports/SheetImport";
import { allowedText } from "@/lib/imports/sheet/spec";
import { visitorsSpec } from "@/lib/imports/sheet/specs/visitors";
import { requireVisitorPage } from "@/lib/visitors/page";

export const dynamic = "force-dynamic";

/** Import visits from Excel or CSV. The API refuses anyone who may not add a visit; this page sends them back. */
export default async function ImportVisitorsPage() {
  const { canEdit } = await requireVisitorPage();
  if (!canEdit) redirect("/dashboard/visitors");
  return (
    <SheetImport
      label="Visitors"
      singular="visit"
      backHref="/dashboard/visitors"
      importUrl="/api/visitors/import"
      sampleUrl="/api/visitors/import/sample"
      sampleCsvUrl="/api/visitors/import/sample?format=csv"
      maxRows={visitorsSpec.maxRows}
      columns={visitorsSpec.columns.map((c) => ({ header: c.required ? `${c.header} *` : c.header, required: !!c.required, help: c.help, allowed: allowedText(c) }))}
      notes={visitorsSpec.notes}
    />
  );
}
