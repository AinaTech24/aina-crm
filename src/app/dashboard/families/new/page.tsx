/**
 * New family. `?investorId=` starts it with that client as head, the name
 * already filled from them.
 */

import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { loadViewableInvestor } from "@/lib/investors/access";
import { loadFamilySettings } from "@/lib/families/master";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { NewFamilyForm } from "@/components/families/NewFamilyForm";
import type { HeadCandidate } from "@/components/families/FamilyHeadPicker";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function NewFamilyPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await requireSession();
  const investorId = one((await searchParams).investorId);

  const { namePattern, head } = await withTenant(session.tenantId, async (tx) => {
    const settings = await loadFamilySettings(tx, session.tenantId);
    // Only a live client this person can open becomes the head; anything else
    // simply starts an empty form.
    const inv = /^[0-9a-f-]{36}$/i.test(investorId) ? await loadViewableInvestor(tx, session, investorId) : null;
    if (!inv || inv.mergedIntoId) return { namePattern: settings.familyNamePattern, head: null };
    const folios = await tx.execute(sql`SELECT count(*)::int AS n FROM folios WHERE investor_id = ${inv.id}::uuid`);
    const head: HeadCandidate = {
      id: inv.id,
      name: inv.name,
      pan: inv.pan ?? null,
      email: inv.email ?? null,
      phone: inv.phone ?? null,
      city: inv.address?.city ?? null,
      aum: Number(inv.aum ?? 0),
      folios: Number((folios.rows[0] as { n?: number } | undefined)?.n ?? 0),
    };
    return { namePattern: settings.familyNamePattern, head };
  }, { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles });

  return (
    <div className="space-y-4 max-w-2xl">
      <PageHeaderCard
        breadcrumb={[{ label: "Families", href: "/dashboard/families" }, { label: "New family" }]}
        title={<>New family</>}
      />
      <NewFamilyForm initialHead={head} namePattern={namePattern} />
    </div>
  );
}
