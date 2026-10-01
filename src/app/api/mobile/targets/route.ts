import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type Tx } from "@/db/client";
import { requireSession, type SessionUser } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { mobileFirmAccess } from "@/lib/mobile/access";
import { MOBILE_METRICS, targetPeriod } from "@/lib/mobile/targets";
import { recordAudit } from "@/lib/audit";

async function choices(tx: Tx, s: SessionUser) {
  const firm = mobileFirmAccess(s), branch = s.roles.includes("branch_head");
  const members = (await tx.execute(sql`SELECT id, name FROM users WHERE tenant_id = ${s.tenantId}::uuid AND status = 'active'
    AND ${firm ? sql`TRUE` : branch ? s.branchId ? sql`branch_id = ${s.branchId}::uuid` : sql`FALSE` : sql`id = ${s.userId}::uuid`} ORDER BY name`)).rows as { id: string; name: string }[];
  const branches = firm || branch ? (await tx.execute(sql`SELECT id, name FROM branches WHERE tenant_id = ${s.tenantId}::uuid
    AND ${firm ? sql`TRUE` : s.branchId ? sql`id = ${s.branchId}::uuid` : sql`FALSE`} ORDER BY name`)).rows as { id: string; name: string }[] : [];
  return { members, branches };
}
export async function GET(req: Request) {
  try {
    const s = await requireSession(), p = new URL(req.url).searchParams;
    if (!s.roles.some(r => ["owner", "branch_head", "rm", "ops", "back_office"].includes(r))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const period = p.get("period") || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" }).format(new Date());
    const dates = targetPeriod(period), scopeType = p.get("scopeType") === "branch" ? "branch" : "user";
    const result = await withTenant(s.tenantId, async tx => {
      const options = await choices(tx, s);
      const scopeId = p.get("scopeId") || (scopeType === "branch" ? options.branches[0]?.id : s.userId);
      if (!(scopeType === "branch" ? options.branches : options.members).some(r => r.id === scopeId)) throw Object.assign(new Error("Target scope is not available to you"), { status: 403 });
      const ownerScope = (column: string) => scopeType === "user" ? sql`${sql.raw(column)} = ${scopeId}::uuid`
        : sql`${sql.raw(column)} IN (SELECT id FROM users WHERE tenant_id = ${s.tenantId}::uuid AND branch_id = ${scopeId}::uuid)`;
      const meetings = (await tx.execute(sql`SELECT count(*) FILTER (WHERE category = 'new')::int AS new_meetings,
        count(*) FILTER (WHERE category = 'review')::int AS review_meetings FROM review_meetings
        WHERE tenant_id = ${s.tenantId}::uuid AND status = 'completed' AND ${ownerScope("rm_id")}
        AND (meeting_date AT TIME ZONE 'Asia/Kolkata')::date >= ${dates.start}::date AND (meeting_date AT TIME ZONE 'Asia/Kolkata')::date < ${dates.end}::date`)).rows[0];
      const mf = (await tx.execute(sql`SELECT
        COALESCE(sum(CASE WHEN l.txn_type IN ('sip','sip_topup') THEN l.amount / CASE l.frequency WHEN 'quarterly' THEN 3 WHEN 'half_yearly' THEN 6 WHEN 'yearly' THEN 12 WHEN 'weekly' THEN 12.0/52 ELSE 1 END ELSE 0 END),0) AS sip,
        COALESCE(sum(l.amount) FILTER (WHERE l.txn_type IN ('lumpsum','additional_purchase')),0) AS lumpsum,
        COALESCE(sum(l.amount) FILTER (WHERE l.txn_type IN ('lumpsum','additional_purchase','sip','sip_topup')),0) AS mf_business
        FROM business_entries e JOIN business_entry_lines l ON l.entry_id = e.id AND l.tenant_id = e.tenant_id
        WHERE e.tenant_id = ${s.tenantId}::uuid AND e.product_type = 'mutual_fund' AND e.status IN ('confirmed','emailed')
          AND ${ownerScope("e.rm_id")} AND e.business_date >= ${dates.start}::date AND e.business_date < ${dates.end}::date`)).rows[0];
      const insurance = (await tx.execute(sql`SELECT COALESCE(sum(annual_premium),0) AS insurance_premium, count(*)::int AS insurance_policies
        FROM insurance_policies WHERE tenant_id = ${s.tenantId}::uuid AND status NOT IN ('cancelled','proposed','in_underwriting')
        AND ${ownerScope("sold_by_user_id")} AND policy_start_date >= ${dates.start}::date AND policy_start_date < ${dates.end}::date`)).rows[0];
      const targets = scopeType === "user" ? (await tx.execute(sql`SELECT metric_key, annual_target AS value FROM kra_targets
        WHERE tenant_id = ${s.tenantId}::uuid AND user_id = ${scopeId}::uuid AND fiscal_year = ${dates.fiscalYear} AND metric_key LIKE ${`${dates.prefix}%`}`)).rows
        : (await tx.execute(sql`SELECT metric_key, target_value AS value FROM annual_targets WHERE tenant_id = ${s.tenantId}::uuid
          AND scope_type = 'branch' AND scope_id = ${scopeId}::uuid AND fiscal_year = ${dates.fiscalYear} AND metric_key LIKE ${`${dates.prefix}%`}`)).rows;
      const actuals = { ...meetings, ...mf, ...insurance };
      return { ...options, scopeId, scopeType, period, canEdit: s.roles.some(r => ["owner", "branch_head"].includes(r)),
        metrics: MOBILE_METRICS.map(m => ({ ...m, actual: Number(actuals[m.key] || 0), target: targets.find(t => t.metric_key === dates.prefix + m.key)?.value ?? null })) };
    }, { userId: s.userId, branchId: s.branchId, roles: s.roles });
    return NextResponse.json(result);
  } catch (e) { return handleApiError(e); }
}
const Scope = z.object({ period: z.string(), scopeType: z.enum(["user", "branch"]), scopeId: z.string().uuid() });
const Metric = z.object({ metric: z.string(), target: z.number().min(0).max(1e12) });
// Keep the single-metric contract for installed older APKs.
const Body = z.union([Scope.extend({ metrics: z.array(Metric).min(1).max(20) }), Scope.merge(Metric).transform(({ metric, target, ...scope }) => ({ ...scope, metrics: [{ metric, target }] }))]);
export async function POST(req: Request) {
  try {
    const s = await requireSession();
    if (!s.roles.some(r => ["owner", "branch_head"].includes(r))) return NextResponse.json({ error: "Only Owner and Branch Head can set targets" }, { status: 403 });
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid target" }, { status: 400 });
    const b = parsed.data, dates = targetPeriod(b.period);
    if (new Set(b.metrics.map(m => m.metric)).size !== b.metrics.length || b.metrics.some(item => { const metric = MOBILE_METRICS.find(m => m.key === item.metric); return !metric || (metric.unit === "count" && !Number.isInteger(item.target)); })) return NextResponse.json({ error: "Invalid metric or count" }, { status: 400 });
    await withTenant(s.tenantId, async tx => {
      const options = await choices(tx, s);
      if (!(b.scopeType === "branch" ? options.branches : options.members).some(r => r.id === b.scopeId)) throw Object.assign(new Error("Scope is not available to you"), { status: 403 });
      // Stable lock order avoids deadlocks between overlapping batches.
      for (const item of [...b.metrics].sort((a, b) => a.metric.localeCompare(b.metric))) {
      const key = dates.prefix + item.metric;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${s.tenantId}:${b.scopeType}:${b.scopeId}:${key}`},0))`);
      if (b.scopeType === "user") await tx.execute(sql`INSERT INTO kra_targets (tenant_id,user_id,fiscal_year,metric_key,annual_target,updated_by)
        VALUES (${s.tenantId}::uuid,${b.scopeId}::uuid,${dates.fiscalYear},${key},${item.target},${s.userId}::uuid)
        ON CONFLICT (tenant_id,user_id,fiscal_year,metric_key) DO UPDATE SET annual_target=excluded.annual_target, updated_by=excluded.updated_by, updated_at=now()`);
      else {
        const existing = (await tx.execute(sql`SELECT id FROM annual_targets WHERE tenant_id=${s.tenantId}::uuid AND scope_type='branch'
          AND scope_id=${b.scopeId}::uuid AND metric_key=${key} AND fiscal_year=${dates.fiscalYear}`)).rows[0];
        if (existing) await tx.execute(sql`UPDATE annual_targets SET target_value=${item.target}, updated_at=now() WHERE id=${existing.id}::uuid AND tenant_id=${s.tenantId}::uuid`);
        else await tx.execute(sql`INSERT INTO annual_targets (tenant_id,scope_type,scope_id,metric_key,fiscal_year,target_value)
          VALUES (${s.tenantId}::uuid,'branch',${b.scopeId}::uuid,${key},${dates.fiscalYear},${item.target})`);
      }
      }
      await recordAudit(tx, { tenantId: s.tenantId, actorUserId: s.userId, action: "mobile_target.set", entityType: "target", entityId: b.scopeId, after: b });
    }, { userId: s.userId, branchId: s.branchId, roles: s.roles });
    return NextResponse.json({ ok: true });
  } catch (e) { return handleApiError(e); }
}
