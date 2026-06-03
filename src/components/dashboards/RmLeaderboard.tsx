import React from "react";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { Users } from "lucide-react";
import { withTenant } from "@/db/client";
import { formatINR } from "@/lib/utils";
import type { SessionUser } from "@/lib/auth/session";

export async function RmLeaderboard({ session }: { session: SessionUser }) {
  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      const res = await tx.execute(sql`
        SELECT u.id, u.name AS rm_name,
          COUNT(DISTINCT i.id)::int AS clients,
          COALESCE(SUM(i.aum::numeric), 0)::numeric AS aum,
          COALESCE(SUM(i.active_sip_amount::numeric), 0)::numeric AS sip_book
        FROM users u
        LEFT JOIN investors i ON i.rm_id = u.id AND i.status = 'active'
        WHERE 'rm' = ANY(u.roles) AND u.status = 'active'
        GROUP BY u.id, u.name
        ORDER BY aum DESC NULLS LAST
        LIMIT 8
      `);
      return res.rows as any[];
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  return (
    <div className="card-surface glass-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold flex items-center gap-2">
          <div className="size-7 rounded-lg bg-violet-50 grid place-items-center">
            <Users className="size-3.5 text-violet-600" />
          </div>
          RM Leaderboard
        </h2>
        <Link
          href="/dashboard/reports/rm_business"
          className="text-xs text-violet-700 hover:underline font-medium"
        >
          All RMs →
        </Link>
      </div>
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          No RMs configured yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs table-modern">
            <thead>
              <tr>
                <th className="text-left py-1.5 px-2">RM</th>
                <th className="text-right py-1.5 px-2">Clients</th>
                <th className="text-right py-1.5 px-2">AUM</th>
              </tr>
            </thead>
            <tbody>
              {data.slice(0, 5).map((r: any) => (
                <tr key={r.id}>
                  <td className="py-2 px-2 font-medium">{r.rm_name.split(" ")[0]}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{r.clients}</td>
                  <td className="py-2 px-2 text-right tabular-nums font-semibold">
                    {formatINR(Number(r.aum))}
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
