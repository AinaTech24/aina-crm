/**
 * AnnouncementsStrip — compact banner of active pinned/urgent notices, shown
 * at the top of the dashboard home so staff see firm news on login. Renders
 * nothing when there's nothing to show.
 */

import Link from "next/link";
import { sql } from "drizzle-orm";
import { Megaphone, Pin } from "lucide-react";
import { withTenant } from "@/db/client";

const CAT_TONE: Record<string, string> = {
  urgent: "border-rose-200 bg-rose-50/70 text-rose-900",
  policy: "border-blue-200 bg-blue-50/70 text-blue-900",
  event: "border-violet-200 bg-violet-50/70 text-violet-900",
  system: "border-amber-200 bg-amber-50/70 text-amber-900",
  general: "border-slate-200 bg-slate-50/70 text-slate-800",
};

export async function AnnouncementsStrip({ session }: { session: { tenantId: string; roles: string[]; branchId?: string | null } }) {
  const rolesJson = JSON.stringify(session.roles);
  const rows = await withTenant(session.tenantId, async (tx) => {
    const r = await tx.execute(sql`
      SELECT id, title, body, category, is_pinned
      FROM announcements
      WHERE tenant_id = ${session.tenantId}::uuid
        AND published_at IS NOT NULL AND published_at <= now()
        AND (expires_at IS NULL OR expires_at > now())
        AND (branch_id IS NULL OR branch_id = ${session.branchId ?? null})
        AND (is_pinned = true OR category = 'urgent')
        AND (
          audience_roles IS NULL
          OR jsonb_array_length(audience_roles) = 0
          OR audience_roles ?| array(SELECT jsonb_array_elements_text(${rolesJson}::jsonb))
        )
      ORDER BY (category = 'urgent') DESC, is_pinned DESC, published_at DESC
      LIMIT 3
    `);
    return r.rows as any[];
  });

  if (!rows.length) return null;

  return (
    <div className="space-y-2 mb-4">
      {rows.map((a) => (
        <Link key={a.id} href="/dashboard/announcements" className={`block rounded-lg border px-4 py-2.5 text-sm hover:brightness-[0.98] transition ${CAT_TONE[a.category] ?? CAT_TONE.general}`}>
          <div className="flex items-center gap-2 font-semibold">
            {a.is_pinned ? <Pin className="size-3.5" /> : <Megaphone className="size-3.5" />}
            {a.title}
            {a.category === "urgent" && <span className="chip text-[10px] bg-rose-600 text-white">Urgent</span>}
          </div>
          <p className="text-xs opacity-80 mt-0.5 line-clamp-1">{a.body}</p>
        </Link>
      ))}
    </div>
  );
}
