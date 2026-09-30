/**
 * Manage dashboards (D7) — every dashboard the viewer can see, with who it is
 * shared with, which roles open it by default, and whether it is locked.
 * Tabs: All · Created by me · Shared with me · Recently deleted (restorable for
 * 30 days).
 */

import Link from "next/link";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { InlineEmpty } from "@/components/common/EmptyState";
import { buttonClass } from "@/components/ui/button-class";
import { ManageRowActions } from "@/components/dashboards/system/ManageRowActions";
import {
  ROLE_LABELS, ensureSystemDashboards, listDashboards, shareNames, viewerFacts, type DashListItem, type ShareRow,
} from "@/lib/dashboards/platform";
import { ROLE_DEFAULTS } from "@/lib/dashboards/system/definitions";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "all", label: "All" },
  { key: "mine", label: "Created by me" },
  { key: "shared", label: "Shared with me" },
  { key: "deleted", label: "Recently deleted" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default async function ManageDashboardsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const tab: TabKey = (TABS.find((t) => t.key === sp.tab)?.key ?? "all") as TabKey;

  const data = await withTenant(session.tenantId, async (tx) => {
    await ensureSystemDashboards(tx, session.tenantId);
    const v = await viewerFacts(tx, session);
    const [list, names] = await Promise.all([listDashboards(tx, v), shareNames(tx, session.tenantId)]);
    return { list, names };
  });

  const userName = new Map(data.names.users.map((u) => [u.id, u.name.replace(/\s*\([^)]*\)$/, "")]));
  const branchName = new Map(data.names.branches.map((b) => [b.id, b.name]));
  const teamName = new Map(data.names.teams.map((t) => [t.id, t.name]));
  const chip = (s: ShareRow, r: DashListItem) => {
    // A role dashboard's 'all' share is everyone in the roles it is for.
    if (s.shareType === "all") return r.isSystem ? "Roles it's for" : "All users";
    if (s.shareType === "role") return `${ROLE_LABELS[s.shareRef] ?? s.shareRef}${s.includeSubordinates ? " + subordinates" : ""}`;
    if (s.shareType === "branch") return branchName.get(s.shareRef) ?? "Branch";
    if (s.shareType === "team") return teamName.get(s.shareRef) ?? "Team";
    return userName.get(s.shareRef) ?? "User";
  };

  // What the share dialog offers: people, branches, teams and roles.
  const shareTargets = {
    ...data.names,
    roles: [...new Set(ROLE_DEFAULTS.map((r) => r.role))].map((key) => ({ key, label: ROLE_LABELS[key] ?? key })),
  };
  const onlyBranch = !data.list.canManage && session.roles.includes("branch_head") ? session.branchId ?? null : null;

  const rows: DashListItem[] =
    tab === "deleted" ? data.list.deleted
      : tab === "mine" ? data.list.items.filter((i) => i.group === "mine")
        : tab === "shared" ? data.list.items.filter((i) => i.group === "shared")
          : data.list.items;

  return (
    <div className="space-y-4">
      <PageHeaderCard
        title="Manage dashboards"
        subtitle="Every dashboard you can open, who it is shared with and who opens it by default."
        actions={
          <div className="flex items-center gap-2">
            {data.list.canManage && (
              <Link href="/dashboard/settings/dashboards" className={buttonClass("secondary", "md")}>Defaults</Link>
            )}
            <Link href="/dashboard/new" className={buttonClass("primary", "md")}>New dashboard</Link>
          </div>
        }
      />

      <nav role="tablist" aria-label="Dashboards" className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-border bg-secondary/40 p-1">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === "all" ? "/dashboard/manage" : `/dashboard/manage?tab=${t.key}`}
            role="tab"
            aria-selected={tab === t.key}
            className={`rounded-md px-3 py-1.5 text-sm ${tab === t.key ? "bg-card shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="card-surface">
        {rows.length === 0 ? (
          <div className="p-6">
            <InlineEmpty message={tab === "deleted" ? "Nothing deleted in the last 30 days." : "No dashboards here yet."} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="px-4 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-left hidden md:table-cell">Owner</th>
                  <th className="px-3 py-2 text-left">Shared with</th>
                  <th className="px-3 py-2 text-left hidden lg:table-cell">Default for</th>
                  <th className="px-3 py-2 text-left hidden md:table-cell">Locked</th>
                  <th className="px-3 py-2 text-left hidden lg:table-cell">{tab === "deleted" ? "Deleted" : "Last updated"}</th>
                  <th className="relative px-4 py-2 text-right"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2 font-medium">
                      {r.deletedAt ? r.name : <Link href={`/dashboard/${r.id}`} className="hover:underline">{r.name}</Link>}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{r.isSystem ? "System" : "Custom"}</td>
                    <td className="px-3 py-2 hidden md:table-cell">{r.ownerName ? r.ownerName.replace(/\s*\([^)]*\)$/, "") : "—"}</td>
                    <td className="px-3 py-2">
                      {r.shares.length === 0 ? (
                        <span className="text-muted-foreground">{r.isSystem ? "Admins only" : "Only the owner"}</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {r.shares.slice(0, 3).map((s) => (
                            <span key={`${s.shareType}:${s.shareRef}`} className="rounded-full border border-border px-2 py-0.5 text-xs"
                              title={s.shareType === "all" && r.audience ? r.audience : undefined}>
                              {chip(s, r)}
                            </span>
                          ))}
                          {r.shares.length > 3 && <span className="text-xs text-muted-foreground">+{r.shares.length - 3}</span>}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 hidden lg:table-cell text-muted-foreground">
                      {r.defaultFor.length ? r.defaultFor.map((x) => ROLE_LABELS[x] ?? x).join(", ") : "—"}
                    </td>
                    <td className="px-3 py-2 hidden md:table-cell">{r.locked ? "Locked" : "—"}</td>
                    <td className="px-3 py-2 hidden lg:table-cell text-muted-foreground whitespace-nowrap">
                      {formatDate(r.deletedAt ?? r.updatedAt)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <ManageRowActions id={r.id} name={r.name} deleted={!!r.deletedAt} canClone={!r.centre}
                        canDelete={r.canDelete || (!!r.deletedAt && data.list.canManage)}
                        share={r.canShare && !r.deletedAt
                          ? { shares: r.shares, locked: r.locked, audience: r.audience, names: shareTargets, onlyBranch }
                          : undefined} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
