import Link from "next/link";
import { sql } from "drizzle-orm";
import { ClipboardList, AlertCircle, FileWarning } from "lucide-react";
import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";

/**
 * Back office dashboard — operational queues.
 * Per spec section 2:
 *   KYC pending · UCC/CAN pending · Mandate pending · SIP registration pending
 *   Service requests pending · Nominee update pending · Bank update pending
 *   Minor to major cases · SIP rejection cases · Document pending list
 */
export async function BackOfficeDashboard({ session }: { session: SessionUser }) {
  const data = await withTenant(session.tenantId, async (tx) => {
    const r = await tx.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM investors WHERE kyc_status IN ('pending', 'expired')) AS kyc_pending,
        (SELECT COUNT(*)::int FROM mandates WHERE status = 'pending') AS mandate_pending,
        (SELECT COUNT(*)::int FROM sips WHERE status = 'pending') AS sip_reg_pending,
        (SELECT COUNT(*)::int FROM sips WHERE status IN ('rejected', 'paused')) AS sip_issues,
        (SELECT COUNT(*)::int FROM transactions WHERE status = 'rejected'
            AND created_at >= now() - interval '7 days') AS rejected_tx_7d,
        (SELECT COUNT(*)::int FROM service_requests WHERE status IN ('open', 'in_progress')) AS sr_pending,
        (SELECT COUNT(*)::int FROM service_requests
            WHERE status IN ('open', 'in_progress')
              AND sla_resolution_at < now()) AS sr_breached,
        (SELECT COUNT(*)::int FROM investors WHERE nominee_name IS NULL OR nominee_name = '') AS nominee_pending,
        (SELECT COUNT(*)::int FROM investors WHERE is_minor = true
            AND dob IS NOT NULL
            AND dob >= current_date - interval '18 years 90 days'
            AND dob < current_date - interval '18 years') AS minor_to_major,
        (SELECT COUNT(*)::int FROM investors WHERE bank_account_masked IS NULL OR bank_account_masked = '') AS bank_pending
    `);
    const s = r.rows[0] as any;

    const recentSr = await tx.execute(sql`
      SELECT sr.id, sr.ticket_no, sr.subject, sr.type, sr.status, sr.sla_resolution_at,
             i.name AS investor_name
      FROM service_requests sr
      LEFT JOIN investors i ON i.id = sr.investor_id
      WHERE sr.status IN ('open', 'in_progress')
      ORDER BY sr.sla_resolution_at ASC NULLS LAST
      LIMIT 10
    `);

    return {
      kycPending: Number(s.kyc_pending),
      mandatePending: Number(s.mandate_pending),
      sipRegPending: Number(s.sip_reg_pending),
      sipIssues: Number(s.sip_issues),
      rejectedTx7d: Number(s.rejected_tx_7d),
      srPending: Number(s.sr_pending),
      srBreached: Number(s.sr_breached),
      nomineePending: Number(s.nominee_pending),
      minorToMajor: Number(s.minor_to_major),
      bankPending: Number(s.bank_pending),
      recentSr: recentSr.rows as any[],
    };
  }, { userId: session.userId, branchId: session.branchId, roles: session.roles });

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Operations queues</h1>
        <p className="text-muted-foreground text-sm">All the things waiting on the back office.</p>
      </div>

      <div className="grid grid-cols-5 gap-3">
        <Queue href="/dashboard/investors?segment=&q=" label="KYC pending" value={data.kycPending} tone={data.kycPending > 0 ? "amber" : "muted"} />
        <Queue href="/dashboard/sips" label="Mandate pending" value={data.mandatePending} tone={data.mandatePending > 0 ? "amber" : "muted"} />
        <Queue href="/dashboard/sips" label="SIP registration pending" value={data.sipRegPending} tone={data.sipRegPending > 0 ? "amber" : "muted"} />
        <Queue href="/dashboard/sip-rejections" label="SIP rejections (7d)" value={data.rejectedTx7d} tone={data.rejectedTx7d > 0 ? "rose" : "muted"} />
        <Queue href="/dashboard/service-requests" label="SLA breached" value={data.srBreached} tone={data.srBreached > 0 ? "rose" : "muted"} />
      </div>

      <div className="grid grid-cols-5 gap-3">
        <Queue href="/dashboard/service-requests" label="Service requests open" value={data.srPending} />
        <Queue href="/dashboard/investors" label="Nominee missing" value={data.nomineePending} tone="amber" />
        <Queue href="/dashboard/investors" label="Bank details missing" value={data.bankPending} tone="amber" />
        <Queue href="/dashboard/investors" label="Minor → Major (90d)" value={data.minorToMajor} tone={data.minorToMajor > 0 ? "amber" : "muted"} />
        <Queue href="/dashboard/sips" label="SIP issues (active)" value={data.sipIssues} />
      </div>

      <div className="border rounded-lg bg-card p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2">
            <ClipboardList className="size-4" /> SLA queue (oldest first)
          </h2>
          <Link href="/dashboard/service-requests" className="text-xs text-muted-foreground hover:underline">
            Open all →
          </Link>
        </div>
        {data.recentSr.length === 0 ? (
          <p className="text-sm text-muted-foreground mt-3 text-center py-6">No open service requests. ✓</p>
        ) : (
          <table className="w-full text-sm mt-3">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left py-2 font-medium">Ticket</th>
                <th className="text-left py-2 font-medium">Subject</th>
                <th className="text-left py-2 font-medium">Investor</th>
                <th className="text-left py-2 font-medium">Type</th>
                <th className="text-right py-2 font-medium">SLA</th>
              </tr>
            </thead>
            <tbody>
              {data.recentSr.map((r: any) => {
                const slaMs = r.sla_resolution_at ? new Date(r.sla_resolution_at).getTime() - Date.now() : null;
                const breached = slaMs != null && slaMs < 0;
                return (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-2 font-mono text-xs">{r.ticket_no}</td>
                    <td className="py-2 max-w-xs truncate">{r.subject}</td>
                    <td className="py-2">{r.investor_name ?? "—"}</td>
                    <td className="py-2 text-xs text-muted-foreground">{r.type}</td>
                    <td className="py-2 text-right">
                      {breached ? (
                        <span className="text-xs text-rose-600 flex items-center justify-end gap-1">
                          <AlertCircle className="size-3" /> breached
                        </span>
                      ) : slaMs != null ? (
                        <span className="text-xs text-muted-foreground">
                          {Math.floor(slaMs / (60 * 60 * 1000))}h
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Queue({
  href,
  label,
  value,
  tone,
}: {
  href: string;
  label: string;
  value: number;
  tone?: "rose" | "amber" | "muted";
}) {
  const color = tone === "rose" ? "text-rose-600" : tone === "amber" ? "text-amber-600" : "text-foreground";
  return (
    <Link href={href} className="border rounded-lg p-4 bg-card hover:bg-accent/40 transition-colors block">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div>
    </Link>
  );
}
