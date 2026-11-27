import { notFound, redirect } from "next/navigation";
import { withTenant } from "@/db/client";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { VisitorForm } from "@/components/visitors/VisitorForm";
import { requireVisitorPage } from "@/lib/visitors/page";
import { getVisitor, listMeetingUsers } from "@/lib/visitors/service";

export const dynamic = "force-dynamic";

export default async function EditVisitorPage({ params }: { params: Promise<{ id: string }> }) {
  const { session, canEdit, context } = await requireVisitorPage();
  const { id } = await params;
  if (!canEdit) redirect("/dashboard/visitors");
  const data = await withTenant(session.tenantId, async (tx) => {
    const visit = await getVisitor(tx, session.tenantId, id);
    return visit ? { visit, users: await listMeetingUsers(tx, session.tenantId) } : null;
  }, context);
  if (!data) notFound();
  const { visit } = data;
  // A colleague who has since left stays selectable on the visit that names them.
  const users = visit.meetingWithUserId && !data.users.some((u) => u.id === visit.meetingWithUserId)
    ? [...data.users, { id: visit.meetingWithUserId, name: `${visit.meetingWithName ?? "Former team member"} (no longer active)` }]
    : data.users;
  const back = `/dashboard/visitors/${visit.id}`;

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeaderCard
        title="Edit visit"
        breadcrumb={[{ label: "Visitor Register", href: "/dashboard/visitors" }, { label: visit.visitorName, href: back }, { label: "Edit" }]}
      />
      <VisitorForm
        id={visit.id}
        users={users}
        cancelHref={back}
        initial={{
          visitorName: visit.visitorName,
          email: visit.email ?? "",
          mobile: visit.mobile ?? "",
          companyName: visit.companyName ?? "",
          visitDate: visit.visitDate,
          entryTime: visit.entryTime ?? "",
          exitTime: visit.exitTime ?? "",
          purpose: visit.purpose ?? "",
          meetingWithUserId: visit.meetingWithUserId ?? "",
          remarks: visit.remarks ?? "",
        }}
      />
    </div>
  );
}
