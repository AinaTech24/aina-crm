/**
 * SignalScoreCard — behavioural engagement score for a lead (Zoho scoring
 * parity). Server component: computes the signal bonus + breakdown and renders
 * a compact card on the lead detail.
 */

import { Activity, Flame } from "lucide-react";
import { withTenant } from "@/db/client";
import { leadSignalScore, type SignalScore } from "@/lib/leads/signal-score";

const BAND_TONE: Record<string, string> = { hot: "bg-rose-50 text-rose-700", warm: "bg-amber-50 text-amber-700", cold: "bg-secondary text-muted-foreground" };

export async function SignalScoreCard({ session, leadId }: { session: { tenantId: string; userId: string; branchId?: string | null; roles: string[] }; leadId: string }) {
  const score: SignalScore = await withTenant(
    session.tenantId,
    (tx) => leadSignalScore(tx as any, { tenantId: session.tenantId, leadId }),
    { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles }
  );

  // Nothing logged yet → nothing to show. A line saying "none yet" on most
  // leads was a card explaining its own absence.
  if (score.lines.length === 0) return null;

  return (
    <div className="card-surface p-5">
      <div className="flex items-center justify-between mb-2">
        <h3 className="section-title flex items-center gap-2"><Activity className="size-4 text-muted-foreground" /> Engagement signals</h3>
        <span className={`chip text-2xs capitalize inline-flex items-center gap-1 ${BAND_TONE[score.band]}`}><Flame className="size-3" /> {score.band} · +{score.total}</span>
      </div>
      {score.lines.length === 0 ? (
        <p className="text-xs text-muted-foreground">No engagement signals yet — log a call, message, or meeting to build this lead&apos;s behavioural score.</p>
      ) : (
        <ul className="space-y-1">
          {score.lines.map((l) => (
            <li key={l.label} className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{l.label} <span className="opacity-60">×{l.count}</span></span>
              <span className="font-semibold tabular-nums text-emerald-700">+{l.points}</span>
            </li>
          ))}
        </ul>
      )}
      
    </div>
  );
}
