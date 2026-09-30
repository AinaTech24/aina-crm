/**
 * The header every dashboard opens with — the widget dashboards and the five
 * role dashboards that are a full page of their own alike (D2 / D7):
 *
 *   [Owner Dashboard ▾] ☆                         [filters]  ⋯
 *   Showing: whole firm                                Updated 5:21 PM
 *
 * SERVER component. The dropdown lists every dashboard the viewer may open;
 * "Showing" says whose records the figures count (never widened by the
 * dashboard: lib/dashboards/system/access.ts, or the centre's own access
 * rule). Share targets are loaded only for someone who can share.
 */

import type { ReactNode } from "react";
import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { ROLE_LABELS, loadDashboard, shareNames, viewerFacts, type DashList } from "@/lib/dashboards/platform";
import { ROLE_DEFAULTS } from "@/lib/dashboards/system/definitions";
import { DashboardSwitcher } from "./DashboardSwitcher";
import { DashboardActions } from "./DashboardActions";
import { DashboardStatus } from "./DashboardNav";

export type HeadFacts = {
  id: string;
  name: string;
  list: DashList;
  isFavourite: boolean;
  isDefault: boolean;
  canEdit: boolean;
  canShare: boolean;
  /** Delete — never a role dashboard. */
  canDelete: boolean;
  canManage: boolean;
  /** A role dashboard: the roles it is for, in words. */
  audience: string | null;
  locked: boolean;
  /** False for a role dashboard that is a full page of its own: it has no cards to copy. */
  cloneable: boolean;
};

export async function DashboardHead({
  session, d, showing, right,
}: {
  session: SessionUser;
  d: HeadFacts;
  /** "whole firm", "Ahmedabad HQ", "your clients"… */
  showing: string;
  /** The filter bar, beside the actions (widget dashboards and Operations). */
  right?: ReactNode;
}) {
  const share = d.canShare
    ? await withTenant(session.tenantId, async (tx) => {
        const v = await viewerFacts(tx, session);
        const hit = await loadDashboard(tx, v, d.id);
        const names = await shareNames(tx, session.tenantId);
        return {
          shares: hit?.shares ?? [],
          names: {
            ...names,
            roles: [...new Set(ROLE_DEFAULTS.map((r) => r.role))].map((key) => ({ key, label: ROLE_LABELS[key] ?? key })),
          },
        };
      })
    : null;
  const onlyBranch = !d.canManage && session.roles.includes("branch_head") ? session.branchId ?? null : null;

  return (
    <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between print:block">
      <div className="min-w-0">
        <DashboardSwitcher
          current={{ id: d.id, name: d.name }}
          isFavourite={d.isFavourite}
          items={d.list.items.map((i) => ({
            id: i.id,
            name: i.name,
            isSystem: i.isSystem,
            locked: i.locked,
            isFavourite: i.isFavourite,
            isMyDefault: i.isMyDefault,
            ownerName: i.ownerName,
            group: i.group,
          }))}
        />
        <p className="text-xs text-muted-foreground">Showing: {showing}</p>
      </div>
      <div className="flex flex-col items-stretch gap-1 lg:items-end print:hidden">
        <div className="flex items-start gap-2">
          {right}
          <DashboardActions
            dashboardId={d.id}
            name={d.name}
            canEdit={d.canEdit}
            canShare={d.canShare}
            canDelete={d.canDelete}
            canClone={d.cloneable}
            audience={d.audience}
            isDefault={d.isDefault}
            shares={share?.shares ?? []}
            locked={d.locked}
            shareNames={share?.names ?? null}
            onlyBranch={onlyBranch}
          />
        </div>
        <DashboardStatus updated={formatDate(new Date(), "time")} />
      </div>
    </header>
  );
}
