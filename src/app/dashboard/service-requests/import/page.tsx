import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { SheetImport } from "@/components/imports/SheetImport";
import { allowedText } from "@/lib/imports/sheet/spec";
import { serviceRequestsSpec } from "@/lib/imports/sheet/specs/service-requests";

export const dynamic = "force-dynamic";

/** Import service requests from Excel. The API refuses anyone without the capability; this page just sends them back. */
export default async function ImportServiceRequestsPage() {
  const session = await requireSession();
  if (!can(session.roles, "service_request.manage", session.permissions)) redirect("/dashboard/service-requests");
  return (
    <SheetImport
      label="Service requests"
      singular="service request"
      backHref="/dashboard/service-requests"
      importUrl="/api/service-requests/import"
      sampleUrl="/api/service-requests/import/sample"
      maxRows={serviceRequestsSpec.maxRows}
      columns={serviceRequestsSpec.columns.map((c) => ({ header: c.required ? `${c.header} *` : c.header, required: !!c.required, help: c.help, allowed: allowedText(c) }))}
      notes={serviceRequestsSpec.notes}
    />
  );
}
