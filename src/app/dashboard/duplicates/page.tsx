import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { Copy, ShieldCheck, Info } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { DuplicateGroup, FamilyDuplicateGroup, SharedContactGroup, UndoMergeButton } from "@/components/investors/DuplicateMerge";
import { ignoredDuplicates } from "@/db/schema";
import { formatDate } from "@/lib/format";
import { loadClientDuplicateClusters } from "@/lib/investors/duplicate-clusters";

export const dynamic = "force-dynamic";

const isManager = (roles: string[]) => roles.some((r) => ["owner", "branch_head"].includes(r));

type Tab = "duplicates" | "shared" | "families";

type FamRow = { gkey: string; id: string; name: string; member_count: number; family_aum: number };
type RecentMerge = {
  id: string; created_at: string; reversible: boolean; source: string;
  survivor_id: string; survivor_name: string; loser_name: string; by_name: string | null;
};

export default async function DuplicatesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  if (!isManager(session.roles)) {
    return <div className="max-w-2xl card-surface p-8 text-center text-sm text-muted-foreground">Duplicate detection &amp; merge is for owners and branch heads.</div>;
  }
  const sp = await searchParams;
  // ?module=family is the old link to the families view.
  const tab: Tab = sp.tab === "shared" ? "shared" : sp.tab === "families" || sp.module === "family" ? "families" : "duplicates";

  const { dupe, fam, ignoredList, recent } = await withTenant(session.tenantId, async (tx) => {
    const famRes = await tx.execute(sql`
      WITH base AS (
        SELECT f.id, COALESCE(f.family_name, f.head_name) AS name,
               lower(trim(COALESCE(f.family_name, f.head_name))) AS nkey,
               COUNT(i.id) FILTER (WHERE i.status = 'active')::int AS member_count,
               COALESCE(SUM(i.aum::numeric) FILTER (WHERE i.status = 'active'), 0)::numeric AS family_aum
        FROM families f LEFT JOIN investors i ON i.family_id = f.id
        WHERE f.tenant_id = ${session.tenantId}::uuid
        GROUP BY f.id
      )
      SELECT nkey AS gkey, id, name, member_count, family_aum FROM base b
      WHERE nkey <> '' AND (SELECT count(*) FROM base b2 WHERE b2.nkey = b.nkey) > 1
    `);

    // Both client tabs, by the rules in lib/investors/duplicate-clusters.
    const dupe = await loadClientDuplicateClusters(tx, session.tenantId);

    // Families only — the client loader applies its own ignored pairs.
    const ignored = await tx
      .select({ key1: ignoredDuplicates.key1, key2: ignoredDuplicates.key2, entityType: ignoredDuplicates.entityType })
      .from(ignoredDuplicates)
      // Tenant predicate — under the RLS-bypass model this would otherwise read
      // every tenant's ignored pairs.
      .where(eq(ignoredDuplicates.tenantId, session.tenantId));

    // Merges still inside the 7-day undo window.
    const recentRes = await tx.execute(sql`
      SELECT m.id, m.created_at, m.reversible, m.source,
             m.survivor_id, s.name AS survivor_name, l.name AS loser_name, u.name AS by_name
        FROM investor_merges m
        JOIN investors s ON s.id = m.survivor_id
        JOIN investors l ON l.id = m.loser_id
        LEFT JOIN users u ON u.id = m.merged_by_id
       WHERE m.tenant_id = ${session.tenantId}::uuid
         AND m.reversed_at IS NULL
         AND m.created_at > now() - interval '7 days'
       ORDER BY m.created_at DESC
       LIMIT 50
    `);

    return {
      dupe,
      fam: famRes.rows as FamRow[],
      ignoredList: ignored,
      recent: recentRes.rows as RecentMerge[],
    };
  });

  const isIgnoredPair = (id1: string, id2: string, type: "client" | "family") => {
    const [k1, k2] = id1 < id2 ? [id1, id2] : [id2, id1];
    return ignoredList.some((ig) => ig.entityType === type && ig.key1 === k1 && ig.key2 === k2);
  };
  const isClusterIgnored = (members: { id: string }[], type: "client" | "family") => {
    if (members.length < 2) return true;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        if (!isIgnoredPair(members[i].id, members[j].id, type)) return false;
      }
    }
    return true;
  };

  const dupClusters = dupe.clusters;
  const sharedClusters = dupe.shared;

  const famGroups = new Map<string, FamRow[]>();
  for (const row of fam) {
    if (!famGroups.has(row.gkey)) famGroups.set(row.gkey, []);
    famGroups.get(row.gkey)!.push(row);
  }
  const famClusters = [...famGroups.entries()]
    .map(([gkey, members]) => ({ gkey, members }))
    .filter((g) => g.members.length > 1)
    .filter((g) => !isClusterIgnored(g.members, "family"));

  const count = (kind: string, list: { kind: string }[]) => list.filter((g) => g.kind === kind).length;
  const TABS: Array<{ key: Tab; label: string; n: number }> = [
    { key: "duplicates", label: "Duplicates", n: dupClusters.length },
    { key: "shared", label: "Shared contact details", n: sharedClusters.length },
    { key: "families", label: "Families", n: famClusters.length },
  ];

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeaderCard
        title={<><Copy className="size-6 text-muted-foreground" /> Find Duplicates</>}
      />

      <nav aria-label="Duplicate views" className="border-b border-border">
        <ul className="-mb-px flex gap-1 overflow-x-auto">
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <li key={t.key}>
                <Link
                  href={t.key === "duplicates" ? "/dashboard/duplicates" : `/dashboard/duplicates?tab=${t.key}`}
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex h-10 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors ${
                    active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t.label}
                  <span className="tabular-nums text-xs text-muted-foreground">({t.n})</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {tab === "duplicates" && (
        <>
          {dupClusters.length === 0 ? (
            <Clean
              title="No duplicate clients found."
              hint="No two records share a PAN, or a name and date of birth with matching PANs."
            />
          ) : (
            <>
              <div className="flex flex-wrap gap-2 text-xs">
                {count("PAN", dupClusters) > 0 && <span className="chip bg-secondary">Same PAN: <strong className="ml-1">{count("PAN", dupClusters)}</strong></span>}
                {count("NameDob", dupClusters) > 0 && <span className="chip bg-secondary">Same name + date of birth: <strong className="ml-1">{count("NameDob", dupClusters)}</strong></span>}
              </div>
              <div className="space-y-3">
                {dupClusters.map((c) => <DuplicateGroup key={`${c.kind}-${c.gkey}`} kind={c.kind} gkey={c.gkey} members={c.members} />)}
              </div>
            </>
          )}

          {recent.length > 0 && (
            <section aria-labelledby="recent-merges" className="card-surface overflow-hidden">
              <div className="border-b border-border px-4 py-2.5">
                <h2 id="recent-merges" className="text-sm font-semibold">Merged in the last 7 days</h2>
                <p className="text-xs text-muted-foreground">A merge can be undone here for 7 days: the moved folios, transactions and history go back to the retired record.</p>
              </div>
              <ul className="divide-y divide-border">
                {recent.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{m.loser_name}</span>
                      <span className="text-muted-foreground"> merged into </span>
                      <Link href={`/dashboard/investors/${m.survivor_id}`} className="font-medium hover:underline">{m.survivor_name}</Link>
                      <span className="block text-xs text-muted-foreground">
                        {formatDate(m.created_at, "dateTime")}
                        {m.by_name ? ` · by ${m.by_name}` : m.source === "system" ? " · automatic" : ""}
                      </span>
                    </span>
                    {m.reversible ? (
                      <UndoMergeButton mergeId={m.id} label={`${m.loser_name} → ${m.survivor_name}`} />
                    ) : (
                      <span className="text-xs text-muted-foreground" title="The merge moved too many rows to record them one by one">Can’t be undone automatically</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {tab === "shared" && (
        <>
          <div className="flex items-start gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2.5 text-xs text-muted-foreground">
            <Info className="size-4 shrink-0 mt-0.5" aria-hidden />
            <p>
              These records share a phone number or email — a family, an HUF and its karta, or one office managing several accounts.
              That alone does not make them one person. Where the PANs differ they are different people and cannot be merged.
            </p>
          </div>
          {sharedClusters.length === 0 ? (
            <Clean title="No shared contact details." hint="No two client records share a phone number or an email." />
          ) : (
            <div className="space-y-3">
              {sharedClusters.map((c) => <SharedContactGroup key={`${c.kind}-${c.gkey}`} kind={c.kind} gkey={c.gkey} members={c.members} />)}
            </div>
          )}
        </>
      )}

      {tab === "families" && (
        famClusters.length === 0 ? (
          <Clean title="No duplicate families found." hint="Your family groupings are clean on name." />
        ) : (
          <>
            <div className="space-y-3">
              {famClusters.map((c) => (
                <FamilyDuplicateGroup
                  key={c.gkey}
                  gkey={c.gkey}
                  members={c.members.map((m) => ({ ...m, member_count: Number(m.member_count), family_aum: Number(m.family_aum) }))}
                />
              ))}
            </div>
            <p className="text-2xs text-muted-foreground">Merging families moves members and meetings to the family you keep; the empty duplicate is removed. It is audit-logged.</p>
          </>
        )
      )}
    </div>
  );
}

function Clean({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="card-surface p-12 text-center">
      <ShieldCheck className="size-10 mx-auto text-muted-foreground" aria-hidden />
      <div className="mt-3 font-medium">{title}</div>
      <p className="text-sm text-muted-foreground mt-1">{hint}</p>
    </div>
  );
}
