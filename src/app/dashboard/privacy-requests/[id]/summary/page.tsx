import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { ShieldCheck } from "lucide-react";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { EmptyState } from "@/components/common/EmptyState";
import { withTenant } from "@/db/client";
import { privacyRequests, tenants } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { formatDate } from "@/lib/format";
import { AI_RECIPIENT, STANDARD_RECIPIENTS, readPrivacyNotice } from "@/lib/privacy/notice";
import { loadDataSummary } from "@/lib/privacy/summary";
import { recordAudit } from "@/lib/audit";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";

/**
 * The summary of personal data a person may ask for (DPDP Act s.11): what the
 * firm holds, the records behind it, their consents and who it is shared with.
 * Laid out to print or save as a PDF; opening it is audited, because it puts
 * one person's data on one page.
 */
export default async function PrivacyDataSummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!can(session.roles, "compliance.view", session.permissions)) {
    return (
      <div className="mt-6">
        <EmptyState icon={ShieldCheck} title="Privacy requests are handled by the compliance officer" description="Ask the firm owner if you need access." primary={{ href: "/dashboard", label: "Back to dashboard" }} />
      </div>
    );
  }
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const data = await withTenant(session.tenantId, async (tx) => {
    const [r] = await tx.select().from(privacyRequests).where(and(eq(privacyRequests.tenantId, session.tenantId), eq(privacyRequests.id, id)));
    if (!r || !r.subjectType || !r.subjectId) return null;
    const [t] = await tx.select({ name: tenants.displayName, notice: tenants.privacyNotice }).from(tenants).where(eq(tenants.id, session.tenantId));
    const summary = await loadDataSummary(tx, session.tenantId, { type: r.subjectType as "investor" | "lead", id: r.subjectId });
    await recordAudit(tx, {
      tenantId: session.tenantId, actorUserId: session.userId, action: "privacy.summary_viewed",
      entityType: "privacy_request", entityId: id,
    });
    return { r, firm: t?.name ?? "", notice: readPrivacyNotice(t?.notice), summary };
  });
  if (!data) notFound();
  const { r, firm, notice, summary } = data;
  const shared = [...STANDARD_RECIPIENTS, ...(notice.mentionsAi ? [AI_RECIPIENT] : []), ...notice.extraRecipients];

  return (
    <div className="max-w-3xl space-y-6">
      <div className="print:hidden">
        <PageHeaderCard
          title="Data summary"
          breadcrumb={[
            { label: "Privacy requests", href: "/dashboard/privacy-requests" },
            { label: r.reference, href: `/dashboard/privacy-requests/${r.id}` },
            { label: "Data summary" },
          ]}
          actions={<PrintButton />}
        />
      </div>

      {!summary ? (
        <EmptyState icon={ShieldCheck} title="This record no longer exists" description="It may have been erased or merged into another record." />
      ) : (
        <article className="card-surface rounded-xl border p-6 sm:p-8 space-y-6 print:border-0 print:p-0">
          <header className="space-y-1">
            <h2 className="text-xl font-bold">Your personal data held by {firm}</h2>
            <p className="text-sm text-muted-foreground">
              Prepared for {summary.name} on {formatDate(new Date())} · request {r.reference}
            </p>
          </header>
          {summary.sections.map((s) => (
            <section key={s.heading} className="space-y-2">
              <h3 className="text-base font-semibold">{s.heading}</h3>
              {s.rows.length ? (
                <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[12rem_1fr]">
                  {s.rows.map((row, n) => (
                    <div key={`${row.label}-${n}`} className="contents">
                      <dt className="text-muted-foreground">{row.label}</dt>
                      <dd className="break-words">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground">{s.note ?? "Nothing recorded."}</p>
              )}
            </section>
          ))}
          <section className="space-y-2">
            <h3 className="text-base font-semibold">Who we share it with</h3>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {shared.map((x) => <li key={x}>{x}</li>)}
            </ul>
          </section>
          <p className="text-xs text-muted-foreground">
            Your PAN and bank account numbers are shown in part for your security. To correct anything, or for the full details, reply to this email.
          </p>
        </article>
      )}
    </div>
  );
}
