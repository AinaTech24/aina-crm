/**
 * Fixed deposits — reads and writes. Reading follows the client: a deposit is
 * visible to whoever may see its client (lib/investors/access.ts), so every
 * list joins investors and applies `investorScopeSql`. Writes need a client
 * edit capability and a client the writer can see.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { fixedDeposits, type FixedDeposit } from "@/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { investorScopeSql, loadViewableInvestor } from "@/lib/investors/access";
import { recordAudit } from "@/lib/audit";
import { computeMaturity, indiaToday, tenureBetween } from "./terms";
import { syncFdAutomations } from "./hooks";
import type { FdInput, FdPatch } from "./schema";

export function canEditFds(session: SessionUser): boolean {
  return (["investor.edit.all", "investor.edit.assigned"] as const).some((c) => can(session.roles, c, session.permissions));
}

export function requireEditFds(session: SessionUser) {
  if (!canEditFds(session)) throw Object.assign(new Error("You don't have permission to record fixed deposits."), { status: 403 });
}

const num = (n: number | null | undefined) => (n == null ? null : String(n));

/** Tenure and maturity amount, derived where the input left them out. */
function derive(v: {
  depositDate: string; maturityDate: string; principal: number; interestRate: number;
  payout: string; compounding: string; maturityAmount?: number | null;
}) {
  const t = tenureBetween(v.depositDate, v.maturityDate);
  const computed = computeMaturity({
    principal: v.principal, rate: v.interestRate, depositDate: v.depositDate, maturityDate: v.maturityDate,
    payout: v.payout, compounding: v.compounding,
  });
  const entered = v.maturityAmount != null && v.maturityAmount > 0;
  return {
    tenureMonths: t.months,
    tenureDays: t.days,
    maturityAmount: entered ? String(v.maturityAmount) : computed ? String(computed.maturityAmount) : null,
    maturityAmountEntered: entered,
  };
}

/** The deposit, if the viewer can see its client — else null (callers answer 404). */
export async function loadViewableFd(tx: Tx, session: SessionUser, id: string): Promise<FixedDeposit | null> {
  const [fd] = await tx.select().from(fixedDeposits).where(and(
    eq(fixedDeposits.tenantId, session.tenantId), eq(fixedDeposits.id, id), isNull(fixedDeposits.deletedAt),
  )).limit(1);
  if (!fd) return null;
  return (await loadViewableInvestor(tx, session, fd.investorId)) ? fd : null;
}

export async function createFd(tx: Tx, session: SessionUser, input: FdInput) {
  const client = await loadViewableInvestor(tx, session, input.investorId);
  if (!client) return { error: "Client not found", status: 404 as const };

  const [fd] = await tx.insert(fixedDeposits).values({
    tenantId: session.tenantId,
    investorId: input.investorId,
    rmId: input.rmId ?? client.rmId ?? session.userId,
    issuer: input.issuer,
    issuerType: input.issuerType,
    schemeName: input.schemeName || null,
    fdNumber: input.fdNumber || null,
    depositDate: input.depositDate,
    maturityDate: input.maturityDate,
    principal: String(input.principal),
    interestRate: String(input.interestRate),
    payout: input.payout,
    compounding: input.compounding,
    ...derive(input),
    holding: input.holding,
    jointHolders: input.holding === "single" ? null : input.jointHolders || null,
    nomineeName: input.nomineeName || null,
    seniorCitizen: input.seniorCitizen,
    taxForm: input.taxForm,
    autoRenew: input.autoRenew,
    status: input.status,
    closedOn: input.closedOn || null,
    renewedFromId: input.renewedFromId || null,
    commissionRate: num(input.commissionRate),
    commissionAmount: num(input.commissionAmount),
    remarks: input.remarks || null,
    createdBy: session.userId,
  } as any).returning();

  // Renewing: the deposit it replaces is now "renewed".
  if (input.renewedFromId) {
    const prev = await loadViewableFd(tx, session, input.renewedFromId);
    if (prev && prev.status !== "renewed") {
      const [p] = await tx.update(fixedDeposits)
        .set({ status: "renewed", closedOn: input.depositDate, updatedAt: new Date() })
        .where(eq(fixedDeposits.id, prev.id)).returning();
      await syncFdAutomations(tx, session, p);
    }
  }

  await syncFdAutomations(tx, session, fd);
  await recordAudit(tx, {
    tenantId: session.tenantId, actorUserId: session.userId, action: "fixed_deposit.create",
    entityType: "fixed_deposit", entityId: fd.id,
    after: { investorId: fd.investorId, issuer: fd.issuer, principal: fd.principal, maturityDate: fd.maturityDate, status: fd.status },
  } as any);
  return { fd };
}

