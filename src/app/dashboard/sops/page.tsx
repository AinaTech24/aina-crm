import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import Link from "next/link";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Plus, ScrollText } from "lucide-react";
import { withTenant } from "@/db/client";
import { sops, sopVersions } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { sql } from "drizzle-orm";
import { formatRelative } from "@/lib/utils";
import { RowActions } from "@/components/common/RowActions";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { StarterManualButton } from "@/components/practice/StarterManualButton";
import { starterManualStatus } from "@/lib/practice/install-starter-manual";
import { STARTER_CATEGORIES } from "@/lib/practice/starter-manual";

export const dynamic = "force-dynamic";

const UNCATEGORISED = "Other";

/** Starter categories first, in the manual's order; then the firm's own, A–Z. */
function categoryOrder(a: string, b: string): number {
  const ia = (STARTER_CATEGORIES as readonly string[]).indexOf(a);
  const ib = (STARTER_CATEGORIES as readonly string[]).indexOf(b);
  if (a === UNCATEGORISED) return 1;
  if (b === UNCATEGORISED) return -1;
  if (ia >= 0 && ib >= 0) return ia - ib;
  if (ia >= 0) return -1;
  if (ib >= 0) return 1;
  return a.localeCompare(b);
}

export default async function SopsPage({ searchParams }: { searchParams: Promise<{ cat?: string }> }) {
  const { cat } = await searchParams;
  const session = await requireSession();
  // Authoring/deletion is sop.manage-only; viewers see the library read-only.
  const canManage = can(session.roles, "sop.manage", session.permissions);
  const { result, starter } = await withTenant(session.tenantId, async (tx) => {
    const sopRows = await tx
      .select({
        sop: sops,
        version: sopVersions,
        ackCount: sql<number>`(
          SELECT COUNT(*)::int FROM sop_acknowledgements ack
          WHERE ack.sop_version_id = ${sopVersions.id}
        )`,
      })
      .from(sops)
      .leftJoin(sopVersions, eq(sopVersions.id, sops.currentVersionId))
      // Tenant predicate — without it the list shows every tenant's SOPs.
      // Soft-deleted SOPs (deleted_at set) are hidden from the library.
      .where(and(eq(sops.tenantId, session.tenantId), isNull(sops.deletedAt)))
      .orderBy(desc(sops.updatedAt));
    const starter = canManage ? await starterManualStatus(tx, session.tenantId) : null;
    return { result: sopRows, starter };
  });

  // Group by category; ?cat= narrows to one.
  const groups = new Map<string, typeof result>();
  for (const r of result) {
    const c = r.sop.category?.trim() || UNCATEGORISED;
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c)!.push(r);
  }
  const categories = [...groups.keys()].sort(categoryOrder);
  const activeCat = cat && groups.has(cat) ? cat : null;
  const shown = (activeCat ? [activeCat] : categories).map((c) => ({
    category: c,
    rows: [...groups.get(c)!].sort((a, b) => a.sop.title.localeCompare(b.sop.title)),
  }));

  const offerStarter = !!starter && starter.missing > 0;
  const partialStarter = !!starter && starter.installed + starter.deleted > 0;

  return (
    <div className="space-y-6 max-w-7xl">
      <PageHeaderCard title={<>Operations Manual</>} actions={<>{canManage && (
          <Link
            href="/dashboard/sops/new"
            className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium flex items-center gap-1.5"
          >
            <Plus className="size-4" /> New SOP
          </Link>
        )}</>} />

      {offerStarter && starter && (
        <Card>
          <CardHeader
            icon={<ScrollText className="size-4" />}
            title={partialStarter ? "Complete the standard operations manual" : "Start from the standard MFD operations manual"}
            subtitle={
              partialStarter
                ? `${starter.missing} of the ${starter.total} standard SOPs and call scripts are not in your manual yet. SOPs you deleted are not added back.`
                : `${starter.total} SOPs and call scripts, written for an Indian MFD practice. Edit them to fit your firm.`
            }
            action={<StarterManualButton missing={starter.missing} partial={partialStarter} />}
          />
        </Card>
      )}

      {categories.length > 1 && (
        <nav aria-label="Filter by category" className="flex flex-wrap gap-2">
          <Link
            href="/dashboard/sops"
            aria-current={!activeCat ? "page" : undefined}
            className={`chip ${!activeCat ? "bg-primary text-primary-foreground" : ""}`}
          >
            All · {result.length}
          </Link>
          {categories.map((c) => (
            <Link
              key={c}
              href={`/dashboard/sops?cat=${encodeURIComponent(c)}`}
              aria-current={activeCat === c ? "page" : undefined}
              className={`chip ${activeCat === c ? "bg-primary text-primary-foreground" : ""}`}
            >
              {c} · {groups.get(c)!.length}
            </Link>
          ))}
        </nav>
      )}

      {result.length === 0 ? (
        <div className="border rounded-lg bg-card p-12 text-center text-sm text-muted-foreground">
          <ScrollText className="size-8 mx-auto text-muted-foreground/50" />
          <div className="mt-2">No SOPs yet.</div>
          <p className="mt-2 text-xs max-w-md mx-auto">
            Write down how each core process is done — lead follow-up, onboarding, SIP rejections,
            service requests, complaints — so the work runs the same way whoever does it.
          </p>
        </div>
      ) : (
        shown.map((g) => (
          <Card key={g.category}>
            <CardHeader title={g.category} subtitle={`${g.rows.length} SOP${g.rows.length === 1 ? "" : "s"}`} />
            <CardBody padded={false}>
              <ul className="divide-y border-t">
                {g.rows.map((r) => (
                  <li key={r.sop.id} className="p-4 hover:bg-accent/40">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <Link href={`/dashboard/sops/${r.sop.id}`} className="font-medium hover:underline">
                          {r.sop.title}
                        </Link>
                        <div className="text-xs text-muted-foreground font-mono mt-0.5">{r.sop.key}</div>
                      </div>
                      <div className="flex items-center gap-4 text-xs flex-wrap">
                        {r.version && <span className="text-muted-foreground">v{r.version.versionNumber}</span>}
                        <span className="text-muted-foreground">{r.ackCount} signed</span>
                        {r.sop.requiredRoles && r.sop.requiredRoles.length > 0 && (
                          <span className="text-muted-foreground">for {r.sop.requiredRoles.join(", ")}</span>
                        )}
                        {r.version && (
                          <span className="text-muted-foreground">
                            {formatRelative(r.version.publishedAt ?? r.version.createdAt)}
                          </span>
                        )}
                        {canManage && (
                          <RowActions
                            editHref={`/dashboard/sops/${r.sop.id}`}
                            deleteUrl={`/api/sops/${r.sop.id}`}
                            itemLabel="SOP"
                            itemName={r.sop.title}
                          />
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ))
      )}
    </div>
  );
}
