import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
/**
 * Merge Clients — the de-duplication utility, in five fixed options:
 *
 *   Merge Client                search → summary table → preview → merge (N into 1)
 *   Differ Clients              separate a merge that was wrong (reversible merges only)
 *   View All Merged Clients     every merge on record, who did it and why
 *   Unmerged Suggestion List    likely duplicates (PAN / phone / email / name) awaiting a decision,
 *                               plus the one thing the system may do alone: exact-PAN groups
 *   Client Merged By System     merges nobody reviewed at the time — the set worth spot-checking
 *
 * Everything runs through src/lib/investors/merge.ts, so a manual merge, an
 * N-way merge and a system merge move the same rows and are undone by the same
 * un-merge. Merging is restricted to owners / branch heads; other roles see the
 * history read-only.
 */

import Link from "next/link";
import { sql } from "drizzle-orm";
import { GitMerge, HeartHandshake, Search, ShieldCheck } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { loadMergeCounts, loadMergedClients, type MergedClient } from "@/lib/investors/merged";
import { loadClientDuplicateClusters, type DuplicateCluster } from "@/lib/investors/duplicate-clusters";
import { UnmergeButton } from "@/components/investors/MergePicker";
import { MergeClientTool } from "@/components/investors/MergeClientTool";
import { AutoMergeButton } from "@/components/investors/AutoMergeButton";
import { DuplicateGroup } from "@/components/investors/DuplicateMerge";
import { MergeHubNav, MERGE_HUB_TABS, type MergeHubTab } from "@/components/investors/MergeHubNav";

export const dynamic = "force-dynamic";

const inr = (n: number) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : `₹${Math.round(n).toLocaleString("en-IN")}`;

const fmtDate = (v: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const TAB_KEYS = MERGE_HUB_TABS.map((t) => t.key);

export default async function MergeClientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const tab = (TAB_KEYS.includes((sp.tab ?? "") as MergeHubTab) ? sp.tab : "merge") as MergeHubTab;
  const q = (sp.q ?? "").trim();
  const canMerge = can(session.roles, "dashboard.view.owner", session.permissions);

  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      const counts = await loadMergeCounts(tx);
      const reversible = Number(
        ((await tx.execute(sql`SELECT count(*)::int AS n FROM investor_merges WHERE reversed_at IS NULL AND reversible = true`)).rows[0] as any)?.n ?? 0
      );
      // Only the active tab's list is loaded; the others contribute counts only.
      let rows: MergedClient[] = [];
      let clusters: DuplicateCluster[] = [];
      let ruleCounts: Record<string, number> = {};
      if (tab === "merged") rows = await loadMergedClients(tx, { source: "all", q });
      if (tab === "system") rows = await loadMergedClients(tx, { source: "system", q });
      if (tab === "differ") rows = (await loadMergedClients(tx, { source: "all", q })).filter((r) => r.mergeId && r.reversible);
      const dupe = await loadClientDuplicateClusters(tx, session.tenantId);
      clusters = tab === "suggestions" ? dupe.clusters : [];
      ruleCounts = dupe.ruleCounts;
      return { counts, reversible, rows, clusters, ruleCounts, suggestionCount: dupe.clusters.length, panGroups: dupe.ruleCounts.PAN ?? 0 };
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const navCounts: Partial<Record<MergeHubTab, number>> = {
    differ: data.reversible,
    merged: data.counts.all,
    suggestions: data.suggestionCount,
    system: data.counts.system,
  };
  const active = MERGE_HUB_TABS.find((t) => t.key === tab)!;

  return (
    <div className="space-y-5 max-w-7xl">
      <PageHeaderCard title={<><GitMerge className="size-6 text-primary" /> Merge Clients</>} subtitle={<>One client, one record. Merge duplicates, separate mistakes, and review what the system did on its own.</>} actions={<><Link href="/dashboard/duplicates?module=family" className="btn-secondary text-xs inline-flex items-center gap-1.5">
          <HeartHandshake className="size-3.5" /> Duplicate families
        </Link></>} />

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-5 items-start">
        <MergeHubNav active={tab} counts={navCounts} />

        <div className="min-w-0 space-y-4">
          {/* Section title + (for list tabs) search, both URL-driven so a view is shareable. */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-lg font-semibold">{active.label}</h2>
              <p className="text-xs text-muted-foreground">{active.hint}</p>
            </div>
            {(tab === "merged" || tab === "system" || tab === "differ") && (
              <form className="relative" action="/dashboard/merge-clients">
                <input type="hidden" name="tab" value={tab} />
                <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input name="q" defaultValue={q} placeholder="Name, PAN, email, mobile…" className="input-base h-8 text-xs pl-8 w-64" />
              </form>
            )}
          </div>

          {tab === "merge" && (canMerge ? <MergeClientTool /> : <ReadOnlyNote />)}

          {tab === "suggestions" && (
            <>
              {canMerge && <AutoMergeButton panGroups={data.panGroups} />}
              {Object.keys(data.ruleCounts).length > 0 && (
                <div className="flex flex-wrap gap-2 text-xs">
                  {["PAN", "Email", "Phone", "Name"].filter((k) => data.ruleCounts[k]).map((k) => (
                    <span key={k} className="chip bg-secondary">{k}: <strong className="ml-1">{data.ruleCounts[k]}</strong></span>
                  ))}
                </div>
              )}
              {data.clusters.length === 0 ? (
                <div className="card-surface p-12 text-center">
                  <ShieldCheck className="size-10 mx-auto text-emerald-500" />
                  <div className="mt-3 font-medium">No duplicate suggestions</div>
                  <p className="text-sm text-muted-foreground mt-1">Your client book is clean on PAN, phone, email and name.</p>
                </div>
              ) : canMerge ? (
                <div className="space-y-3">
                  {data.clusters.map((c) => (
                    <DuplicateGroup key={`${c.kind}-${c.gkey}`} kind={c.kind} gkey={c.gkey} members={c.members} />
                  ))}
                  <p className="text-2xs text-muted-foreground">
                    “Not duplicates” hides a group for good. Merging here is logged as manual and can be separated later.
                  </p>
                </div>
              ) : (
                <ReadOnlyNote />
              )}
            </>
          )}

          {tab === "system" && data.counts.system > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
              <strong>{data.counts.system}</strong> client{data.counts.system === 1 ? " was" : "s were"} merged automatically on an
              exact-PAN match, with nobody reviewing the pair. Spot-check that each really is the same person — anything wrong can be
              separated from here.
            </div>
          )}

          {(tab === "merged" || tab === "system" || tab === "differ") && (
            <MergedTable rows={data.rows} tab={tab} q={q} canMerge={canMerge} />
          )}

          {!canMerge && tab !== "merge" && tab !== "suggestions" && <ReadOnlyNote />}
        </div>
      </div>
    </div>
  );
}

