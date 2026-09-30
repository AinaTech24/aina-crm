/**
 * Renders a dashboard's widgets. SERVER component.
 *
 * Every card is loaded first and the page renders once (D6: one loading
 * state, no ten skeletons popping in one by one). Each card runs in its own
 * transaction, at most four at a time (lib/dashboard/run-limit.ts), so one
 * card's error shows as that card's error rather than aborting the others,
 * and one render never holds more than four pooled connections.
 *
 * A card whose loader returns no body is not rendered at all (D6: hide empty
 * cards). If every card is empty the page says so once. A half-width card
 * left without its partner (the card beside it hid itself) takes the full
 * row, so a hidden card never leaves a hole.
 */

import { withTenant } from "@/db/client";
import { runLimit } from "@/lib/dashboard/run-limit";
import { SYSTEM_WIDGETS_BY_KEY } from "@/lib/dashboards/system/catalog";
import { filterStateToParams } from "@/lib/dashboards/system/filters";
import { PERIOD_NAMES } from "@/lib/dashboards/system/period";
import { InlineEmpty } from "@/components/common/EmptyState";
import { WidgetCard } from "./WidgetCard";
import { widgetRegistry } from "./registry";
import { notAppliedFor, widgetCtx, type PreparedDashboard } from "./prepare";
import type { WidgetResult } from "./types";
import { effectiveSizes } from "./sizes";

export async function DashboardGrid({ p }: { p: PreparedDashboard }) {
  const registry = widgetRegistry(`/dashboard/${p.id}`);
  const limit = runLimit(4);
  const exportQuery = filterStateToParams(p.state).toString();

  const results = await Promise.all(
    p.layout.map((item) =>
      limit(async () => {
        const impl = registry[item.widgetKey];
        const meta = SYSTEM_WIDGETS_BY_KEY[item.widgetKey];
        if (!impl || !meta) return { item, meta, result: null as WidgetResult | null, error: false, card: null };
        const { ctx, cardFilter } = widgetCtx(p, item);
        try {
          const result = await withTenant(p.base.tenantId, (tx) => impl.render(tx, ctx));
          return { item, meta, result, error: false, card: cardFilter };
        } catch (e) {
          console.error(`[dashboard] widget ${item.widgetKey} failed`, e);
          return { item, meta, result: null, error: true, card: cardFilter };
        }
      }),
    ),
  );

  const shown = results.filter((r) => r.meta && (r.error || r.result?.body));
  if (!shown.length) {
    return (
      <div className="card-surface p-6">
        <InlineEmpty message="Nothing to show for these filters yet." />
      </div>
    );
  }

  const sizes = effectiveSizes(shown.map((r) => (r.item.widgetKey === "kpi_row" ? "L" : r.item.size)));

  return (
    <div className="grid grid-cols-12 gap-4">
      {shown.map(({ item, meta, result, error, card }, i) => {
        const impl = registry[item.widgetKey];
        const title = item.title ?? meta!.title;
        const bare = item.widgetKey === "kpi_row";
        const menu = {
          dashboardId: p.id,
          instanceId: item.id,
          csv: !!impl?.csv,
          exportQuery,
          cardFilter: !!card,
          title,
        };
        const notApplied = notAppliedFor(p, item);
        if (bare && result?.body) {
          // The KPI row is five cards of its own; its menu and notes sit above it.
          return (
            <section key={item.id} className="col-span-12 min-w-0">
              {(notApplied.length > 0 || card) && (
                <p className="mb-2 text-xs text-muted-foreground">
                  {card && <>Card filter: {PERIOD_NAMES[card.period]} · </>}
                  {notApplied.length > 0 && <span title={`Not applied to these cards: ${notApplied.join(", ")}`}>Filter not applied</span>}
                </p>
              )}
              {result.body}
            </section>
          );
        }
        return (
          <WidgetCard
            key={item.id}
            size={sizes[i]}
            title={title}
            subtitle={result?.subtitle}
            info={result?.info}
            notApplied={notApplied}
            href={result?.href}
            hrefLabel={result?.hrefLabel}
            menu={menu}
            cardFilterLabel={card ? (card.period === "custom" ? `${card.from} – ${card.to ?? ""}` : PERIOD_NAMES[card.period]) : undefined}
          >
            {error ? <p className="text-sm text-muted-foreground">This card could not be loaded. Refresh to try again.</p> : result?.body}
          </WidgetCard>
        );
      })}
    </div>
  );
}
