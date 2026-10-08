/**
 * /dashboard/support/feedback/website-form — the firm's public feedback link,
 * for its website and email signature.
 *
 * Reached from Client Feedback → "Feedback link". The link is made the first
 * time anyone opens this page; responses land on Client Feedback and count
 * towards the NPS (lib/feedback/web-form.ts).
 */

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { Globe } from "lucide-react";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { Card, CardHeader } from "@/components/ui/Card";
import { FeedbackFormLinkPanel } from "@/components/support/FeedbackFormLinkPanel";
import { withTenant } from "@/db/client";
import { tenants } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { ensureFeedbackFormLink } from "@/lib/feedback/web-form";
import { appBaseUrl } from "@/lib/share-tokens/sample";
import { formatCount, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function WebsiteFeedbackFormPage() {
  const session = await requireSession();
  const has = (cap: Parameters<typeof can>[1]) => can(session.roles, cap, session.permissions);
  if (!(has("communication.send") || has("compliance.view") || has("service_request.manage") || has("service_request.view.all"))) {
    redirect("/dashboard/support/feedback");
  }
  const canManage = has("compliance.view");

  // The link uses the host the firm is signed in on, so a firm on its own
  // domain gets a link on that domain.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  const origin = host ? `${proto}://${host}` : appBaseUrl();

  const { link, firmName, received } = await withTenant(session.tenantId, async (tx) => {
    const link = await ensureFeedbackFormLink(tx, session.tenantId);
    const [t] = await tx.select({ name: tenants.displayName }).from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
    const r = await tx.execute(sql`
      SELECT count(*)::int AS n, max(created_at) AS last
      FROM service_requests
      WHERE tenant_id = ${session.tenantId}::uuid AND type = 'feedback'
        AND timeline @> '[{"note": "Through the firm''s public feedback link."}]'::jsonb
    `);
    const row = r.rows[0] as { n: number; last: string | null } | undefined;
    return { link, firmName: t?.name ?? "us", received: { n: Number(row?.n ?? 0), last: row?.last ?? null } };
  });

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeaderCard
        title={<><Globe className="size-6 text-muted-foreground" /> Feedback link for your website &amp; email</>}
        breadcrumb={[{ label: "Client Feedback", href: "/dashboard/support/feedback" }, { label: "Feedback link" }]}
      />

      <FeedbackFormLinkPanel origin={origin} token={link.token} enabled={link.enabled} canManage={canManage} firmName={firmName} />

      <Card className="space-y-3 p-5">
        <CardHeader
          title="What happens to a response"
          action={
            <span className="text-sm text-muted-foreground">
              {received.n > 0 ? `${formatCount(received.n)} received · last ${formatDate(received.last)}` : "None received yet"}
            </span>
          }
        />
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>It appears on Client Feedback with its scores and comment, and counts towards your NPS.</li>
          <li>
            When the email or mobile given matches one of your clients, it is linked to that client and goes to their
            relationship manager. Otherwise it goes to the owner.
          </li>
          <li>A low score (6 or below) is marked high priority, and whoever it goes to is notified so they can follow up.</li>
          <li>Unlike the personal survey you send a client, this link can be used by anyone, any number of times.</li>
        </ul>
      </Card>
    </div>
  );
}
