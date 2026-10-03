import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { ChevronLeft, Palette } from "lucide-react";
import { withTenant } from "@/db/client";
import { tenants } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { AppearanceThemeForm } from "@/components/settings/AppearanceThemeForm";

export const dynamic = "force-dynamic";

export default async function AppearanceSettingsPage() {
  const session = await requireSession();

  const tenant = await withTenant(session.tenantId, async (tx) =>
    tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1).then((r) => r[0])
  );

  return (
    <div className="space-y-4 max-w-5xl">
      <Link
        href="/dashboard/settings"
        className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
      >
        <ChevronLeft className="size-4" /> Back to settings
      </Link>

      <PageHeaderCard title={<><Palette className="size-5" /> Appearance &amp; theme</>} />

      <AppearanceThemeForm tenant={JSON.parse(JSON.stringify(tenant))} />
    </div>
  );
}
