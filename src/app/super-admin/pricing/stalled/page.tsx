/**
 * Aina Admin → Stalled onboarding. Firms that paid at least 3 days ago and
 * still have no clients (lib/onboarding/stalled.ts) — who to call, and whether
 * the one automatic "need a hand importing your clients?" email has gone.
 */
import Link from "next/link";
import { withSystem } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { Badge } from "@/components/ui/Badge";
import { InlineEmpty } from "@/components/common/EmptyState";
import { formatDate } from "@/lib/format";
import { isStalled, loadPaidFirmsWithoutClients, STALLED_AFTER_DAYS } from "@/lib/onboarding/stalled";

export const dynamic = "force-dynamic";

export default async function StalledOnboardingPage() {
  const session = await requireSession();
  requirePlatform(session.roles, "platform.settings.manage");
  const now = new Date();
  const firms = (await withSystem((tx) => loadPaidFirmsWithoutClients(tx))).filter((f) => isStalled(f, now));

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="page-title">Stalled onboarding</h1>
        <p className="text-muted-foreground text-sm">
          Firms that paid {STALLED_AFTER_DAYS} or more days ago and have no clients yet. Each owner gets one automatic email offering help;
          a call does more. Back to <Link className="text-primary underline" href="/super-admin/pricing/quotes">pricing quotes</Link>.
        </p>
      </div>
      {firms.length === 0 ? (
        <InlineEmpty message="No stalled firms — every firm that paid has clients." />
      ) : (
        <div className="table-scroll card-surface">
          <table className="table-modern w-full text-sm">
            <caption className="sr-only">Firms that paid but have no clients, longest waiting first</caption>
            <thead>
              <tr>
                <th scope="col">Firm</th>
                <th scope="col">Owner</th>
                <th scope="col">First paid</th>
                <th scope="col" className="text-right">Days since</th>
                <th scope="col">Nudge email</th>
              </tr>
            </thead>
            <tbody>
              {firms.map((f) => (
                <tr key={f.tenantId}>
                  <td>
                    <Link className="font-medium text-primary underline" href={`/super-admin/tenants/${f.tenantId}`}>
                      {f.firmName || "Open firm"}
                    </Link>
                  </td>
                  <td>
                    <div>{f.ownerName ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      {f.ownerEmail ?? "no owner email"}
                      {f.ownerMobile ? ` · ${f.ownerMobile}` : ""}
                    </div>
                  </td>
                  <td className="whitespace-nowrap">{formatDate(f.firstPaidAt)}</td>
                  <td className="text-right tabular-nums">{Math.floor((now.getTime() - f.firstPaidAt.getTime()) / 86_400_000)}</td>
                  <td>
                    {f.nudgedAt ? (
                      <Badge tone="info" raw>Sent {formatDate(f.nudgedAt)}</Badge>
                    ) : (
                      <Badge tone="neutral" raw>Not yet</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
