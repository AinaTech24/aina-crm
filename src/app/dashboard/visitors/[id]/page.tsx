import { notFound } from "next/navigation";
import { withTenant } from "@/db/client";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { Card } from "@/components/ui/Card";
import { VisitorActions } from "@/components/visitors/VisitorActions";
import { formatDate } from "@/lib/format";
import { VISITOR_LABELS, formatVisitTime } from "@/lib/visitors/entry";
import { requireVisitorPage } from "@/lib/visitors/page";
import { getVisitor } from "@/lib/visitors/service";

export const dynamic = "force-dynamic";

export default async function VisitorPage({ params }: { params: Promise<{ id: string }> }) {
  const { session, canEdit, context } = await requireVisitorPage();
  const { id } = await params;
  const visit = await withTenant(session.tenantId, (tx) => getVisitor(tx, session.tenantId, id), context);
  if (!visit) notFound();

  const fields: { label: string; value: string | null; wide?: boolean }[] = [
    { label: VISITOR_LABELS.visitorName, value: visit.visitorName },
    { label: VISITOR_LABELS.email, value: visit.email },
    { label: VISITOR_LABELS.mobile, value: visit.mobile },
    { label: VISITOR_LABELS.companyName, value: visit.companyName },
    { label: VISITOR_LABELS.visitDate, value: formatDate(visit.visitDate) },
    { label: VISITOR_LABELS.entryTime, value: formatVisitTime(visit.entryTime) },
    { label: VISITOR_LABELS.exitTime, value: formatVisitTime(visit.exitTime) },
    { label: VISITOR_LABELS.meetingWithUserId, value: visit.meetingWithName },
    { label: VISITOR_LABELS.purpose, value: visit.purpose, wide: true },
    { label: VISITOR_LABELS.remarks, value: visit.remarks, wide: true },
  ];

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeaderCard
        title={visit.visitorName}
        subtitle={`Visited on ${formatDate(visit.visitDate)}`}
        breadcrumb={[{ label: "Visitor Register", href: "/dashboard/visitors" }, { label: visit.visitorName }]}
        actions={canEdit && <VisitorActions id={visit.id} visitorName={visit.visitorName} />}
      />
      <Card className="p-5">
        <dl className="grid gap-4 sm:grid-cols-2">
          {fields.map((f) => (
            <div key={f.label} className={f.wide ? "sm:col-span-2" : undefined}>
              <dt className="text-xs text-muted-foreground">{f.label}</dt>
              <dd className="mt-0.5 whitespace-pre-line break-words text-sm font-medium">{f.value || "—"}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-5 border-t border-border pt-3 text-xs text-muted-foreground">
          Recorded{visit.createdByName ? ` by ${visit.createdByName}` : ""} on {formatDate(visit.createdAt, "dateTime")}
        </p>
      </Card>
    </div>
  );
}
