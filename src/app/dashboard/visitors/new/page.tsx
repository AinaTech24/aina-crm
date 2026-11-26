import { redirect } from "next/navigation";
import { withTenant } from "@/db/client";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { VisitorForm } from "@/components/visitors/VisitorForm";
import { indiaToday } from "@/lib/fixed-deposits/terms";
import { requireVisitorPage } from "@/lib/visitors/page";
import { listMeetingUsers } from "@/lib/visitors/service";

export const dynamic = "force-dynamic";

export default async function NewVisitorPage() {
  const { session, canEdit, context } = await requireVisitorPage();
  if (!canEdit) redirect("/dashboard/visitors");
  const users = await withTenant(session.tenantId, (tx) => listMeetingUsers(tx, session.tenantId), context);

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeaderCard
        title="Add visitor"
        breadcrumb={[{ label: "Visitor Register", href: "/dashboard/visitors" }, { label: "Add visitor" }]}
      />
      <VisitorForm
        users={users}
        cancelHref="/dashboard/visitors"
        initial={{
          visitorName: "", email: "", mobile: "", companyName: "", visitDate: indiaToday(),
          entryTime: "", exitTime: "", purpose: "", meetingWithUserId: "", remarks: "",
        }}
      />
    </div>
  );
}
