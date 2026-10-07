import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { ChevronLeft, LifeBuoy } from "lucide-react";
import { withTenant } from "@/db/client";
import { serviceRequests, investors, users } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { ServiceRequestDetailEditor } from "@/components/service-requests/ServiceRequestDetailEditor";
import { RecordProvenance } from "@/components/common/RecordProvenance";
import { canSeeServiceRequest } from "@/lib/service-requests/access";
import { clientScopeNarrows, loadViewableInvestor } from "@/lib/investors/access";
import { can } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  nominee_update: "Nominee Update", bank_update: "Bank Update", mobile_update: "Mobile Update",
  email_update: "Email Update", kyc_update: "KYC Update", minor_to_major: "Minor to Major",
  capital_gain_report: "Capital Gain Report", statement_request: "Statement Request",
  redemption_request: "Redemption Request", switch_request: "Switch Request",
  transmission_case: "Transmission Case", folio_correction: "Folio Correction", other: "Other",
  complaint: "Complaint", redemption_help: "Redemption Request", switch_help: "Switch Request",
  transaction_query: "Other",
};

const STATUS_TONE: Record<string, string> = {
  open: "bg-blue-50 text-blue-700", in_progress: "bg-amber-50 text-amber-700",
  waiting_customer: "bg-secondary text-foreground", resolved: "bg-emerald-50 text-emerald-700",
  closed: "bg-secondary text-foreground", escalated: "bg-rose-50 text-rose-700",
};

export default async function ServiceRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const data = await withTenant(session.tenantId, async (tx) => {
    if (!(await canSeeServiceRequest(tx, session, id))) return null;
    const sr = (await tx.select().from(serviceRequests).where(and(eq(serviceRequests.id, id), eq(serviceRequests.tenantId, session.tenantId))).limit(1))[0];
    if (!sr) return null;
    // Under the data wall the client shows only when the viewer may see that
    // client; a ticket assigned to them about someone else's client stays
    // anonymous. Without the wall the ticket names its client, as before.
    const mayViewClients = can(session.roles, "investor.view.all", session.permissions)
      || can(session.roles, "investor.view.assigned", session.permissions);
    const inv = !sr.investorId
      ? null
      : !(await clientScopeNarrows(tx, session))
        ? (await tx.select().from(investors).where(eq(investors.id, sr.investorId)).limit(1))[0] ?? null
        : mayViewClients
          ? await loadViewableInvestor(tx, session, sr.investorId)
          : null;
    // userId → name map for the activity timeline + assignee display.
    const us = await tx.execute(sql`SELECT id, name FROM users WHERE tenant_id = ${session.tenantId}::uuid`);
    const userMap: Record<string, string> = {};
    for (const u of us.rows as Array<{ id: string; name: string }>) userMap[u.id] = u.name;
    return { sr, investor: inv, userMap };
  });
  if (!data) notFound();
  const { sr, investor, userMap } = data;

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <Link href="/dashboard/service-requests" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to service requests
      </Link>

      <div className="card-surface p-6 flex items-start gap-4">
        <div className="size-12 rounded-lg bg-brand-cyan-light grid place-items-center">
          <LifeBuoy className="size-6 text-muted-foreground" />
        </div>
        <PageHeaderCard
      title={<>{TYPE_LABEL[sr.type] ?? sr.type}</>}
      actions={<span className={`chip capitalize ${STATUS_TONE[sr.status] ?? ""}`}>{sr.status.replace(/_/g, " ")}</span>}
    >
      <div className="text-sm text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
            <span className="font-mono">{sr.ticketNo}</span>
            <span>·</span>
            {investor ? (
              <Link href={`/dashboard/investors/${investor.id}`} className="hover:underline">{investor.name}</Link>
            ) : (
              <span>{sr.investorId ? "Client not in your book" : "No client linked"}</span>
            )}
            {sr.channel && <><span>·</span><span className="capitalize">{sr.channel.replace(/_/g, " ")}</span></>}
          </div>
          {sr.subject && <p className="mt-2 font-medium">{sr.subject}</p>}
          {sr.description && <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">{sr.description}</p>}
          <RecordProvenance
            entityType="service_request"
            entityId={sr.id}
            createdAt={sr.createdAt}
            updatedAt={sr.updatedAt}
            className="mt-2"
          />
    </PageHeaderCard>
      </div>

      <ServiceRequestDetailEditor sr={JSON.parse(JSON.stringify(sr))} userMap={userMap} />
    </div>
  );
}
