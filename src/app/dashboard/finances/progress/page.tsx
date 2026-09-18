/**
 * Monthly Progress (Network FP 8.5) — firm annual targets vs computed actuals.
 *
 * Actuals are derived live: new clients (investors.onboarded_at), leads
 * (leads.created_at), meetings done (review_meetings completed), AUM addition
 * (net successful transactions), SIP book addition (new sips), lumpsum added
 * (successful purchase/lumpsum inflows). Targets come from business_targets.
 *
 * Gated by reports.commission. FY via ?fy=YYYY-YY.
 */

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { currentFyLabel, fyStartYear, recentFyLabels } from "@/lib/finance/fiscal-year";
import { MonthlyProgressTable, type MetricRow, type MetricKey } from "@/components/finances/MonthlyProgressTable";
import { loadTargetProgress } from "@/lib/dashboard/target-progress";

export const dynamic = "force-dynamic";

const METRICS: Array<{ key: MetricKey; label: string; kind: "count" | "currency" }> = [
  { key: "new_clients", label: "New clients added", kind: "count" },
  { key: "leads_generated", label: "Leads / referrals generated", kind: "count" },
  { key: "meetings_done", label: "Meetings done", kind: "count" },
  { key: "aum_addition", label: "Total AUM addition (net)", kind: "currency" },
  { key: "sip_book_addition", label: "New SIP book addition", kind: "currency" },
  { key: "lumpsum_added", label: "Fresh lumpsum added", kind: "currency" },
];


export default async function ProgressPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  requireCap(session.roles, "finances.view", session.permissions);
  const sp = await searchParams;
  const fy = sp.fy && /^\d{4}-\d{2}$/.test(sp.fy) ? sp.fy : currentFyLabel();
  const sy = fyStartYear(fy);
  const dateStart = `${sy}-04-01`;
  const dateEnd = `${sy + 1}-03-31`;

  // Targets vs actuals now live in one place — this page and the dashboard
  // panel both call it, so they cannot drift apart.
  const rows: MetricRow[] = (await withTenant(
    session.tenantId,
    (tx) => loadTargetProgress(tx, session.tenantId, fy, sy),
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  )) as MetricRow[];

  const fyOptions = recentFyLabels(4);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Link href="/dashboard/finances" className="hover:underline inline-flex items-center gap-1">
              <ChevronLeft className="size-3" /> Finances
            </Link>
          </div>
          <h1 className="text-2xl font-semibold">Monthly progress</h1>
        </div>
        <div className="inline-flex rounded-lg border border-border bg-secondary/40 p-0.5 gap-0.5">
          {fyOptions.map((y) => (
            <Link
              key={y}
              href={`/dashboard/finances/progress?fy=${y}`}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${y === fy ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
            >
              FY {y}
            </Link>
          ))}
        </div>
      </div>

      <MonthlyProgressTable fy={fy} rows={rows} />
    </div>
  );
}