function ReadOnlyNote() {
  return (
    <p className="text-xs text-muted-foreground">
      Merging and separating clients is restricted to owners and branch heads — this view is read-only for your role.
    </p>
  );
}

function MergedTable({ rows, tab, q, canMerge }: { rows: MergedClient[]; tab: MergeHubTab; q: string; canMerge: boolean }) {
  const emptyTitle =
    q ? "No merges match that search."
    : tab === "differ" ? "Nothing to separate — no reversible merges on record."
    : tab === "system" ? "The system hasn't merged any clients yet."
    : "No clients have been merged yet.";
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {rows.length === 0 ? (
        <div className="p-12 text-center text-sm text-muted-foreground">
          <GitMerge className="size-8 mx-auto text-muted-foreground/40" />
          <div className="mt-2 font-medium">{emptyTitle}</div>
          {!q && tab !== "differ" && (
            <p className="mt-1 text-xs">
              Start from{" "}
              <Link href="/dashboard/merge-clients?tab=suggestions" className="text-primary hover:underline">the suggestion list</Link>
              {" "}or{" "}
              <Link href="/dashboard/merge-clients?tab=merge" className="text-primary hover:underline">merge by search</Link>.
            </p>
          )}
        </div>
      ) : (
        <div className="table-scroll">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b bg-secondary/30">
              <tr>
                <th className="text-left py-2.5 px-4 font-medium">Merged record</th>
                <th className="text-left py-2.5 px-4 font-medium">Kept as</th>
                <th className="text-left py-2.5 px-4 font-medium">Why</th>
                <th className="text-left py-2.5 px-4 font-medium">By</th>
                <th className="text-right py-2.5 px-4 font-medium">Survivor AUM</th>
                <th className="text-right py-2.5 px-4 font-medium">When</th>
                <th className="text-right py-2.5 px-4 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.loserId} className="border-b last:border-0 hover:bg-secondary/30">
                  <td className="py-2.5 px-4">
                    <div className="font-medium">{r.loserName}</div>
                    <div className="text-2xs text-muted-foreground tabular-nums">
                      {[r.loserPan, r.loserPhone, r.loserEmail].filter(Boolean).join(" · ") || "no identifiers"}
                    </div>
                  </td>
                  <td className="py-2.5 px-4">
                    <Link href={`/dashboard/investors/${r.survivorId}`} className="font-medium hover:underline">{r.survivorName}</Link>
                    {r.survivorPan && <div className="text-2xs text-muted-foreground tabular-nums">{r.survivorPan}</div>}
                  </td>
                  <td className="py-2.5 px-4">
                    <span className={`chip text-2xs ${r.source === "manual" ? "bg-secondary text-foreground" : "bg-amber-50 text-amber-700"}`}>
                      {r.source === "manual" ? "Manual" : "System"}
                    </span>
                    {r.reason && <span className="ml-2 text-2xs text-muted-foreground">{r.reason}</span>}
                  </td>
                  <td className="py-2.5 px-4 text-xs text-muted-foreground">{r.mergedByName ?? (r.source === "manual" ? "—" : "System")}</td>
                  <td className="py-2.5 px-4 text-right tabular-nums">{inr(r.survivorAum)}</td>
                  <td className="py-2.5 px-4 text-right text-xs text-muted-foreground whitespace-nowrap">{fmtDate(r.mergedAt)}</td>
                  <td className="py-2.5 px-4 text-right whitespace-nowrap">
                    {canMerge && r.mergeId ? (
                      <UnmergeButton mergeId={r.mergeId} reversible={r.reversible} label={tab === "differ" ? "Separate" : "Undo"} />
                    ) : (
                      <span className="text-2xs text-muted-foreground" title="Merged before the merge log existed — nothing recorded what moved, so it cannot be separated automatically.">
                        —
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
