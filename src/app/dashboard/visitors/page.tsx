/** Visitor Register — who visited the office, with search and filters. */

import Link from "next/link";
import { DoorOpen, Plus, Upload } from "lucide-react";
import { withTenant } from "@/db/client";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { EmptyState, InlineEmpty } from "@/components/common/EmptyState";
import { Pager } from "@/components/common/Pager";
import { ExportButton } from "@/components/export/ExportButton";
import { Card } from "@/components/ui/Card";
import { buttonClass } from "@/components/ui/button-class";
import { VisitorsTable } from "@/components/visitors/VisitorsTable";
import { VISITOR_LABELS, VISITOR_PAGE_SIZE, parseVisitorFilter } from "@/lib/visitors/entry";
import { requireVisitorPage } from "@/lib/visitors/page";
import { listMeetingFilterUsers, listVisitors } from "@/lib/visitors/service";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

export default async function VisitorsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { session, canEdit, context } = await requireVisitorPage();
  const filter = parseVisitorFilter(await searchParams);
  const { rows, total, page, totalPages, hasAny, team } = await withTenant(session.tenantId, async (tx) => ({
    ...(await listVisitors(tx, session.tenantId, filter)),
    team: await listMeetingFilterUsers(tx, session.tenantId),
  }), context);

  return (
    <div className="space-y-4">
      <PageHeaderCard
        title="Visitor Register"
        actions={<>
          {/* Draws itself only for someone allowed to export ("Export data"). */}
          <ExportButton module="visitors" />
          {canEdit && (
            <>
              <Link href="/dashboard/visitors/import" className={buttonClass("secondary")}>
                <Upload className="size-4" aria-hidden /> Import
              </Link>
              <Link href="/dashboard/visitors/new" className={buttonClass("primary")}>
                <Plus className="size-4" aria-hidden /> Add visitor
              </Link>
            </>
          )}
        </>}
      />

      {!hasAny ? (
        <EmptyState
          icon={DoorOpen}
          title="No visitors recorded yet"
          description="Record who visits the office: their contact details, when they came and left, why, and whom they met."
          primary={canEdit ? { label: "Add the first visitor", href: "/dashboard/visitors/new" } : undefined}
          secondary={canEdit ? { label: "Import from Excel or CSV", href: "/dashboard/visitors/import" } : undefined}
        />
      ) : (
        <>
          <CompactFilterBar
            totalCount={total}
            filters={[
              { type: "search", key: "q", placeholder: "Name, company, mobile, purpose…" },
              { type: "date_range", key: "visit", label: VISITOR_LABELS.visitDate },
              { type: "text", key: "purpose", label: VISITOR_LABELS.purpose },
              { type: "multi", key: "with", label: VISITOR_LABELS.meetingWithUserId, options: team.map((u) => ({ value: u.id, label: u.name })) },
            ]}
          />
          <Card className="space-y-4 p-4 sm:p-5">
            <VisitorsTable rows={rows} canEdit={canEdit} empty={<InlineEmpty message="No visit matches these filters." />} />
            <Pager page={page} totalPages={totalPages} total={total} pageSize={VISITOR_PAGE_SIZE} />
          </Card>
        </>
      )}
    </div>
  );
}
