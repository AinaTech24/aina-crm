import Link from "next/link";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { ShieldCheck } from "lucide-react";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { EmptyState } from "@/components/common/EmptyState";
import { buttonClass } from "@/components/ui/button-class";
import { withTenant } from "@/db/client";
import { privacyRequests } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { PrivacyRequestsTable, type RequestRow } from "./PrivacyRequestsTable";

export const dynamic = "force-dynamic";

/**
 * Compliance → Privacy requests: the DPDP rights-request register
 * (lib/privacy/requests.ts). Open requests first, the nearest deadline on top.
 */
export default async function PrivacyRequestsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const session = await requireSession();
  if (!can(session.roles, "compliance.view", session.permissions)) {
    return (
      <div className="mt-6">
        <EmptyState
          icon={ShieldCheck}
          title="Privacy requests are handled by the compliance officer"
          description="Ask the firm owner if you need access."
          primary={{ href: "/dashboard", label: "Back to dashboard" }}
        />
      </div>
    );
  }
  const sp = await searchParams;
  const closed = sp.status === "closed";
  const rows = await withTenant(session.tenantId, (tx) =>
    tx
      .select({
        id: privacyRequests.id,
        reference: privacyRequests.reference,
        requesterName: privacyRequests.requesterName,
        type: privacyRequests.type,
        status: privacyRequests.status,
        receivedAt: privacyRequests.receivedAt,
        dueAt: privacyRequests.dueAt,
        closedAt: privacyRequests.closedAt,
      })
      .from(privacyRequests)
      .where(and(eq(privacyRequests.tenantId, session.tenantId), closed ? ne(privacyRequests.status, "open") : eq(privacyRequests.status, "open")))
      .orderBy(closed ? desc(privacyRequests.closedAt) : asc(privacyRequests.dueAt))
      .limit(500)
  );
  const data: RequestRow[] = rows.map((r) => ({
    ...r,
    receivedAt: r.receivedAt.toISOString(),
    dueAt: r.dueAt.toISOString(),
    closedAt: r.closedAt?.toISOString() ?? null,
  }));
  const canEdit = can(session.roles, "compliance.edit", session.permissions);

  return (
    <div className="space-y-5">
      <PageHeaderCard
        title="Privacy requests"
        actions={canEdit ? <Link href="/dashboard/privacy-requests/new" className={buttonClass("primary")}>New request</Link> : undefined}
      />
      <nav className="inline-flex rounded-lg border border-border bg-card p-0.5 gap-0.5" aria-label="Requests">
        {[
          { href: "/dashboard/privacy-requests", label: "Open", on: !closed },
          { href: "/dashboard/privacy-requests?status=closed", label: "Closed", on: closed },
        ].map((t) => (
          <Link
            key={t.label}
            href={t.href}
            aria-current={t.on ? "page" : undefined}
            className={`px-3 py-1.5 rounded-md text-sm font-medium ${t.on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <PrivacyRequestsTable rows={data} closed={closed} />
    </div>
  );
}