export async function updateFd(tx: Tx, session: SessionUser, id: string, patch: FdPatch) {
  const before = await loadViewableFd(tx, session, id);
  if (!before) return { error: "Fixed deposit not found", status: 404 as const };

  const merged = {
    depositDate: patch.depositDate ?? String(before.depositDate),
    maturityDate: patch.maturityDate ?? String(before.maturityDate),
    principal: patch.principal ?? Number(before.principal),
    interestRate: patch.interestRate ?? Number(before.interestRate),
    payout: patch.payout ?? before.payout,
    compounding: patch.compounding ?? before.compounding,
    // An entered amount survives an edit unless the edit clears it (null).
    maturityAmount: patch.maturityAmount !== undefined
      ? patch.maturityAmount
      : before.maturityAmountEntered ? Number(before.maturityAmount) : null,
  };
  if (merged.maturityDate <= merged.depositDate) return { error: "Maturity must be after the deposit date", status: 400 as const };
  if (merged.payout === "cumulative" && merged.maturityAmount != null && merged.maturityAmount > 0 && merged.maturityAmount < merged.principal) {
    return { error: "The maturity amount cannot be less than the amount deposited", status: 400 as const };
  }

  const set: Record<string, unknown> = { updatedAt: new Date(), ...derive(merged) };
  for (const k of ["rmId", "issuer", "issuerType", "schemeName", "fdNumber", "depositDate", "maturityDate", "payout",
    "compounding", "holding", "jointHolders", "nomineeName", "seniorCitizen", "taxForm", "autoRenew", "status",
    "closedOn", "remarks"] as const) {
    if (patch[k] !== undefined) set[k] = patch[k] === "" ? null : patch[k];
  }
  for (const k of ["principal", "interestRate", "commissionRate", "commissionAmount"] as const) {
    if (patch[k] !== undefined) set[k] = num(patch[k]);
  }
  // Closing a deposit dates it; reopening one clears the date.
  const status = (patch.status ?? before.status) as string;
  if (["matured", "closed_early", "renewed"].includes(status) && !set.closedOn && !before.closedOn) {
    set.closedOn = status === "matured" ? merged.maturityDate : indiaToday();
  }
  if (["applied", "active"].includes(status)) set.closedOn = null;
  if ((patch.holding ?? before.holding) === "single") set.jointHolders = null;

  const [fd] = await tx.update(fixedDeposits).set(set as any).where(eq(fixedDeposits.id, id)).returning();
  await syncFdAutomations(tx, session, fd);
  await recordAudit(tx, {
    tenantId: session.tenantId, actorUserId: session.userId, action: "fixed_deposit.update",
    entityType: "fixed_deposit", entityId: id,
    before: { status: before.status, principal: before.principal, maturityDate: before.maturityDate, maturityAmount: before.maturityAmount },
    after: { status: fd.status, principal: fd.principal, maturityDate: fd.maturityDate, maturityAmount: fd.maturityAmount },
  } as any);
  return { fd };
}

export async function deleteFd(tx: Tx, session: SessionUser, id: string) {
  const before = await loadViewableFd(tx, session, id);
  if (!before) return { error: "Fixed deposit not found", status: 404 as const };
  const [fd] = await tx.update(fixedDeposits).set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(fixedDeposits.id, id)).returning();
  await syncFdAutomations(tx, session, fd, { deleted: true });
  await recordAudit(tx, {
    tenantId: session.tenantId, actorUserId: session.userId, action: "fixed_deposit.delete",
    entityType: "fixed_deposit", entityId: id, before: { issuer: before.issuer, principal: before.principal },
  } as any);
  return { ok: true as const };
}

/* ─────────────────────────────── lists ─────────────────────────────── */

export type FdFilters = {
  investorId?: string | null;
  /** live (applied + active, default) · all · a single status */
  status?: string | null;
  /** maturing within N days (live deposits only) */
  within?: number | null;
  issuerType?: string | null;
  rmId?: string | null;
  q?: string | null;
};

export type FdRow = {
  id: string;
  investorId: string;
  investorName: string;
  rmId: string | null;
  rmName: string | null;
  issuer: string;
  issuerType: string;
  schemeName: string | null;
  fdNumber: string | null;
  depositDate: string;
  maturityDate: string;
  tenureMonths: number | null;
  tenureDays: number | null;
  principal: number;
  interestRate: number;
  payout: string;
  maturityAmount: number | null;
  status: string;
  autoRenew: boolean;
  seniorCitizen: boolean;
  taxForm: string;
};

export type FdTotals = {
  liveCount: number;
  livePrincipal: number;
  liveMaturity: number;
  maturing30: number;
  maturing30Amount: number;
  maturing90: number;
  maturing90Amount: number;
  /** Live deposits whose maturity date has passed — the status needs updating. */
  overdue: number;
  clients: number;
};

const LIVE = sql`f.status IN ('applied', 'active')`;

