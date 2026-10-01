import Link from "next/link";
import { sql } from "drizzle-orm";
import { Users2 } from "lucide-react";
import { withTenant } from "@/db/client";
import { formatINR } from "@/lib/utils";
import type { SessionUser } from "@/lib/auth/session";
import { Badge } from "@/components/ui/Badge";
import { roleLabel } from "@/lib/families/roles";
import { loadViewableFamily } from "@/lib/families/access";

/**
 * Family Snapshot — the client's household on their own page: the other
 * members, and the family's combined AUM and SIP.
 *
 * The same rules as the Families screens: members are records that are not
 * deleted or merged away; the totals count LIVE members (a closed client is
 * listed but adds nothing); the head is the family's recorded head and is
 * listed first. The link opens THIS family, not the list of every family.
 *
 * Auto-hides when the client has no family, or the viewer may not see it.
 */
export async function FamilySnapshot({
  session,
  familyId,
  familyName,
  currentInvestorId,
}: {
  session: SessionUser;
  familyId: string | null;
  familyName: string | null;
  currentInvestorId: string;
}) {
  if (!familyId) return null;

  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      if (!(await loadViewableFamily(tx, session, familyId))) return null;
      const head = (await tx.execute(sql`
        SELECT primary_investor_id FROM families WHERE id = ${familyId}::uuid AND tenant_id = ${session.tenantId}::uuid
      `)).rows[0] as { primary_investor_id?: string | null } | undefined;
      const r = await tx.execute(sql`
        SELECT id, name, family_role, segment_tag, status,
               COALESCE(aum::numeric, 0) AS aum,
               COALESCE(active_sip_amount::numeric, 0) AS active_sip,
               kyc_status, nominee_name, nominees, ckyc_expiry_at
          FROM investors
         WHERE family_id = ${familyId}::uuid AND tenant_id = ${session.tenantId}::uuid
           AND deleted_at IS NULL AND merged_into_id IS NULL
         ORDER BY (id = ${head?.primary_investor_id ?? null}::uuid) DESC NULLS LAST, aum::numeric DESC NULLS LAST
      `);
      return { members: r.rows as any[], headId: head?.primary_investor_id ?? null };
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  if (!data || data.members.length === 0) return null;
  const { members, headId } = data;
  const live = members.filter((m) => m.status !== "closed" && m.status !== "exited");
  const totalAum = live.reduce((s, m) => s + Number(m.aum ?? 0), 0);
  const totalSip = live.reduce((s, m) => s + Number(m.active_sip ?? 0), 0);
  const soon = Date.now() + 30 * 86_400_000;

  return (
    <div className="card-surface p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="section-title flex items-center gap-2">
          <Users2 className="size-4 text-muted-foreground" />
          Family
          {familyName && <span className="text-xs font-normal text-muted-foreground">· {familyName}</span>}
        </h2>
        <Link href={`/dashboard/families/${familyId}`} className="text-xs font-semibold text-primary hover:underline">
          Open family →
        </Link>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-3">
        <Tile label="Members" value={String(live.length)} />
        <Tile label="Combined AUM" value={formatINR(totalAum)} />
        <Tile label="SIP / month" value={totalSip > 0 ? formatINR(totalSip) : "—"} />
      </div>

      <ul className="divide-y">
        {members.map((m) => {
          const isSelf = m.id === currentInvestorId;
          const isHead = m.id === headId;
          const kycGap = m.kyc_status !== "verified" || (m.ckyc_expiry_at && new Date(m.ckyc_expiry_at).getTime() <= soon);
          const nomineeGap = !(m.nominee_name && String(m.nominee_name).trim()) && !(Array.isArray(m.nominees) && m.nominees.length);
          return (
            <li key={m.id} className={`flex items-center justify-between py-2 text-sm ${isSelf ? "-mx-2 rounded bg-accent px-2" : ""}`}>
              <div className="min-w-0 flex-1">
                {isSelf ? (
                  <span className="font-semibold">{m.name}</span>
                ) : (
                  <Link href={`/dashboard/investors/${m.id}`} className="font-semibold hover:underline">{m.name}</Link>
                )}
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-2xs text-muted-foreground">
                  <span>{isHead ? "Head of family" : roleLabel(m.family_role)}</span>
                  {m.segment_tag && <Badge raw>{m.segment_tag}</Badge>}
                  {m.status && m.status !== "active" && <Badge tone="warning">{m.status}</Badge>}
                  {kycGap && <Badge raw tone="danger">KYC gap</Badge>}
                  {nomineeGap && <Badge raw tone="danger">No nominee</Badge>}
                  {isSelf && <Badge raw>This client</Badge>}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs font-semibold tabular-nums">{formatINR(Number(m.aum))}</div>
                {Number(m.active_sip) > 0 && (
                  <div className="text-2xs tabular-nums text-muted-foreground">SIP {formatINR(Number(m.active_sip))}</div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {live.length === 1 && (
        <p className="mt-3 text-2xs text-muted-foreground">
          Only one member captured — onboarding a spouse or children is one of the fastest wallet-share wins.
        </p>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-secondary/50 p-3">
      <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
