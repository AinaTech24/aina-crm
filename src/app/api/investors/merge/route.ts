import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/investors/merge  — merge a duplicate client into a survivor.
 *
 * Body: { survivorId, loserId }. Reassigns every child row that references the
 * loser to the survivor, fills the survivor's blank contact fields from the
 * loser, then marks the loser status='inactive' + merged_into_id=survivor.
 * Owner / branch-head only. One transaction, fully audited.
 *
 * Child reassignment is auto-discovered from information_schema (any table with
 * an `investor_id` column) so new modules are covered automatically — minus a
 * denylist of tables whose investor_id participates in a uniqueness constraint
 * the survivor may already satisfy (those records stay on the inactive loser).
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { recomputeInvestorAum } from "@/lib/finance/aum-persist";
import { recomputeInvestorHealth } from "@/lib/investors/health-persist";

export const dynamic = "force-dynamic";

const isManager = (roles: string[]) => roles.some((r) => ["owner", "branch_head"].includes(r));

// investor_id on these participates in a uniqueness / one-per-investor rule, or
// is consent/PII that shouldn't silently move; leave on the (inactive) loser.
/** Above this many moved rows we log counts only — see the un-merge note. */
const MOVED_ID_CAP = 20_000;

const DENYLIST = new Set(["investors", "consents", "communications", "campaigns", "risk_profiles", "onboarding"]);

