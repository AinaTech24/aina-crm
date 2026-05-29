/**
 * Public Onboarding Progress Visualizer — accessed via /onboarding/<token>.
 *
 * The client tracks their end-to-end onboarding status across the 30 stages
 * of the Lead → Client SOP in real-time. Bypasses standard authentication by
 * resolving a secure SHA-256 hashed share token from the URL.
 */

import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ShieldCheck, AlertCircle } from "lucide-react";
import { withSystem } from "@/db/client";
import { tenants, leads, users } from "@/db/schema";
import { resolveShareToken } from "@/lib/share-tokens";
import { getStage } from "@/lib/blueprints/engine";
import { PublicOnboardingVisualizer } from "@/components/public/PublicOnboardingVisualizer";

export const dynamic = "force-dynamic";

export default async function PublicOnboardingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let info: Awaited<ReturnType<typeof resolveShareToken>>;

  try {
    info = await resolveShareToken(token);
  } catch (e: any) {
    return <ErrorScreen message={e?.message ?? "This link is no longer valid"} />;
  }

  if (info.kind !== "onboarding_progress") {
    return <ErrorScreen message="This link is not an onboarding tracker." />;
  }

  // Load tenant branding, lead name, relationship manager and live stage details
  const data = await withSystem(async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, info.tenantId));
    if (!tenant) return null;

    const [lead] = await tx.select().from(leads).where(eq(leads.id, info.subjectId));
    if (!lead) return null;

    // Fetch Relationship Manager details
    let rm = null;
    if (lead.ownerId) {
      const [u] = await tx
        .select({
          name: users.name,
          email: users.email,
          phone: users.phone,
          avatarUrl: users.avatarUrl,
        })
        .from(users)
        .where(eq(users.id, lead.ownerId))
        .limit(1);
      if (u) rm = u;
    }

    // Retrieve active stage information + transition history from the blueprint engine
    const stageDetails = await getStage(tx, info.tenantId, info.subjectId);

    return { tenant, lead, stageDetails, rm };
  });

  if (!data) {
    return <ErrorScreen message="Associated records could not be resolved." />;
  }

  return (
    <div className="min-h-screen bg-slate-950 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-slate-100 relative overflow-hidden flex flex-col font-sans">
      {/* Background glow effects */}
      <div className="absolute top-1/4 left-1/4 size-[40rem] bg-cyan-500/5 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 size-[40rem] bg-indigo-500/5 rounded-full blur-[100px] pointer-events-none" />

      {/* Brand Header */}
      <header className="bg-slate-900/40 border-b border-white/5 backdrop-blur-md relative z-10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-brand-cyan" />
            <span className="font-semibold text-white tracking-tight">
              {data.tenant.displayName ?? data.tenant.legalName ?? "Onboarding Progress"}
            </span>
          </div>
          {data.tenant.arn && (
            <div className="text-[11px] font-mono text-slate-400 bg-slate-800/40 px-2.5 py-0.5 rounded-full border border-slate-700/30">
              ARN-{data.tenant.arn}
            </div>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-grow max-w-3xl w-full mx-auto px-4 py-8 relative z-10">
        <PublicOnboardingVisualizer
          recipientName={data.lead.name}
          tenant={data.tenant}
          stageDetails={data.stageDetails}
          rm={data.rm}
        />
      </main>

      {/* Footer */}
      <footer className="max-w-3xl mx-auto w-full px-4 py-6 text-[10px] text-slate-500 text-center relative z-10 border-t border-white/5">
        Mutual fund investments are subject to market risks. Read all scheme related documents carefully.
        {data.tenant.arn ? (
          <>
            {" "}
            · {data.tenant.displayName ?? data.tenant.legalName} · ARN-{data.tenant.arn}
          </>
        ) : null}
      </footer>
    </div>
  );
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-slate-950 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 grid place-items-center p-6 text-slate-100 relative font-sans">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 size-96 bg-rose-500/5 rounded-full blur-[80px] pointer-events-none" />
      <div className="max-w-md w-full bg-slate-900/50 backdrop-blur-md rounded-2xl border border-white/10 p-8 text-center shadow-2xl relative z-10">
        <AlertCircle className="size-12 text-rose-500 mx-auto animate-pulse" />
        <h1 className="text-xl font-bold mt-4 text-white">Link Unavailable</h1>
        <p className="text-sm text-slate-400 mt-2 leading-relaxed">{message}</p>
        <p className="text-xs text-slate-500 mt-6 leading-relaxed">
          Please reach out to your relationship manager or representative for assistance or a new link.
        </p>
      </div>
    </div>
  );
}
