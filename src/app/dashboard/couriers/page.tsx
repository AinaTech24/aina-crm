/** Couriers — what came in and what went out, with search and filters. */

import Link from "next/link";
import { Plus, Truck, Upload } from "lucide-react";
import { withTenant } from "@/db/client";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { EmptyState, InlineEmpty } from "@/components/common/EmptyState";
import { Pager } from "@/components/common/Pager";
import { ExportButton } from "@/components/export/ExportButton";
import { CouriersTable } from "@/components/couriers/CouriersTable";
import { Card } from "@/components/ui/Card";
import { buttonClass } from "@/components/ui/button-class";
import {
  ALL_COURIER_STATUSES, COURIER_CATEGORIES, COURIER_LABELS, COURIER_PAGE_SIZE, COURIER_TYPES, parseCourierFilter,
} from "@/lib/couriers/entry";
import { requireCourierPage } from "@/lib/couriers/page";
import { listCouriers } from "@/lib/couriers/service";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

export default async function CouriersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { session, canEdit, context } = await requireCourierPage();
  const filter = parseCourierFilter(await searchParams);
  const { rows, total, page, totalPages, hasAny } = await withTenant(session.tenantId,
    (tx) => listCouriers(tx, session.tenantId, filter), context);

  return (
    <div className="space-y-4">
      <PageHeaderCard
        title="Couriers"
        actions={<>
          {/* Draws itself only for someone allowed to export ("Export data"). */}
          <ExportButton module="couriers" />
          {canEdit && (
            <>
              <Link href="/dashboard/couriers/import" className={buttonClass("secondary")}>
                <Upload className="size-4" aria-hidden /> Import
              </Link>
              <Link href="/dashboard/couriers/new" className={buttonClass("primary")}>
                <Plus className="size-4" aria-hidden /> Add courier
              </Link>
            </>
          )}
        </>}
      />

      {!hasAny ? (
        <EmptyState
          icon={Truck}
          title="No couriers recorded yet"
          description="Track what comes in and what goes out: the courier company and tracking number, the sender or recipient, the dates, the documents and the delivery status."
          primary={canEdit ? { label: "Add the first courier", href: "/dashboard/couriers/new" } : undefined}
          secondary={canEdit ? { label: "Import from Excel or CSV", href: "/dashboard/couriers/import" } : undefined}
        />
      ) : (
        <>
          <CompactFilterBar
            totalCount={total}
            filters={[
              { type: "search", key: "q", placeholder: "Tracking no., company, sender, recipient…" },
              { type: "select", key: "type", label: COURIER_LABELS.courierType, options: COURIER_TYPES },
              { type: "multi", key: "status", label: COURIER_LABELS.status, options: ALL_COURIER_STATUSES },
              { type: "multi", key: "category", label: COURIER_LABELS.category, options: COURIER_CATEGORIES },
              { type: "date_range", key: "courier", label: COURIER_LABELS.courierDate },
              { type: "text", key: "company", label: COURIER_LABELS.courierCompany },
            ]}
          />
          <Card className="space-y-4 p-4 sm:p-5">
            <CouriersTable rows={rows} canEdit={canEdit} empty={<InlineEmpty message="No courier matches these filters." />} />
            <Pager page={page} totalPages={totalPages} total={total} pageSize={COURIER_PAGE_SIZE} />
          </Card>
        </>
      )}
    </div>
  );
}
