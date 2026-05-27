import Link from "next/link";
import { and, eq, sql } from "drizzle-orm";
import { ChevronLeft, Building2 } from "lucide-react";
import { db } from "@/db/client";
import { tenants, subscriptions, packages, users } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { loadTenantLicense } from "@/lib/auth/license";
import { OrganisationProfileForm } from "@/components/settings/OrganisationProfileForm";

export const dynamic = "force-dynamic";

export default async function OrganisationProfilePage() {
  const session = await requireSession();

  // Tenant identity + license + package + owner — fetched in parallel for snappy render
  const [tenant, sub, license, ownerRow] = await Promise.all([
    db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1).then((r) => r[0]),
    db.select().from(subscriptions).where(eq(subscriptions.tenantId, session.tenantId)).limit(1).then((r) => r[0]),
    loadTenantLicense(session.tenantId, session.roles),
    db
      .execute(sql`
        SELECT id, name, email FROM users
        WHERE tenant_id = ${session.tenantId} AND 'owner' = ANY(roles)
        ORDER BY activated_at ASC NULLS LAST LIMIT 1
      `)
      .then((r) => (r.rows[0] as { id: string; name: string; email: string } | undefined) ?? null),
  ]);

  const pkg = sub
    ? await db.select().from(packages).where(eq(packages.id, sub.packageId)).limit(1).then((r) => r[0])
    : null;

  return (
    <div className="space-y-4 max-w-4xl">
      <Link
        href="/dashboard/settings"
        className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
      >
        <ChevronLeft className="size-4" /> Back to settings
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Building2 className="size-5" /> Organisation profile
        </h1>
        <p className="text-muted-foreground text-sm">
          Identity, branding, AUM range. ARN, EUIN, package, and license are managed by AINA.
        </p>
      </div>

      <OrganisationProfileForm
        tenant={JSON.parse(JSON.stringify(tenant))}
        owner={ownerRow}
        subscription={sub ? JSON.parse(JSON.stringify(sub)) : null}
        pkg={pkg ? JSON.parse(JSON.stringify(pkg)) : null}
        license={JSON.parse(JSON.stringify(license))}
      />
    </div>
  );
}
