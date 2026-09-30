/**
 * Cards from the widget library placed inside a role dashboard that is a full
 * page of its own — the Operations Dashboard's Compliance tab is the one user.
 * SERVER component.
 *
 * The same implementations as on a widget dashboard (registry.ts, each figure
 * from lib/metrics), through the viewer's record access, so a card here and
 * the same card on the Owner Dashboard cannot disagree. There is no card menu:
 * a card filter and "Export CSV" belong to a dashboard's own layout. A card
 * with nothing to show is left out, as on every dashboard.
 */

import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { runLimit } from "@/lib/dashboard/run-limit";
import { loadDashboardThresholds, type DashboardThresholds } from "@/lib/dashboard/thresholds";
import { realBranches } from "@/lib/dashboards/load-options";
import { scopeFor, type DataAccess } from "@/lib/dashboards/system/access";
import { SYSTEM_WIDGETS_BY_KEY, type WidgetSize } from "@/lib/dashboards/system/catalog";
import type { FilterState } from "@/lib/dashboards/system/filters";
import { resolvePeriod } from "@/lib/dashboards/system/period";
import { InlineEmpty } from "@/components/common/EmptyState";
import { WidgetCard } from "./WidgetCard";
import { widgetRegistry } from "./registry";
import { effectiveSizes } from "./sizes";
import type { WidgetCtx, WidgetResult } from "./types";
import { inOrder } from "@/lib/metrics/in-order";

export async function EmbeddedWidgets({
  session, access, items, state, emptyMessage,
}: {
  session: SessionUser;
  access: DataAccess;
  items: Array<{ key: string; size: WidgetSize }>;
  /** The filters the cards honour (Branch and RM); the period is the dashboard's. */
  state: FilterState;
  /** Said once when every card is empty. */
  emptyMessage: string;
}) {
  const registry = widgetRegistry("/dashboard");
  const base = await withTenant(session.tenantId, async (tx) => {
    const [thresholds, branches, names] = await inOrder(
      () => loadDashboardThresholds(tx),
      () => realBranches(tx, session.tenantId),
      () => tx.execute(sql`SELECT id, name FROM users WHERE tenant_id = ${session.tenantId}::uuid`),
    );
    return {
      thresholds: thresholds as DashboardThresholds,
      branchCount: branches.length,
      branchNames: new Map(branches.map((b) => [b.id, b.name])),
      userNames: new Map((names.rows as Array<{ id: string; name: string | null }>).map((r) => [r.id, r.name ?? "—"])),
    };
  });
  const period = resolvePeriod(state.period, { from: state.from, to: state.to, fallback: "month" });
  const ctx: WidgetCtx = {
    session,
    tenantId: session.tenantId,
    access,
    state,
    period,
    scope: scopeFor(session.tenantId, session, access, state),
    ...base,
  };

  const limit = runLimit(4);
  const results = await Promise.all(items.map((it) => limit(async () => {
    const impl = registry[it.key];
    const meta = SYSTEM_WIDGETS_BY_KEY[it.key];
    if (!impl || !meta) return null;
    try {
      const result: WidgetResult = await withTenant(session.tenantId, (tx) => impl.render(tx, ctx));
      return result.body ? { it, meta, result, error: false } : null;
    } catch (e) {
      console.error(`[dashboard] embedded widget ${it.key} failed`, e);
      return { it, meta, result: null, error: true };
    }
  })));
  const shown = results.filter((r): r is NonNullable<typeof r> => !!r);

  if (!shown.length) {
    return (
      <div className="card-surface p-6">
        <InlineEmpty message={emptyMessage} />
      </div>
    );
  }
  // A card whose partner had nothing to show takes the full row.
  const sizes = effectiveSizes(shown.map((r) => r.it.size));
  return (
    <div className="grid grid-cols-12 gap-4">
      {shown.map(({ it, meta, result, error }, i) => {
        return (
          <WidgetCard
            key={it.key}
            size={sizes[i]}
            title={meta.title}
            subtitle={result?.subtitle}
            info={result?.info}
            href={result?.href}
            hrefLabel={result?.hrefLabel}
          >
            {error ? <p className="text-sm text-muted-foreground">This card could not be loaded. Refresh to try again.</p> : result?.body}
          </WidgetCard>
        );
      })}
    </div>
  );
}
