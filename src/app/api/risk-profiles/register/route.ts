/**
 * GET /api/risk-profiles/register?filter=&q=&page=&rm=&branch=
 *
 * The Risk Profiles page's list as JSON, for the mobile app: the five tab
 * counts plus one page of clients, built from the SAME pieces the web page
 * (/dashboard/risk-profiles) uses — riskProfileBaseSql (active clients, an
 * RM's own book without firm-wide view), investorScopeSql, riskBucketSql and
 * riskBucketCaseSql — so a tab's count is the list's row count on both.
 *
 *   filter  a bucket, or several csv (`due,expired`, a dashboard drill-down);
 *           `all` lists every bucket (the app's client picker). Default
 *           not_profiled, as on the web.
 *   q       client name or PAN; narrows the counts too.
 *
 * The raw PAN column never leaves the server (it can hold an import key); a
 * real PAN goes out masked.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny, can } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { investorScopeSql } from "@/lib/investors/access";
import { RISK_BUCKETS, parseRiskBucket, riskBucketSql, riskBucketCaseSql, type RiskBucket } from "@/lib/risk-profile/buckets";
import { riskExpiresOnSql } from "@/lib/risk-profile/expiry";
import { displayPan, isMinorKey } from "@/lib/investors/pan-display";
import { riskProfileBaseSql } from "@/lib/metrics/risk";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/** Each tab's order, most actionable first (the web page's orderClause). */
function orderClause(key: RiskBucket | "all") {
  if (key === "current") return sql`i.risk_profile_signed_at DESC NULLS LAST`;
  if (key === "due" || key === "expired") return sql`i.risk_profile_signed_at ASC`;
  // Every bucket (the new-profile picker): never profiled first, then the longest since signing.
  if (key === "all") return sql`i.risk_profile_signed_at ASC NULLS FIRST, i.name ASC`;
  return sql`i.name ASC`;
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
    const canViewAll = can(session.roles, "investor.view.all", session.permissions);
    const sp = req.nextUrl.searchParams;
    const raw = (sp.get("filter") ?? "").split(",").map((f) => f.trim()).filter(Boolean);
    const all = raw.includes("all");
    const filters = [...new Set(raw.filter((f) => RISK_BUCKETS.some((b) => b.key === f)))] as RiskBucket[];
    const first = all ? "all" : filters[0] ?? parseRiskBucket(raw[0]);
    const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
    const q = (sp.get("q") ?? "").trim().slice(0, 80);
    const rm = sp.get("rm");
    const branch = sp.get("branch");

    const data = await withTenant(
      session.tenantId,
      async (tx) => {
        const baseOnly = riskProfileBaseSql({
          tenantId: session.tenantId,
          rmIds: canViewAll ? (rm ? rm.split(",") : undefined) : [session.userId],
          branchIds: branch ? branch.split(",") : undefined,
        });
        const base = sql`(${baseOnly} AND ${await investorScopeSql(tx, session, "i")})`;
        const search = q ? sql`(i.name ILIKE ${`%${q}%`} OR i.pan ILIKE ${`%${q.toUpperCase()}%`})` : sql`TRUE`;

        const countsOf = async (where: ReturnType<typeof sql>) => {
          const r = (await tx.execute(sql`
            SELECT
              COUNT(*) FILTER (WHERE ${riskBucketSql("not_profiled")})::int AS not_profiled,
              COUNT(*) FILTER (WHERE ${riskBucketSql("due")})::int AS due,
              COUNT(*) FILTER (WHERE ${riskBucketSql("current")})::int AS current,
              COUNT(*) FILTER (WHERE ${riskBucketSql("expired")})::int AS expired,
              COUNT(*) FILTER (WHERE ${riskBucketSql("awaiting")})::int AS awaiting
            FROM investors i WHERE ${base} AND ${where}
          `)).rows[0] as Partial<Record<RiskBucket, number>> | undefined;
          return Object.fromEntries(RISK_BUCKETS.map((b) => [b.key, Number(r?.[b.key] ?? 0)])) as Record<RiskBucket, number>;
        };
        const counts = await countsOf(search);
        // "Send the link to all not profiled" ignores a search, as the server's audience does.
        const notProfiledAll = q ? (await countsOf(sql`TRUE`)).not_profiled : counts.not_profiled;

        const predicate = all
          ? sql`TRUE`
          : filters.length > 1
            ? sql`(${sql.join(filters.map((f) => riskBucketSql(f)), sql` OR `)})`
            : riskBucketSql(first as RiskBucket);
        const total = all
          ? Object.values(counts).reduce((s, n) => s + n, 0)
          : filters.length > 1
            ? filters.reduce((s, f) => s + counts[f], 0)
            : counts[first as RiskBucket];

        const rows = await tx.execute(sql`
          SELECT
            i.id, i.name, i.pan, i.avatar_url, i.risk_profile, i.risk_profile_signed_at, i.risk_profile_score,
            i.risk_profile_provisional, i.is_minor, i.investor_category, i.guardian_investor_id,
            ${riskExpiresOnSql()} AS expires_on,
            ${riskBucketCaseSql()} AS bucket,
            rp.id AS profile_id, rp.total_score, rp.next_review_at, rp.document_url
          FROM investors i
          LEFT JOIN LATERAL (
            SELECT id, total_score, next_review_at, document_url
            FROM risk_profile_responses r
            WHERE r.investor_id = i.id
            ORDER BY r.signed_at DESC NULLS LAST
            LIMIT 1
          ) rp ON TRUE
          WHERE ${base} AND ${search} AND ${predicate}
          ORDER BY ${orderClause(first)}
          LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}
        `);

        return {
          counts,
          notProfiledAll,
          total,
          page,
          pageSize: PAGE_SIZE,
          rows: (rows.rows as any[]).map((r) => ({
            id: r.id,
            name: r.name ?? "",
            pan: displayPan(r.pan),
            avatarUrl: r.avatar_url ?? null,
            category: r.risk_profile ?? null,
            provisional: r.risk_profile_provisional === true,
            signedAt: r.risk_profile_signed_at ?? null,
            expiresOn: r.expires_on ? String(r.expires_on instanceof Date ? r.expires_on.toISOString() : r.expires_on).slice(0, 10) : null,
            score: r.total_score ?? r.risk_profile_score ?? null,
            nextReviewAt: r.next_review_at ?? null,
            isMinor: r.is_minor === true || isMinorKey(r.pan),
            // A minor linked to a guardian: the profile is the guardian's.
            guardianId: r.investor_category === "minor" && r.guardian_investor_id ? r.guardian_investor_id : null,
            bucket: r.bucket as RiskBucket,
            profileId: r.profile_id ?? null,
            hasDocument: !!r.document_url,
          })),
        };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles },
    );

    return NextResponse.json(data);
  } catch (err: any) {
    return handleApiError(err);
  }
}