const Body = z.object({
  survivorId: z.string().uuid(),
  loserId: z.string().uuid(),
  /** Why these two are the same person — the matched key ("PAN", "Mobile") from
   *  the suggestion list, or an operator's note. Recorded on the loser so the
   *  merged-clients audit can explain each row instead of just listing it. */
  reason: z.string().max(300).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!isManager(session.roles)) return NextResponse.json({ error: "only owners / branch heads can merge records" }, { status: 403 });
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const { survivorId, loserId } = parse.data;
    const mergeReason = parse.data.reason?.trim() || null;
    if (survivorId === loserId) return NextResponse.json({ error: "survivor and loser must differ" }, { status: 400 });
    const meta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(
      session.tenantId,
      async (tx) => {
        const both = await tx.execute(sql`
          SELECT id, name, merged_into_id, status,
                 COALESCE(aum::numeric, 0) AS aum,
                 COALESCE(active_sip_amount::numeric, 0) AS sip
            FROM investors
           WHERE tenant_id = ${session.tenantId}::uuid AND id IN (${survivorId}::uuid, ${loserId}::uuid)
        `);
        if (both.rows.length !== 2) return { error: "one or both clients not found" as const };
        if (both.rows.some((r: any) => r.merged_into_id)) return { error: "a selected record is already merged" as const };
        // Snapshot the loser as it stands. Its aum / sip are zeroed below (they
        // would double-count once its folios move), so without this an un-merge
        // could only restore the record at 0 — technically un-merged, visibly
        // wrong until the next nightly recompute.
        const loserRow = (both.rows as any[]).find((r) => String(r.id) === loserId);
        const loserAum = Number(loserRow?.aum ?? 0);
        const loserSip = Number(loserRow?.sip ?? 0);
        const loserStatus = loserRow?.status ?? null;

        // Tables that carry a tenant_id — used to scope the reassignment for
        // defense-in-depth (the loser UUID is already tenant-unique, but a
        // tenant filter is a cheap second line of defence).
        const tcols = await tx.execute(sql`
          SELECT table_name FROM information_schema.columns
          WHERE table_schema = 'public' AND column_name = 'tenant_id'
        `);
        const hasTenant = new Set((tcols.rows as Array<{ table_name: string }>).map((r) => r.table_name));
        const tf = (table: string) =>
          hasTenant.has(table) ? sql` AND tenant_id = ${session.tenantId}::uuid` : sql``;

        // Discover child tables that reference investor_id.
        const cols = await tx.execute(sql`
          SELECT table_name FROM information_schema.columns
          WHERE table_schema = 'public' AND column_name = 'investor_id'
        `);
        // Which child tables have their own `id`. `RETURNING id` on a table
        // without one raises, and the per-table SAVEPOINT below would swallow it
        // as a "skip" — silently leaving those rows on the loser when they used
        // to move. So ask first, and fall back to a plain UPDATE (count only,
        // not individually reversible) where there is no id to return.
        const idCols = await tx.execute(sql`
          SELECT table_name FROM information_schema.columns
          WHERE table_schema = 'public' AND column_name = 'id'
        `);
        const hasId = new Set((idCols.rows as Array<{ table_name: string }>).map((r) => r.table_name));

        let reassigned = 0;
        const skipped: string[] = [];
        // What moved, so the merge can be undone exactly. After the update the
        // loser's rows are indistinguishable from the survivor's own, so an
        // un-merge that GUESSED which to send back would move the wrong
        // holdings — recording ids at the moment they move is the only honest
        // way to offer a reversal.
        const moved: Record<string, string[]> = {};
        const movedCounts: Record<string, number> = {};
        let movedIdTotal = 0;
        let reversible = true;

        for (const row of cols.rows as Array<{ table_name: string }>) {
          const tbl = row.table_name;
          if (DENYLIST.has(tbl)) continue;
          // Per-table SAVEPOINT: if reassigning collides with a uniqueness rule
          // the survivor already satisfies, skip THAT table (its rows stay on the
          // inactive loser) instead of aborting the entire merge.
          await tx.execute(sql`SAVEPOINT merge_child`);
          try {
            const canReturn = hasId.has(tbl);
            const r = await tx.execute(
              canReturn
                ? sql`UPDATE ${sql.raw(`"${tbl}"`)} SET investor_id = ${survivorId}::uuid WHERE investor_id = ${loserId}::uuid${tf(tbl)} RETURNING id`
                : sql`UPDATE ${sql.raw(`"${tbl}"`)} SET investor_id = ${survivorId}::uuid WHERE investor_id = ${loserId}::uuid${tf(tbl)}`
            );
            const ids = canReturn ? (r.rows as Array<{ id: string }>).map((x) => String(x.id)) : [];
            const n = canReturn ? ids.length : ((r as any).rowCount ?? 0);
            reassigned += n;
            if (!canReturn && n > 0) reversible = false;
            if (n > 0) {
              movedCounts[tbl] = n;
              // Past the cap we keep counts only and mark the merge
              // irreversible. A 50k-transaction client would otherwise put a
              // megabyte of ids in one jsonb row, and an undo that half-works is
              // worse than one that says plainly it cannot.
              if (movedIdTotal + ids.length <= MOVED_ID_CAP) {
                moved[tbl] = ids;
                movedIdTotal += ids.length;
              } else {
                reversible = false;
              }
            }
            await tx.execute(sql`RELEASE SAVEPOINT merge_child`);
          } catch {
            await tx.execute(sql`ROLLBACK TO SAVEPOINT merge_child`);
            skipped.push(tbl);
          }
        }

        // Special columns the generic pass misses (tenant-scoped where possible).
        await tx.execute(sql`UPDATE leads SET referred_by_investor_id = ${survivorId}::uuid WHERE referred_by_investor_id = ${loserId}::uuid${tf("leads")}`);
        await tx.execute(sql`UPDATE leads SET converted_investor_id = ${survivorId}::uuid WHERE converted_investor_id = ${loserId}::uuid${tf("leads")}`);
        await tx.execute(sql`UPDATE families SET primary_investor_id = ${survivorId}::uuid WHERE primary_investor_id = ${loserId}::uuid${tf("families")}`);
        await tx.execute(sql`UPDATE activities SET subject_id = ${survivorId}::uuid WHERE subject_type = 'investor' AND subject_id = ${loserId}::uuid${tf("activities")}`);

        // Fill the survivor's blank contact fields from the loser.
        await tx.execute(sql`
          UPDATE investors s SET
            phone = COALESCE(s.phone, l.phone),
            email = COALESCE(s.email, l.email),
            whatsapp_phone = COALESCE(s.whatsapp_phone, l.whatsapp_phone),
            dob = COALESCE(s.dob, l.dob),
            updated_at = now()
          FROM investors l
          WHERE s.id = ${survivorId}::uuid AND l.id = ${loserId}::uuid
        `);

        // Retire the loser — and ZERO its cached headline figures.
        //
        // The loser's folios, transactions and SIPs have just been repointed to
        // the survivor, so its own aum / active_sip_amount are now double-counting
        // the same money. Nothing else clears them: `recomputeCombinedAum` has a
        // deliberate never-zero rule (an investor with no folio and no
        // transaction basis is left untouched rather than wiped), and a merged
        // loser is exactly that shape — so a stale figure here survives every
        // nightly recompute, permanently.
        //
        // It leaks wherever a query filters on deleted_at alone: the main
        // dashboard's AUM does (api/dashboard/home), while the client KPIs, the
        // AI snapshot and the firm snapshot all also filter status/merged_into_id
        // and were unaffected. Zeroing at the source fixes every reader at once.
        await tx.execute(sql`
          UPDATE investors
             SET status = 'inactive', merged_into_id = ${survivorId}::uuid, merged_at = now(),
                 merged_by_id = ${session.userId}::uuid, merge_source = 'manual',
                 merge_reason = ${mergeReason},
                 aum = 0, active_sip_amount = 0, updated_at = now()
           WHERE id = ${loserId}::uuid
        `);

        // Log the merge with everything needed to undo it.
        await tx.execute(sql`
          INSERT INTO investor_merges (
            tenant_id, survivor_id, loser_id, merged_by_id, source, reason,
            loser_aum, loser_sip_amount, loser_status,
            moved, moved_counts, reversible
          ) VALUES (
            ${session.tenantId}::uuid, ${survivorId}::uuid, ${loserId}::uuid,
            ${session.userId}::uuid, 'manual', ${mergeReason},
            ${loserAum}, ${loserSip}, ${loserStatus},
            ${JSON.stringify(moved)}::jsonb, ${JSON.stringify(movedCounts)}::jsonb, ${reversible}
          )
        `);

        // The survivor just absorbed the loser's folios / transactions / SIPs —
        // refresh its cached headline figures (aum, active SIP) and health so the
        // client list, KPI strip and scorecards don't show stale numbers until
        // the nightly recompute. Both losers' rows are now off the survivor.
        await recomputeInvestorAum(tx, survivorId);
        await recomputeInvestorHealth(tx, survivorId);

        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "investor.merge",
          entityType: "investor",
          entityId: survivorId,
          after: { survivorId, loserId, childRowsReassigned: reassigned, skippedTables: skipped } as any,
          ...meta,
        });
        return { ok: true as const, reassigned, skipped };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    const errMsg = "error" in result ? result.error : null;
    if (errMsg) return NextResponse.json({ error: errMsg }, { status: errMsg.includes("not found") ? 404 : 409 });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
