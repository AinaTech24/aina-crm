/**
 * Widget key → implementation. SERVER-ONLY. The client-safe metadata for the
 * same keys (title, sizes, supported filters) is lib/dashboards/system/catalog.ts;
 * a key in one must be in the other (tests/dashboard-platform.test.ts).
 */

import type { WidgetImpl } from "./types";
import { businessWidgets } from "./widgets/business";
import { workWidgets } from "./widgets/work";
import { leadWidgets } from "./widgets/leads";
import { insuranceComplianceWidgets } from "./widgets/insurance-compliance";
import { practiceWidgets } from "./widgets/practice";
import { sheetWidgets } from "./widgets/sheet";
import { opportunityWidgets } from "./widgets/opportunities";
import { ownerDependencyWidgets } from "./widgets/owner-dependency";
import { pipelineWidgets } from "./widgets/pipelines";

/** `dashboardHref` is where a Team row's link reopens this dashboard for one RM or branch. */
export function widgetRegistry(dashboardHref: string): Record<string, WidgetImpl> {
  const all = [...businessWidgets(dashboardHref), ...workWidgets, ...leadWidgets, ...insuranceComplianceWidgets, ...practiceWidgets, ...sheetWidgets, ...opportunityWidgets, ...ownerDependencyWidgets, ...pipelineWidgets];
  return Object.fromEntries(all.map((w) => [w.key, w]));
}
