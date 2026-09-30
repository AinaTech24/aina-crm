/**
 * What a dashboard widget receives and returns. SERVER-ONLY (widgets query the
 * database through lib/metrics).
 */

import type { ReactNode } from "react";
import type { Tx } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import type { MetricScope } from "@/lib/metrics/scope";
import type { DataAccess } from "@/lib/dashboards/system/access";
import type { FilterState } from "@/lib/dashboards/system/filters";
import type { ResolvedPeriod } from "@/lib/dashboards/system/period";
import type { DashboardThresholds } from "@/lib/dashboard/thresholds";

export type WidgetCtx = {
  session: SessionUser;
  tenantId: string;
  access: DataAccess;
  /** The filters in force for THIS card (the dashboard's, or the viewer's card filter). */
  state: FilterState;
  period: ResolvedPeriod;
  /** Access ∩ filters — every metric call takes this. */
  scope: MetricScope;
  thresholds: DashboardThresholds;
  /** Real branches (Unassigned does not count). */
  branchCount: number;
  userNames: Map<string, string>;
  branchNames: Map<string, string>;
};

export type WidgetResult = {
  /** Null hides the card: an empty card is width spent on nothing (D6). */
  body: ReactNode | null;
  /** A count or period note under the title — never an explanation. */
  subtitle?: string;
  /** "View all" target, opening the list on the same filters. */
  href?: string;
  hrefLabel?: string;
  /** A definition, shown behind an (i). */
  info?: string;
};

export type CsvTable = { columns: string[]; rows: Array<Array<string | number | null>> };

export type WidgetImpl = {
  key: string;
  render: (tx: Tx, ctx: WidgetCtx) => Promise<WidgetResult>;
  csv?: (tx: Tx, ctx: WidgetCtx) => Promise<CsvTable>;
};
