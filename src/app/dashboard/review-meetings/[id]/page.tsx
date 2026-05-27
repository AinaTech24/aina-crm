import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ChevronLeft, Calendar } from "lucide-react";
import { withTenant } from "@/db/client";
import { reviewMeetings, investors, users } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { ReviewMeetingDetailEditor } from "@/components/review-meetings/ReviewMeetingDetailEditor";

export const dynamic = "force-dynamic";

export default async function ReviewMeetingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  const data = await withTenant(session.tenantId, async (tx) => {
    const m = (await tx.select().from(reviewMeetings).where(eq(reviewMeetings.id, id)).limit(1))[0];
    if (!m) return null;
    const inv = (await tx.select().from(investors).where(eq(investors.id, m.investorId)).limit(1))[0];
    const rm = m.rmId
      ? (await tx.select().from(users).where(eq(users.id, m.rmId)).limit(1))[0]
      : null;
    return { meeting: m, investor: inv, rm };
  });
  if (!data) notFound();

  return (
    <div className="max-w-4xl mx-auto space-y-4">
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
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">
            {data.investor?.name ?? "Investor"} ·{" "}
            {data.meeting.meetingType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
          </h1>
          <div className="text-sm text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
            <span>{new Date(data.meeting.meetingDate).toLocaleString("en-IN", { dateStyle: "full", timeStyle: "short" })}</span>
            <span>·</span>
            <span className="capitalize">{data.meeting.meetingMode.replace(/_/g, " ")}</span>
            {data.rm && (
              <>
                <span>·</span>
                <span>RM: {data.rm.name}</span>
              </>
            )}
          </div>
        </div>
      </div>

      <ReviewMeetingDetailEditor
        meeting={JSON.parse(JSON.stringify(data.meeting))}
        investorName={data.investor?.name ?? "Investor"}
      />
    </div>
  );
}
