/**
 * One family's page data — shared by the web family page and the mobile app's
 * /api/families/[id]/full, so the two can never disagree.
 *
 * Rules it applies (each was a bug on one screen or another):
 *  · Visibility is lib/families/access — the web page used to check nothing.
 *  · Members are records that are not deleted and not merged away. A closed
 *    client is still shown (it is family history) but adds nothing to the
 *    family's AUM or SIP: the totals use LIVE members, the same definition as
 *    the Clients list and the Families list.
 *  · The head is the family's recorded head when that person is a member —
 *    never "the first member" as a stand-in, which used to badge someone
 *    "primary" while the health card said no head was set.
 *  · Goals exclude achieved and abandoned ones, and the projection uses each
 *    goal's own expected return.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { families, investors, users } from "@/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { loadViewableFamily } from "./access";
import { isLiveMember, isNextGenProspect, nominationApplies, nomineeGap } from "./health";

export async function loadFamilyDetail(tx: any, session: SessionUser, familyId: string) {
  if (!(await loadViewableFamily(tx, session, familyId))) return null;
  const fam = (await tx.select().from(families).where(and(eq(families.id, familyId), eq(families.tenantId, session.tenantId))).limit(1))[0];
  if (!fam) return null;

  const members = (await tx
    .select()
    .from(investors)
    .where(and(eq(investors.familyId, familyId), isNull(investors.deletedAt), isNull(investors.mergedIntoId)))) as Array<
    typeof investors.$inferSelect
  >;
  // Head first, then by AUM.
  members.sort((a, b) =>
    a.id === fam.primaryInvestorId ? -1 : b.id === fam.primaryInvestorId ? 1 : Number(b.aum ?? 0) - Number(a.aum ?? 0)
  );
  const live = members.filter((m) => isLiveMember(m as any));

  const rm = fam.rmId
    ? ((await tx.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, fam.rmId)).limit(1))[0] ?? null)
    : null;

  const head = fam.primaryInvestorId ? members.find((m) => m.id === fam.primaryInvestorId) ?? null : null;

  const memberIds = members.map((m) => m.id);
  const goalRows = memberIds.length === 0 ? [] : ((await tx.execute(sql`
      SELECT g.id, g.name, g.category, g.status, g.target_amount, g.current_value, g.expected_return,
             g.target_date, g.progress_pct, g.monthly_contribution, i.name AS member_name, i.id AS member_id
        FROM goals g JOIN investors i ON i.id = g.investor_id
       WHERE g.investor_id IN (${sql.join(memberIds.map((id) => sql`${id}::uuid`), sql`, `)})
         AND g.status NOT IN ('achieved', 'abandoned')
       ORDER BY g.target_date ASC NULLS LAST
    `)).rows as any[]);

  const totalAum = live.reduce((s, m) => s + Number(m.aum ?? 0), 0);
  const totalSip = live.reduce((s, m) => s + Number(m.activeSipAmount ?? 0), 0);
  // Only individuals nominate: an HUF, minor or entity is never a gap.
  const nominating = live.filter((m) => nominationApplies(m));
  const withNominee = nominating.filter((m) => !nomineeGap(m)).length;
  const nextGen = live.filter((m) => isNextGenProspect(m as any));

  return {
    family: fam,
    members,
    liveMembers: live,
    rm,
    head,
    goals: goalRows,
    nextGen,
    totals: {
      totalAum,
      totalSip,
      memberCount: live.length,
      membersWithNominee: withNominee,
      nomineePct: nominating.length ? Math.round((withNominee / nominating.length) * 100) : 100,
    },
  };
}

/**
 * Projected shortfall for a goal at its own expected return (10% when the
 * goal has none), compounding monthly. Pure.
 */
export function goalProjection(g: { target_amount: unknown; current_value: unknown; monthly_contribution: unknown; target_date: unknown; expected_return?: unknown }, now = new Date()) {
  const target = Number(g.target_amount ?? 0);
  const current = Number(g.current_value ?? 0);
  const sip = Number(g.monthly_contribution ?? 0);
  const date = g.target_date ? new Date(String(g.target_date)) : null;
  if (!date || isNaN(date.getTime()) || target <= 0) return { shortfall: 0, stepUp: 0 };
  const months = (date.getFullYear() - now.getFullYear()) * 12 + (date.getMonth() - now.getMonth());
  if (months <= 0) return { shortfall: Math.max(0, target - current), stepUp: 0 };
  const annual = Number(g.expected_return ?? 0) > 0 ? Number(g.expected_return) / 100 : 0.1;
  const r = annual / 12;
  const growth = Math.pow(1 + r, months);
  const projected = current * growth + sip * ((growth - 1) / r);
  if (projected >= target) return { shortfall: 0, stepUp: 0 };
  const shortfall = target - projected;
  return { shortfall, stepUp: (shortfall * r) / (growth - 1) };
}
