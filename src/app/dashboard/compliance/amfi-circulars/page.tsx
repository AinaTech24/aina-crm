import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
/**
 * AMFI / SEBI circular digest — plain-English summaries of live regulatory
 * requirements + the concrete action each one means for the MFD. Curated
 * platform-shared data (amfi_circulars); compliance can draft new entries with
 * the AI summariser. Keeps distributors out of dense regulator PDFs.
 */

import { desc, eq } from "drizzle-orm";
import { ScrollText } from "lucide-react";
import { db, withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { amfiCirculars, tenantCirculars } from "@/db/schema";
import { CircularSummarizer } from "@/components/compliance/CircularSummarizer";
import { CircularsFeed } from "@/components/compliance/CircularsFeed";

export const dynamic = "force-dynamic";

export default async function AmfiCircularsPage() {
  const session = await requireSession();
  // Regulatory digest is informational staff content — any authenticated user.
  const canDraft = session.roles.some((r) => ["owner", "compliance"].includes(r));

  // Platform-shared table (no tenant_id / no RLS) — a plain select returns the
  // curated set for everyone.
  const circulars = await db
    .select()
    .from(amfiCirculars)
    .orderBy(desc(amfiCirculars.publishedOn))
    .limit(100);

  // The tenant's own saved circulars (RLS-scoped).
  const myCirculars = await withTenant(session.tenantId, async (tx) =>
    tx
      .select()
      .from(tenantCirculars)
      .where(eq(tenantCirculars.tenantId, session.tenantId))
      .orderBy(desc(tenantCirculars.createdAt))
      .limit(100)
  );

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeaderCard title={<><ScrollText className="size-6 text-muted-foreground" /> Regulatory circular digest</>} />

      {canDraft && <CircularSummarizer />}

      <CircularsFeed myCirculars={myCirculars} amfiCirculars={circulars} canDraft={canDraft} />
    </div>
  );
}
