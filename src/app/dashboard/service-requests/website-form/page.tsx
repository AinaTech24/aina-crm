/**
 * /dashboard/service-requests/website-form — the firm's service request link.
 *
 * Reached from Service Requests → ⋯ → "Service request form for clients". The
 * link is made the first time anyone opens this page; what clients send through
 * it arrives in Service Requests (lib/service-requests/web-form.ts).
 */

import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { ClipboardList } from "lucide-react";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { Card, CardHeader } from "@/components/ui/Card";
import { ServiceFormLinkPanel } from "@/components/service-requests/ServiceFormLinkPanel";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { ensureServiceFormLink } from "@/lib/service-requests/web-form";
import { appBaseUrl } from "@/lib/share-tokens/sample";
import { formatCount, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ServiceRequestFormPage() {
  const session = await requireSession();
  const has = (cap: Parameters<typeof can>[1]) => can(session.roles, cap, session.permissions);
  if (!(has("service_request.view.all") || has("service_request.manage"))) {
    redirect("/dashboard/service-requests");
  }
  const canManage = has("service_request.manage");

  // The link the firm copies uses the host it is signed in on, so a firm on its
  // own domain gets a link on that domain.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  const origin = host ? `${proto}://${host}` : appBaseUrl();

  const { link, firmName, received } = await withTenant(session.tenantId, async (tx) => {
    const link = await ensureServiceFormLink(tx, session.tenantId);
    const r = await tx.execute(sql`
      SELECT (SELECT display_name FROM tenants WHERE id = ${session.tenantId}::uuid) AS firm,
             count(*)::int AS n, max(created_at) AS last
      FROM service_requests
      WHERE tenant_id = ${session.tenantId}::uuid AND channel = 'form' AND type <> 'complaint'
        AND timeline->0->>'by' = 'website'
    `);
    const row = r.rows[0] as { firm: string | null; n: number; last: string | null } | undefined;
    return { link, firmName: row?.firm ?? "us", received: { n: Number(row?.n ?? 0), last: row?.last ?? null } };
  });

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeaderCard
        title={<><ClipboardList className="size-6 text-muted-foreground" /> Service request form for clients</>}
      />

      <ServiceFormLinkPanel origin={origin} token={link.token} enabled={link.enabled} canManage={canManage} firmName={firmName} />

      <Card className="space-y-3 p-5">
        <CardHeader
          title="What happens to a request"
          action={
            received.n > 0 ? (
              <Link href="/dashboard/service-requests" className="text-sm text-primary hover:underline">
                {formatCount(received.n)} received · last {formatDate(received.last)}
              </Link>
            ) : (
              <span className="text-sm text-muted-foreground">None received yet</span>
            )
          }
        />
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>The client chooses a service (or types their own under Other). It opens a service request with its own service ID.</li>
          <li>The client sees the service ID on the page the moment they submit, and the date they will hear back by.</li>
          <li>
            When the mobile or email given matches one of your clients, the request is linked to that client and goes to
            their relationship manager, who gets a notification. Otherwise it goes to the owner.
          </li>
          <li>Requests are no longer created from incoming emails.</li>
        </ul>
      </Card>
    </div>
  );
}
