/**
 * Product / Services Offered — the firm's offering catalog.
 *
 * Used in two distinct contexts:
 *   - Compliance: SEBI inspection asks "what do you sell?" — this list
 *     is the answer + the licenses that back it.
 *   - Sales: when an RM talks to a new lead, "what can I actually
 *     pitch?" Surface the active catalog with regulators + team owners.
 */

import Link from "next/link";
import { Plus, Users as UsersIcon, FileText } from "lucide-react";
import { and, eq, inArray, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { productOfferings, users, legalRegistrations } from "@/db/schema";

export const dynamic = "force-dynamic";

const CATEGORY_LABELS: Record<string, string> = {
  mutual_funds: "Mutual Funds",
  insurance_life: "Insurance — Life",
  insurance_general: "Insurance — General",
  insurance_health: "Insurance — Health",
  pms: "PMS",
  aif: "AIF",
  bonds: "Bonds",
  corporate_fd: "Corporate FD",
  nps: "NPS",
  equity: "Equity",
  tax_planning: "Tax Planning",
  estate_planning: "Estate Planning",
  advisory: "Advisory",
  loans: "Loans",
  real_estate: "Real Estate",
  international: "International Investments",
  other: "Other",
};

const STATUS_TONE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  paused: "bg-amber-50 text-amber-700",
  discontinued: "bg-gray-100 text-gray-600",
};

export default async function ProductOfferingsListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; category?: string }>;
}) {
  const session = await requireSession();
  requireCap(session.roles, "compliance.edit");
  await assertActiveLicense(session.tenantId, session.roles);
  const sp = await searchParams;
  const statusFilter = sp.status ?? "active";
  const categoryFilter = sp.category ?? "all";

  const rows = await withTenant(session.tenantId, async (tx) => {
    const where = [eq(productOfferings.tenantId, session.tenantId)];
    if (statusFilter !== "all") {
      where.push(eq(productOfferings.status, statusFilter as any));
    }
    if (categoryFilter !== "all") {
      where.push(eq(productOfferings.category, categoryFilter as any));
    }
    return tx
      .select()
      .from(productOfferings)
      .where(and(...where))
      .orderBy(productOfferings.name);
  });

  // Resolve team-member display names + registration names for chips.
  const teamIds = new Set<string>();
  const regIds = new Set<string>();
  for (const r of rows) {
    for (const id of (r.teamMemberIds ?? []) as string[]) teamIds.add(id);
    for (const id of (r.linkedRegistrationIds ?? []) as string[]) regIds.add(id);
  }
  const { teamMap, regMap } = await withTenant(session.tenantId, async (tx) => {
    const teamMap = new Map<string, string>();
    const regMap = new Map<string, string>();
    if (teamIds.size > 0) {
      const members = await tx
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, [...teamIds]));
      for (const m of members) teamMap.set(m.id, m.name);
    }
    if (regIds.size > 0) {
      const regs = await tx
        .select({
          id: legalRegistrations.id,
          registrationFor: legalRegistrations.registrationFor,
        })
        .from(legalRegistrations)
        .where(inArray(legalRegistrations.id, [...regIds]));
      for (const r of regs) regMap.set(r.id, r.registrationFor);
    }
    return { teamMap, regMap };
  });

  // Counts for filter chips
  const counts = await withTenant(session.tenantId, async (tx) => {
    const r = await tx.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'active')::int AS active,
        COUNT(*) FILTER (WHERE status = 'paused')::int AS paused,
        COUNT(*) FILTER (WHERE status = 'discontinued')::int AS discontinued
      FROM product_offerings
      WHERE tenant_id = ${session.tenantId}
    `);
    return r.rows[0] as {
      total: number;
      active: number;
      paused: number;
      discontinued: number;
    };
  });

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Products &amp; services offered</h1>
          <p className="text-sm text-muted-foreground mt-1">
            What your firm actually sells. Each offering carries its
            regulator, the licenses that authorise it, and the team trained
            on it — single source of truth for SEBI / DDQ / lead-intake.
          </p>
        </div>
        <Link
          href="/dashboard/product-offerings/new"
          className="btn-primary text-sm"
        >
          <Plus className="size-4" /> Add offering
        </Link>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {[
          { value: "active", label: `Active · ${counts.active}` },
          { value: "paused", label: `Paused · ${counts.paused}` },
          {
            value: "discontinued",
            label: `Discontinued · ${counts.discontinued}`,
          },
          { value: "all", label: `All · ${counts.total}` },
        ].map((s) => (
          <Link
            key={s.value}
            href={`/dashboard/product-offerings?status=${s.value}${
              categoryFilter !== "all" ? `&category=${categoryFilter}` : ""
            }`}
            className={`chip text-xs ${
              statusFilter === s.value
                ? "bg-slate-900 text-white"
                : "bg-slate-100"
            }`}
          >
            {s.label}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="card-surface p-12 text-center">
          <p className="text-sm text-muted-foreground">
            No offerings with this filter yet.
          </p>
          <Link
            href="/dashboard/product-offerings/new"
            className="btn-primary text-sm mt-4"
          >
            <Plus className="size-4" /> Add the first offering
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {rows.map((r) => (
            <Link
              key={r.id}
              href={`/dashboard/product-offerings/${r.id}`}
              className="card-surface p-4 hover:bg-slate-50/60 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium">{r.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {CATEGORY_LABELS[r.category] ?? r.category} ·{" "}
                    {r.regulator}
                  </div>
                </div>
                <span
                  className={`chip text-[10px] shrink-0 ${
                    STATUS_TONE[r.status] ?? "bg-slate-100"
                  }`}
                >
                  {r.status}
                </span>
              </div>

              {((r.providers as string[]) ?? []).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {((r.providers as string[]) ?? []).slice(0, 5).map((p) => (
                    <span
                      key={p}
                      className="chip bg-slate-100 text-slate-700 text-[10px]"
                    >
                      {p}
                    </span>
                  ))}
                  {((r.providers as string[]) ?? []).length > 5 && (
                    <span className="text-[10px] text-muted-foreground">
                      +{((r.providers as string[]) ?? []).length - 5}
                    </span>
                  )}
                </div>
              )}

              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                <div className="text-muted-foreground">
                  <div className="font-semibold text-[10px] uppercase tracking-wide">
                    Licenses
                  </div>
                  <div className="mt-0.5 truncate">
                    {((r.linkedRegistrationIds as string[]) ?? [])
                      .map((id) => regMap.get(id))
                      .filter(Boolean)
                      .join(", ") || "—"}
                  </div>
                </div>
                <div className="text-muted-foreground">
                  <div className="font-semibold text-[10px] uppercase tracking-wide flex items-center gap-1">
                    <UsersIcon className="size-2.5" /> Team
                  </div>
                  <div className="mt-0.5 truncate">
                    {((r.teamMemberIds as string[]) ?? [])
                      .map((id) => teamMap.get(id))
                      .filter(Boolean)
                      .join(", ") || "—"}
                  </div>
                </div>
              </div>

              {((r.documents as any[]) ?? []).length > 0 && (
                <div className="mt-2 text-[10px] text-violet-700 inline-flex items-center gap-1">
                  <FileText className="size-2.5" />
                  {((r.documents as any[]) ?? []).length} document
                  {((r.documents as any[]) ?? []).length === 1 ? "" : "s"}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
