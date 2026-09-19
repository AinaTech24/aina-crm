import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { ArrowLeft, CalendarOff } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { holidays } from "@/db/schema";
import { HolidayManager, type HolidayRow } from "@/components/attendance/HolidayManager";

export const dynamic = "force-dynamic";

export default async function HolidaysPage() {
  const session = await requireSession();
  const canManage = session.roles.some((r) => ["owner", "branch_head"].includes(r));

  const rows = await withTenant(session.tenantId, async (tx) => {
    return tx
      .select({
        id: holidays.id,
        holidayDate: holidays.holidayDate,
        name: holidays.name,
        isOptional: holidays.isOptional,
      })
      .from(holidays)
      .where(and(eq(holidays.tenantId, session.tenantId)))
      .orderBy(asc(holidays.holidayDate));
  });

  const list: HolidayRow[] = rows.map((r) => ({
    id: r.id,
    holidayDate: r.holidayDate,
    name: r.name,
    isOptional: r.isOptional,
  }));

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="space-y-2">
        <Link
          href="/dashboard/attendance"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Back to Attendance
        </Link>
        <PageHeaderCard title={<><CalendarOff className="size-6 text-muted-foreground" /> Holiday Master</>} subtitle={<>Per-firm non-working days · attendance auto-marks these for every active employee.</>} />
      </div>

      <HolidayManager holidays={list} canManage={canManage} />
    </div>
  );
}
