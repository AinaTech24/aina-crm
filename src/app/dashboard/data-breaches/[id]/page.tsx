import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { ShieldAlert } from "lucide-react";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { EmptyState } from "@/components/common/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { withTenant } from "@/db/client";
import { dataBreaches, tenants } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { boardReport, hoursLeft, personNotice } from "@/lib/privacy/breaches-core";
import { privacyContact } from "@/lib/privacy/notice";
import { BreachWorkspace } from "./BreachWorkspace";

export const dynamic = "force-dynamic";

/** One breach: the facts, the three things Rule 7 requires, and the texts to send. */
export default async function DataBreachPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!can(session.roles, "compliance.view", session.permissions)) {
    return (
      <div className="mt-6">
        <EmptyState icon={ShieldAlert} title="The breach register is kept by the compliance officer" description="Ask the firm owner if you need access." primary={{ href: "/dashboard", label: "Back to dashboard" }} />
      </div>
    );
  }
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await withTenant(session.tenantId, async (tx) => {
    const [b] = await tx.select().from(dataBreaches).where(and(eq(dataBreaches.tenantId, session.tenantId), eq(dataBreaches.id, id)));
    if (!b) return null;
    const [t] = await tx
      .select({ name: tenants.displayName, dpo: tenants.dataProtectionOfficer, email: tenants.email, phone: tenants.phone })
      .from(tenants)
      .where(eq(tenants.id, session.tenantId));
    return { b, t };
  });
  if (!data) notFound();
  const { b, t } = data;
  const c = privacyContact(t?.dpo, { email: t?.email, phone: t?.phone });
  const firm = { name: t?.name ?? "", contact: [c.name, c.email, c.phone].filter(Boolean).join(", ") || null };
  const h = hoursLeft(b.reportDueAt);

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeaderCard
        title={`Breach ${b.reference}`}
        breadcrumb={[{ label: "Data breaches", href: "/dashboard/data-breaches" }, { label: b.reference }]}
        actions={
          b.status === "closed" ? (
            <Badge tone="neutral">Closed</Badge>
          ) : b.boardReportAt ? (
            <Badge tone="success">Board report sent</Badge>
          ) : (
            <Badge tone={h < 0 ? "danger" : "warning"}>{h < 0 ? `Board report ${-h}h late` : `Board report due in ${h}h`}</Badge>
          )
        }
      />
      <BreachWorkspace
        canEdit={can(session.roles, "compliance.edit", session.permissions) && b.status === "open"}
        breach={{
          id: b.id,
          title: b.title,
          description: b.description ?? "",
          dataAffected: b.dataAffected ?? "",
          cause: b.cause ?? "",
          consequences: b.consequences ?? "",
          mitigation: b.mitigation ?? "",
          personSteps: b.personSteps ?? "",
          affectedCount: b.affectedCount,
          detectedAt: b.detectedAt.toISOString(),
          reportDueAt: b.reportDueAt.toISOString(),
          boardIntimatedAt: b.boardIntimatedAt?.toISOString() ?? null,
          boardReportAt: b.boardReportAt?.toISOString() ?? null,
          peopleNotifiedAt: b.peopleNotifiedAt?.toISOString() ?? null,
          peopleNotifiedCount: b.peopleNotifiedCount,
        }}
        personText={personNotice(b, firm)}
        boardText={boardReport(b, firm)}
      />
    </div>
  );
}
