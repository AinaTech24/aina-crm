import { boolean, index, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";

/**
 * A placed widget on a custom dashboard. Layout is an ordered array of these —
 * order = render order; colSpan/rowSpan = size on a 4-column responsive grid.
 */
export interface DashboardWidgetInstance {
  /** Instance id (uuid) — distinct from the catalog widgetKey. */
  id: string;
  /** Catalog key (src/lib/dashboards/catalog.ts). */
  widgetKey: string;
  /** 1–4 columns wide. */
  colSpan: number;
  /** 1–3 rows tall. */
  rowSpan: number;
  /** Optional per-widget title override. */
  title?: string;
  /** Per-widget filter overrides (period / rm) — beat the board-level filter. */
  config?: { period?: string; rm?: string; [k: string]: unknown };
}

/**
 * Customizable dashboards — "My Dashboards". Each user can build several named
 * boards from the widget catalog, arrange them, set one as default home, and
 * (owner) share a board to the whole firm. Soft-deleted boards live in
 * "Recently Deleted" for 30 days. The role-based cockpit remains the built-in
 * default when a user has no custom default board.
 */
export const dashboards = pgTable(
  "dashboards",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    /** Creator / owner. A shared board is still owned by its creator. */
    userId: uuid("user_id").references(() => users.id),
    name: text("name").notNull(),
    description: text("description"),
    /** private = only the creator; shared = visible to the whole firm. */
    scope: text("scope", { enum: ["private", "shared"] }).notNull().default("private"),
    /** The user's default home board (one per user). */
    isDefault: boolean("is_default").notNull().default(false),
    /** Locked shared boards can be edited only by the creator / owner. */
    locked: boolean("locked").notNull().default(false),
    layout: jsonb("layout").$type<DashboardWidgetInstance[]>().notNull().default([]),
    /** Board-level default filters applied to every widget. */
    filters: jsonb("filters").$type<{ period?: string; rm?: string }>(),
    /** Soft delete → Recently Deleted (restorable 30 days). */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    /**
     * One of the seven built-in dashboards (migration 0223). Their content is
     * defined in code (src/lib/dashboards/system/definitions.ts), keyed by
     * `systemKey`; the row gives them an id to link, share and default to.
     */
    isSystem: boolean("is_system").notNull().default(false),
    systemKey: text("system_key"),
    /** Which filters the dashboard offers and their defaults (lib/dashboards/system/filters.ts FilterConfig). */
    filterConfig: jsonb("filter_config").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (t) => ({
    tenantUserIdx: index("dashboards_tenant_user_idx").on(t.tenantId, t.userId),
    sharedIdx: index("dashboards_shared_idx").on(t.tenantId, t.scope),
    systemKeyUnique: uniqueIndex("dashboards_system_key_unique")
      .on(t.tenantId, t.systemKey)
      .where(sql`system_key IS NOT NULL`),
    // At most one default board per user among the live (non-deleted) boards.
    defaultUnique: uniqueIndex("dashboards_default_unique")
      .on(t.tenantId, t.userId)
      .where(sql`is_default = true AND deleted_at IS NULL`),
  })
);

export type Dashboard = typeof dashboards.$inferSelect;

/**
 * Who a dashboard is shared with. No rows = only its owner. `all` = everyone
 * in the firm. Otherwise one row per user / role / branch / team (desk); a role
 * row with `include_subordinates` also reaches the roles under it.
 */
export const dashboardShares = pgTable(
  "dashboard_shares",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    dashboardId: uuid("dashboard_id").notNull().references(() => dashboards.id, { onDelete: "cascade" }),
    shareType: text("share_type", { enum: ["all", "user", "role", "branch", "team"] }).notNull(),
    /** User id, role key, branch id or desk id; '' for `all`. */
    shareRef: text("share_ref").notNull().default(""),
    includeSubordinates: boolean("include_subordinates").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueShare: uniqueIndex("dashboard_shares_unique").on(t.dashboardId, t.shareType, t.shareRef),
    tenantIdx: index("dashboard_shares_tenant_idx").on(t.tenantId, t.shareType, t.shareRef),
  })
);

/** Per user and dashboard: favourite, own default, last opened, saved filter, per-card filters. */
export const dashboardUserPrefs = pgTable(
  "dashboard_user_prefs",
  {
    tenantId: tenantId.references(() => tenants.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    dashboardId: uuid("dashboard_id").notNull().references(() => dashboards.id, { onDelete: "cascade" }),
    isFavourite: boolean("is_favourite").notNull().default(false),
    isDefault: boolean("is_default").notNull().default(false),
    lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }),
    savedFilters: jsonb("saved_filters").$type<Record<string, unknown>>(),
    cardFilters: jsonb("card_filters").$type<Record<string, Record<string, unknown>>>(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.dashboardId] }),
    defaultUnique: uniqueIndex("dashboard_user_prefs_default_unique").on(t.tenantId, t.userId).where(sql`is_default`),
    tenantIdx: index("dashboard_user_prefs_tenant_idx").on(t.tenantId, t.userId),
  })
);

/** The firm's default dashboard per role, and per-user assignments that beat it. */
export const dashboardDefaults = pgTable(
  "dashboard_defaults",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    targetType: text("target_type", { enum: ["role", "user"] }).notNull(),
    targetRef: text("target_ref").notNull(),
    dashboardId: uuid("dashboard_id").notNull().references(() => dashboards.id, { onDelete: "cascade" }),
    updatedBy: uuid("updated_by").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueTarget: uniqueIndex("dashboard_defaults_unique").on(t.tenantId, t.targetType, t.targetRef),
  })
);
