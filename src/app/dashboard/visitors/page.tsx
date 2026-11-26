/** Visitor Register — who visited the office, with search and a date filter. */

import Link from "next/link";
import { DoorOpen, Plus } from "lucide-react";
import { withTenant } from "@/db/client";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { EmptyState, InlineEmpty } from "@/components/common/EmptyState";
import { Pager } from "@/components/common/Pager";
import { Card } from "@/components/ui/Card";
import { DateField } from "@/components/ui/DateField";
import { buttonClass } from "@/components/ui/button-class";
import { VisitorsTable } from "@/components/visitors/VisitorsTable";
import { formatCount } from "@/lib/format";
import { VISITOR_PAGE_SIZE, parseVisitorFilter } from "@/lib/visitors/entry";
import { requireVisitorPage } from "@/lib/visitors/page";
import { listVisitors } from "@/lib/visitors/service";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

export default async function VisitorsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { session, canEdit, context } = await requireVisitorPage();
  const filter = parseVisitorFilter(await searchParams);
  const { rows, total, page, totalPages, hasAny } = await withTenant(
    session.tenantId, (tx) => listVisitors(tx, session.tenantId, filter), context,
  );
  const filtered = !!(filter.q || filter.from || filter.to);

  return (
    <div className="space-y-6">
      <PageHeaderCard
        title="Visitor Register"
        actions={canEdit && (
          <Link href="/dashboard/visitors/new" className={buttonClass("primary")}>
            <Plus className="size-4" aria-hidden /> Add visitor
          </Link>
        )}
      />

      {!hasAny ? (
        <EmptyState
          icon={DoorOpen}
          title="No visitors recorded yet"
          description="Record who visits the office: their contact details, when they came and left, why, and whom they met."
          primary={canEdit ? { label: "Add the first visitor", href: "/dashboard/visitors/new" } : undefined}
        />
      ) : (
        <Card className="space-y-4 p-4 sm:p-5">
          {/* Keyed by the filter so the date pickers follow it after Clear or Back. */}
          <form key={`${filter.q}|${filter.from}|${filter.to}`} action="/dashboard/visitors" className="flex flex-wrap items-center gap-2">
            <input name="q" defaultValue={filter.q} placeholder="Name, company, mobile, purpose…" aria-label="Search visitors" className="input-base h-9 w-full sm:w-72" />
            <DateField name="from" defaultValue={filter.from} placeholder="From date" aria-label="Visit date from" className="w-full sm:w-44" />
            <DateField name="to" defaultValue={filter.to} placeholder="To date" aria-label="Visit date to" className="w-full sm:w-44" />
            <button type="submit" className={buttonClass("secondary")}>Apply</button>
            {filtered && <Link href="/dashboard/visitors" className={buttonClass("ghost")}>Clear</Link>}
            <span className="ml-auto text-sm text-muted-foreground">{formatCount(total)} visit{total === 1 ? "" : "s"}</span>
          </form>
          <VisitorsTable rows={rows} empty={<InlineEmpty message="No visit matches these filters." />} />
          <Pager page={page} totalPages={totalPages} total={total} pageSize={VISITOR_PAGE_SIZE} />
        </Card>
      )}
    </div>
  );
}
