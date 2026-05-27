import Link from "next/link";
import { sql } from "drizzle-orm";
import { ChevronLeft, Calendar } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { ScheduleMeetingForm } from "@/components/review-meetings/ScheduleMeetingForm";

export const dynamic = "force-dynamic";

export default async function NewReviewMeetingPage({
  searchParams,
}: {
  searchParams: Promise<{ investorId?: string; leadId?: string }>;
}) {
  const sp = await searchParams;
  const session = await requireSession();

  // Load both subject lists in parallel — the form decides which to show
  // based on the Lead | Client toggle.
  const { investors, leads } = await withTenant(session.tenantId, async (tx) => {
    const [invRes, leadRes] = await Promise.all([
      tx.execute(sql`
        SELECT id, name, pan, segment_tag, last_review_at, next_review_at
        FROM investors WHERE status = 'active'
        ORDER BY (next_review_at IS NULL) DESC, next_review_at ASC NULLS FIRST, name
        LIMIT 300
      `),
      tx.execute(sql`
        SELECT id, name, phone, stage
        FROM leads
        WHERE stage NOT IN ('converted', 'lost', 'cold', 'not_interested')
        ORDER BY updated_at DESC
        LIMIT 300
      `),
    ]);
    return { investors: invRes.rows as any[], leads: leadRes.rows as any[] };
  });

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <Link
        href="/dashboard/review-meetings"
        className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
      >
        <ChevronLeft className="size-4" /> Back to review meetings
      </Link>

      <div className="card-surface p-6 flex items-start gap-4">
        <div className="size-12 rounded-lg bg-brand-cyan-light grid place-items-center">
          <Calendar className="size-6 text-brand-cyan" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Schedule review meeting</h1>
          <p className="text-sm text-muted-foreground mt-1">
            A reminder task auto-fires the day before. After completion, action items become tasks.
          </p>
        </div>
      </div>

      <ScheduleMeetingForm
        investors={investors}
        leads={leads}
        preselectedInvestorId={sp.investorId}
        preselectedLeadId={sp.leadId}
      />
    </div>
  );
}
