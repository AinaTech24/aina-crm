import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import Link from "next/link";
import { ChevronLeft, Calendar } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { ScheduleMeetingForm } from "@/components/review-meetings/ScheduleMeetingForm";
import { loadMeetingSubjects } from "@/lib/review-meetings/scope";

export const dynamic = "force-dynamic";

export default async function NewReviewMeetingPage({
  searchParams,
}: {
  searchParams: Promise<{ investorId?: string; leadId?: string; familyId?: string; category?: string }>;
}) {
  const sp = await searchParams;
  const session = await requireSession();
  // ?familyId= — the family page's "Schedule family review". It used to be
  // sent and never read, so the form opened on an empty Client picker.
  const familyId = sp.familyId && /^[0-9a-f-]{36}$/i.test(sp.familyId) ? sp.familyId : null;

  // Load both subject lists in parallel — the form decides which to show
  // based on the Lead | Client toggle.
  // Only clients / leads / families this viewer may see
  // (lib/review-meetings/scope.ts) — the picker used to list 300 of the firm's.
  const { investors, leads, families } = await withTenant(session.tenantId, (tx) =>
    loadMeetingSubjects(tx, session, { familyId }),
  );

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
          <Calendar className="size-6 text-muted-foreground" />
        </div>
        <PageHeaderCard title={<>Schedule review meeting</>} />
      </div>

      <ScheduleMeetingForm
        investors={investors}
        leads={leads}
        families={families}
        preselectedInvestorId={sp.investorId}
        preselectedLeadId={sp.leadId}
        preselectedFamilyId={familyId ?? undefined}
        preselectedCategory={sp.category}
      />
    </div>
  );
}
