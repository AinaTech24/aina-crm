import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
/**
 * Create-goal page — picks an investor + collects target amount/year + computes
 * Required SIP / Gap live as the user types.
 *
 *   /dashboard/goals/new                    → step 1: choose the client (?q= searches)
 *   /dashboard/goals/new?investorId=<id>    → step 2: the goal type, then the form
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, isNull, sql } from "drizzle-orm";
import { ChevronLeft, Search, Target } from "lucide-react";
import { withTenant } from "@/db/client";
import { investors } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { GoalCreateForm } from "@/components/goal-planning/GoalCreateForm";
import { InlineEmpty } from "@/components/common/EmptyState";
import { buttonClass } from "@/components/ui/button-class";
import { displayPan } from "@/lib/investors/pan-display";
import { goalClientScopeSql } from "@/lib/goal-planning/access";

const PICKER_LIMIT = 50;

export const dynamic = "force-dynamic";

export default async function NewGoalPage({
  searchParams,
}: {
  searchParams: Promise<{ investorId?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const session = await requireSession();

  if (!sp.investorId) {
    // Search the whole book: the old list stopped at the first 200 names, so
    // most clients of a large firm could not be picked at all. An RM sees
    // their own clients, as on the Goals list.
    const q = (sp.q ?? "").trim().slice(0, 80);
    const seesAll = can(session.roles, "investor.view.all", session.permissions);
    const { list, more } = await withTenant(session.tenantId, async (tx) => {
      const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const r = await tx.execute(sql`
        SELECT id, name, pan, segment_tag,
          (SELECT COUNT(*)::int FROM goals WHERE investor_id = investors.id) AS goal_count
        FROM investors WHERE status = 'active' AND deleted_at IS NULL
          ${seesAll ? sql`` : sql`AND rm_id = ${session.userId}::uuid`}
          AND ${await goalClientScopeSql(tx, session, "investors")}
          ${q ? sql`AND (name ILIKE ${like} OR pan ILIKE ${like})` : sql``}
        ORDER BY name LIMIT ${PICKER_LIMIT + 1}
      `);
      const rows = r.rows as Array<{ id: string; name: string; pan: string | null; segment_tag: string | null; goal_count: number }>;
      return { list: rows.slice(0, PICKER_LIMIT), more: rows.length > PICKER_LIMIT };
    });

    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <Link
          href="/dashboard/goals"
          className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
        >
          <ChevronLeft className="size-4" /> Back to goals
        </Link>
        <PageHeaderCard
          title={<>New goal</>}
        />
        <form method="get" className="flex gap-2" role="search">
          <label htmlFor="goal-client-q" className="sr-only">Search clients by name or PAN</label>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              id="goal-client-q"
              name="q"
              defaultValue={q}
              placeholder="Search clients by name or PAN"
              autoFocus
              className="input-base pl-9"
            />
          </div>
          <button type="submit" className={buttonClass("secondary")}>Search</button>
        </form>
        {/* Limited-height, scrollable picker (hidden scrollbar) so a long book
            doesn't stretch the page. */}
        <div className="card-surface overflow-hidden">
          {list.length === 0 && (
            <InlineEmpty message={q ? `No active client matches "${q}".` : "No active clients to set a goal for."} />
          )}
          <ul className="divide-y max-h-[60vh] overflow-y-auto scrollbar-none">
            {list.map((i) => (
              <li key={i.id}>
                <Link
                  href={`/dashboard/goals/new?investorId=${i.id}`}
                  className="block px-4 py-3 hover:bg-secondary/60 flex items-center justify-between"
                >
                  <div>
                    <div className="font-medium">{i.name}</div>
                    {/* Masked, and never an import key (MINOR:… / NOPAN:…). */}
                    {displayPan(i.pan) && <div className="text-xs text-muted-foreground font-mono">{displayPan(i.pan)}</div>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {i.segment_tag ?? "—"} · {i.goal_count} goal{i.goal_count === 1 ? "" : "s"}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          {more && (
            <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">
              Showing the first {PICKER_LIMIT}. Search to find anyone else.
            </p>
          )}
        </div>
      </div>
    );
  }

  const inv = await withTenant(session.tenantId, async (tx) =>
    (await tx.select().from(investors).where(and(
      eq(investors.id, sp.investorId!),
      isNull(investors.deletedAt),
      // Only a client in the viewer's book.
      await goalClientScopeSql(tx, session, "investors"),
    )).limit(1))[0] ?? null
  );
  if (!inv) notFound();

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <Link
        href="/dashboard/goals"
        className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
      >
        <ChevronLeft className="size-4" /> Back to goals
      </Link>
      <div className="card-elevated overflow-hidden">
        <div className="brand-mesh px-6 py-5 text-white flex items-center gap-4">
          <div className="size-12 rounded-xl bg-white/15 backdrop-blur-sm grid place-items-center ring-2 ring-white/20">
            <Target className="size-6 text-white" />
          </div>
          <div className="flex-1">
            <div className="text-2xs uppercase tracking-[0.18em] text-white/70 font-semibold">
              New financial goal
            </div>
            <h1 className="page-title mt-0.5">{inv.name}</h1>
            <div className="text-white/80 text-sm mt-0.5">
              {displayPan(inv.pan) && (
                <>
                  PAN <span className="font-mono">{displayPan(inv.pan)}</span>
                </>
              )}
              {inv.segmentTag && (
                <>
                  <span className="mx-2 text-white/40">·</span>
                  <span>{inv.segmentTag}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      <GoalCreateForm investorId={inv.id} investorName={inv.name} />
    </div>
  );
}
