/**
 * /dashboard/complaints/website-form — the firm's public complaint link.
 *
 * Reached from Service Requests → ⋯ → "Complaint form for your website". The
 * link is made the first time anyone opens this page; complaints sent through
 * it arrive in Service Requests (lib/complaints/web-form.ts).
 */

import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { Globe } from "lucide-react";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { Card, CardHeader } from "@/components/ui/Card";
import { ComplaintFormLinkPanel } from "@/components/complaints/ComplaintFormLinkPanel";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { complaintHandler, ensureComplaintFormLink } from "@/lib/complaints/web-form";
import { appBaseUrl } from "@/lib/share-tokens/sample";
import { formatCount, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function WebsiteComplaintFormPage() {
  const session = await requireSession();
  const has = (cap: Parameters<typeof can>[1]) => can(session.roles, cap, session.permissions);
  if (!(has("service_request.view.all") || has("service_request.manage") || has("compliance.view"))) {
    redirect("/dashboard/service-requests");
  }
  const canManage = has("compliance.view");

  // The link the firm copies uses the host it is signed in on, so a firm on its
  // own domain gets a link on that domain.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  const origin = host ? `${proto}://${host}` : appBaseUrl();

  const { link, handler, received } = await withTenant(session.tenantId, async (tx) => {
    const link = await ensureComplaintFormLink(tx, session.tenantId);
    const handler = await complaintHandler(tx, session.tenantId);
    const r = await tx.execute(sql`
      SELECT count(*)::int AS n, max(created_at) AS last
      FROM service_requests
      WHERE tenant_id = ${session.tenantId}::uuid AND type = 'complaint' AND complaint_source = 'website'
    `);
    const row = r.rows[0] as { n: number; last: string | null } | undefined;
    return { link, handler, received: { n: Number(row?.n ?? 0), last: row?.last ?? null } };
  });

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeaderCard
        title={<><Globe className="size-6 text-muted-foreground" /> Complaint form for your website</>}
      />

      <ComplaintFormLinkPanel origin={origin} token={link.token} enabled={link.enabled} canManage={canManage} />

      <Card className="space-y-3 p-5">
        <CardHeader
          title="What happens to a complaint"
          action={
            received.n > 0 ? (
              <Link href="/dashboard/complaints?source=website" className="text-sm text-primary hover:underline">
                {formatCount(received.n)} received · last {formatDate(received.last)}
              </Link>
            ) : (
              <span className="text-sm text-muted-foreground">None received yet</span>
            )
          }
        />
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>It opens a service request — type Complaint, source Website form — and the 21-day resolution clock starts.</li>
          <li>
            It is assigned to {handler ? <strong className="text-foreground">{handler.name}</strong> : "your compliance officer, or the owner"}
            , who gets a notification. Your compliance officer handles it when you have one, otherwise the owner — never
            the client&apos;s RM by default, since a complaint can be about the RM.
          </li>
          <li>
            When the email or mobile given matches one of your clients, the complaint is linked to that client, and they
            get your usual acknowledgement when it was their email.
          </li>
          <li>The person sees a reference number to quote, and the date they will hear back by.</li>
        </ul>
      </Card>
    </div>
  );
}
