import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { ShieldAlert } from "lucide-react";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { EmptyState } from "@/components/common/EmptyState";
import { buttonClass } from "@/components/ui/button-class";
import { withTenant } from "@/db/client";
import { dataBreaches } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { BreachesTable, type BreachRow } from "./BreachesTable";

export const dynamic = "force-dynamic";

/** Compliance → Data breaches: the DPDP breach register (lib/privacy/breaches.ts). */
export default async function DataBreachesPage() {
  const session = await requireSession();
  if (!can(session.roles, "compliance.view", session.permissions)) {
    return (
      <div className="mt-6">
        <EmptyState icon={ShieldAlert} title="The breach register is kept by the compliance officer" description="Report a suspected breach to your compliance officer or the firm owner at once." primary={{ href: "/dashboard", label: "Back to dashboard" }} />
      </div>
    );
  }
  const rows = await withTenant(session.tenantId, (tx) =>
    tx
      .select({
        id: dataBreaches.id,
        reference: dataBreaches.reference,
        title: dataBreaches.title,
        detectedAt: dataBreaches.detectedAt,
        reportDueAt: dataBreaches.reportDueAt,
        boardReportAt: dataBreaches.boardReportAt,
        peopleNotifiedAt: dataBreaches.peopleNotifiedAt,
        status: dataBreaches.status,
      })
      .from(dataBreaches)
      .where(and(eq(dataBreaches.tenantId, session.tenantId)))
      .orderBy(desc(dataBreaches.detectedAt))
      .limit(500)
  );
  const data: BreachRow[] = rows.map((r) => ({
    ...r,
    detectedAt: r.detectedAt.toISOString(),
    reportDueAt: r.reportDueAt.toISOString(),
    boardReportAt: r.boardReportAt?.toISOString() ?? null,
    peopleNotifiedAt: r.peopleNotifiedAt?.toISOString() ?? null,
  }));
  return (
    <div className="space-y-5">
      <PageHeaderCard
        title="Data breaches"
        actions={
          can(session.roles, "compliance.edit", session.permissions) ? (
            <Link href="/dashboard/data-breaches/new" className={buttonClass("primary")}>Log a breach</Link>
          ) : undefined
        }
      />
      <BreachesTable rows={data} />
    </div>
  );
}