export async function listFds(tx: Tx, session: SessionUser, f: FdFilters = {}): Promise<{ rows: FdRow[]; totals: FdTotals }> {
  const scope = await investorScopeSql(tx, session, "i");
  const today = indiaToday();
  const base = sql`f.tenant_id = ${session.tenantId}::uuid AND f.deleted_at IS NULL AND i.deleted_at IS NULL AND ${scope}`;

  const conds = [base];
  if (f.investorId) conds.push(sql`f.investor_id = ${f.investorId}::uuid`);
  const st = f.status || "live";
  if (st === "live") conds.push(LIVE);
  else if (st !== "all") conds.push(sql`f.status = ${st}`);
  if (f.within) conds.push(sql`${LIVE} AND f.maturity_date BETWEEN ${today}::date AND ${today}::date + ${f.within}::int`);
  if (f.issuerType) conds.push(sql`f.issuer_type = ${f.issuerType}`);
  if (f.rmId) conds.push(sql`f.rm_id = ${f.rmId}::uuid`);
  if (f.q?.trim()) {
    const like = `%${f.q.trim()}%`;
    conds.push(sql`(i.name ILIKE ${like} OR f.issuer ILIKE ${like} OR f.fd_number ILIKE ${like} OR f.scheme_name ILIKE ${like})`);
  }
  const where = sql.join(conds, sql` AND `);

  const rows = (await tx.execute(sql`
    SELECT f.id, f.investor_id, i.name AS investor_name, f.rm_id, u.name AS rm_name, f.issuer, f.issuer_type,
           f.scheme_name, f.fd_number, f.deposit_date::text, f.maturity_date::text, f.tenure_months, f.tenure_days,
           f.principal, f.interest_rate, f.payout, f.maturity_amount, f.status, f.auto_renew, f.senior_citizen, f.tax_form
      FROM fixed_deposits f
      JOIN investors i ON i.id = f.investor_id
      LEFT JOIN users u ON u.id = f.rm_id
     WHERE ${where}
     ORDER BY CASE WHEN f.status IN ('applied', 'active') THEN 0 ELSE 1 END, f.maturity_date ASC, f.created_at DESC
     LIMIT 1000
  `)).rows as Array<Record<string, any>>;

  // Totals describe the whole viewable book (or the one client), not the filtered list.
  const tWhere = f.investorId ? sql`${base} AND f.investor_id = ${f.investorId}::uuid` : base;
  const t = (await tx.execute(sql`
    SELECT
      count(*) FILTER (WHERE ${LIVE})::int AS live_count,
      COALESCE(sum(f.principal) FILTER (WHERE ${LIVE}), 0) AS live_principal,
      COALESCE(sum(COALESCE(f.maturity_amount, f.principal)) FILTER (WHERE ${LIVE}), 0) AS live_maturity,
      count(*) FILTER (WHERE ${LIVE} AND f.maturity_date BETWEEN ${today}::date AND ${today}::date + 30)::int AS m30,
      COALESCE(sum(COALESCE(f.maturity_amount, f.principal)) FILTER (WHERE ${LIVE} AND f.maturity_date BETWEEN ${today}::date AND ${today}::date + 30), 0) AS m30_amt,
      count(*) FILTER (WHERE ${LIVE} AND f.maturity_date BETWEEN ${today}::date AND ${today}::date + 90)::int AS m90,
      COALESCE(sum(COALESCE(f.maturity_amount, f.principal)) FILTER (WHERE ${LIVE} AND f.maturity_date BETWEEN ${today}::date AND ${today}::date + 90), 0) AS m90_amt,
      count(*) FILTER (WHERE ${LIVE} AND f.maturity_date < ${today}::date)::int AS overdue,
      count(DISTINCT f.investor_id) FILTER (WHERE ${LIVE})::int AS clients
      FROM fixed_deposits f JOIN investors i ON i.id = f.investor_id
     WHERE ${tWhere}
  `)).rows[0] as Record<string, any>;

  return {
    rows: rows.map((r) => ({
      id: r.id, investorId: r.investor_id, investorName: r.investor_name, rmId: r.rm_id, rmName: r.rm_name,
      issuer: r.issuer, issuerType: r.issuer_type, schemeName: r.scheme_name, fdNumber: r.fd_number,
      depositDate: r.deposit_date, maturityDate: r.maturity_date, tenureMonths: r.tenure_months, tenureDays: r.tenure_days,
      principal: Number(r.principal), interestRate: Number(r.interest_rate), payout: r.payout,
      maturityAmount: r.maturity_amount == null ? null : Number(r.maturity_amount), status: r.status,
      autoRenew: !!r.auto_renew, seniorCitizen: !!r.senior_citizen, taxForm: r.tax_form,
    })),
    totals: {
      liveCount: Number(t?.live_count ?? 0),
      livePrincipal: Number(t?.live_principal ?? 0),
      liveMaturity: Number(t?.live_maturity ?? 0),
      maturing30: Number(t?.m30 ?? 0),
      maturing30Amount: Number(t?.m30_amt ?? 0),
      maturing90: Number(t?.m90 ?? 0),
      maturing90Amount: Number(t?.m90_amt ?? 0),
      overdue: Number(t?.overdue ?? 0),
      clients: Number(t?.clients ?? 0),
    },
  };
}

/** People an FD can be assigned to — active staff, by name. */
export async function listFdStaff(tx: Tx, tenantId: string): Promise<Array<{ id: string; name: string }>> {
  return (await tx.execute(sql`
    SELECT id, name FROM users
     WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL AND status IN ('active', 'invited')
       AND NOT ('investor' = ANY(COALESCE(roles, ARRAY[]::text[])))
     ORDER BY name
  `)).rows as Array<{ id: string; name: string }>;
}
