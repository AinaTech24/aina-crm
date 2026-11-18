/**
 * /dashboard/welcome — where a firm lands when it finishes the setup wizard:
 * "Start here" (import the clients, invite the team, book the onboarding call)
 * before the dashboards. Anyone may open it again; it only links onwards.
 */
import Link from "next/link";
import { requirePageSession } from "@/lib/auth/session";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { Card } from "@/components/ui/Card";
import { StartHere } from "@/components/onboarding/StartHere";
import { onboardingCallUrl } from "@/lib/onboarding/messages";

export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const session = await requirePageSession();
  const first = session.name?.trim().split(/\s+/)[0];
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeaderCard
        title={first ? `Welcome, ${first}` : "Welcome"}
        subtitle="Your CRM is ready. Three steps get it working for your practice."
        breadcrumb={[{ label: "Welcome" }]}
      />
      <Card className="p-5 sm:p-6 space-y-3">
        <h2 className="section-title">Start here</h2>
        <StartHere callUrl={onboardingCallUrl()} />
      </Card>
      <p className="text-sm text-muted-foreground">
        Prefer to look around first? <Link className="text-primary underline" href="/dashboard">Open my dashboard</Link> — the
        “Get set up” list there keeps track of what is left.
      </p>
    </div>
  );
}
