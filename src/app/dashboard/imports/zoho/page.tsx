/**
 * Zoho CRM import — clients (Contacts export) then meetings (Meetings export).
 * Only for a firm with the "Zoho CRM import" flag; anyone else gets a 404.
 * Logic: lib/imports/zoho/*.
 */
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { mayImportZoho, zohoImportEnabled } from "@/lib/imports/zoho/access";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { ZohoImport } from "@/components/imports/zoho/ZohoImport";

export const dynamic = "force-dynamic";

export default async function ZohoImportPage() {
  const session = await requireSession();
  if (!(await zohoImportEnabled(session.tenantId, session.roles))) notFound();
  return (
    <div className="space-y-4 max-w-5xl">
      <PageHeaderCard
        title="Import from Zoho CRM"
        breadcrumb={[{ label: "Clients", href: "/dashboard/investors" }, { label: "Import", href: "/dashboard/investors/import" }, { label: "From Zoho CRM" }]}
      />
      <ZohoImport mayContacts={mayImportZoho(session, "contacts")} mayMeetings={mayImportZoho(session, "meetings")} />
    </div>
  );
}
