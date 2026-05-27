import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ChevronLeft, ClipboardCheck } from "lucide-react";
import { withTenant } from "@/db/client";
import { onboardingPipelines, investors, users, ONBOARDING_STAGES } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { formatDate, formatRelative } from "@/lib/utils";
import { OnboardingStageActions } from "@/components/onboarding/OnboardingStageActions";

const STAGE_LABELS: Record<string, string> = {
  first_meeting: "First Meeting Done",
  documents: "Documents Collected",
  kyc: "KYC Checked",
  risk_profile: "Risk Profile Completed",
  goal_mapping: "Goal Mapping Done",
  ucc_can: "UCC / CAN Created",
  mandate: "Mandate Registered",
  plan_shared: "Investment Plan Shared",
  first_investment: "SIP / Lumpsum Started",
  welcome_kit: "Welcome Kit Sent",
  first_review: "First Review Scheduled",
};

export const dynamic = "force-dynamic";

export default async function OnboardingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const data = await withTenant(session.tenantId, async (tx) => {
    const pipe = (await tx.select().from(onboardingPipelines).where(eq(onboardingPipelines.id, id)).limit(1))[0];
    if (!pipe) return null;
    const inv = (await tx.select().from(investors).where(eq(investors.id, pipe.investorId)).limit(1))[0];
    const rm = pipe.assignedRmId
      ? (await tx.select({ id: users.id, name: users.name, email: users.email })
          .from(users).where(eq(users.id, pipe.assignedRmId)).limit(1))[0]
      : null;
    return { pipe, investor: inv, rm };
  });
  if (!data) notFound();

  const stages = (data.pipe.stages ?? {}) as Record<string, { doneAt: string; byUserId?: string; remarks?: string }>;
  const doneCount = Object.keys(stages).length;
  const completionPct = Math.round((doneCount / ONBOARDING_STAGES.length) * 100);
  const pendingDocs = (data.pipe.pendingDocuments ?? []) as string[];

  return (
    <div className="space-y-6 max-w-4xl">
      <Link href="/dashboard/onboarding" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to onboarding
      </Link>

      {/* Header */}
      <div className="border rounded-lg bg-card p-6">
        <div className="flex items-start gap-4">
          <div className="size-12 rounded-lg bg-primary/10 grid place-items-center">
            <ClipboardCheck className="size-6 text-primary" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight">{data.investor?.name ?? "Investor"}</h1>
            <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 font-mono">
              <span>{data.investor?.pan}</span>
              <span>·</span>
              <span>Pipeline {data.pipe.id.slice(0, 8)}…</span>
            </div>
            <div className="mt-3 flex items-center gap-3 text-sm">
              <span className="text-xs text-muted-foreground">Assigned RM:</span>
              <span className="font-medium">{data.rm?.name ?? "—"}</span>
              <span
                className={`ml-3 text-xs px-2 py-0.5 rounded-full ${
                  data.pipe.status === "completed"
                    ? "bg-emerald-50 text-emerald-700"
                    : data.pipe.status === "on_hold"
                    ? "bg-amber-50 text-amber-700"
                    : "bg-blue-50 text-blue-700"
                }`}
              >
                {data.pipe.status.replace("_", " ")}
              </span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Completion</div>
            <div className="text-3xl font-bold mt-1 tabular-nums">{completionPct}%</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {doneCount} of {ONBOARDING_STAGES.length}
            </div>
          </div>
        </div>

        <div className="mt-4 h-2 rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-emerald-500" style={{ width: `${completionPct}%` }} />
        </div>

        <div className="mt-4 pt-4 border-t grid grid-cols-3 gap-4 text-sm">
          <KV label="Current stage" value={STAGE_LABELS[data.pipe.currentStage] ?? data.pipe.currentStage} />
          <KV
            label="Expected completion"
            value={data.pipe.expectedCompletionAt ? formatDate(data.pipe.expectedCompletionAt) : "—"}
          />
          <KV
            label="Actual completion"
            value={data.pipe.actualCompletionAt ? formatDate(data.pipe.actualCompletionAt) : "—"}
          />
        </div>
      </div>

      {/* Stage timeline */}
      <div className="border rounded-lg bg-card">
        <div className="border-b px-4 py-2.5 font-medium">Stage timeline</div>
        <ul className="divide-y">
          {ONBOARDING_STAGES.map((stage, idx) => {
            const entry = stages[stage];
            const isDone = !!entry;
            const isCurrent = !isDone && stage === data.pipe.currentStage;
            return (
              <li key={stage} className="flex items-start gap-4 p-4">
                <div
                  className={`size-6 rounded-full grid place-items-center text-xs font-bold flex-shrink-0 ${
                    isDone
                      ? "bg-emerald-500 text-white"
                      : isCurrent
                      ? "bg-blue-500 text-white"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {isDone ? "✓" : idx + 1}
                </div>
                <div className="flex-1">
                  <div className="font-medium">{STAGE_LABELS[stage]}</div>
                  {isDone && (
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Done {formatRelative(entry.doneAt)}
                      {entry.remarks && <div className="mt-1 italic">"{entry.remarks}"</div>}
                    </div>
                  )}
                  {isCurrent && (
                    <div className="text-xs text-blue-600 mt-0.5">← current stage</div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Pending docs */}
      {pendingDocs.length > 0 && (
        <div className="border rounded-lg bg-amber-50 border-amber-200 p-4">
          <div className="font-medium text-amber-900 mb-2">Pending documents</div>
          <ul className="text-sm text-amber-900 space-y-1">
            {pendingDocs.map((d, i) => (
              <li key={i}>• {d}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Stage advance action */}
      {data.pipe.status !== "completed" && (
        <OnboardingStageActions
          pipelineId={data.pipe.id}
          currentStage={data.pipe.currentStage as any}
          doneStages={Object.keys(stages)}
        />
      )}
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-medium mt-0.5">{value}</div>
    </div>
  );
}
