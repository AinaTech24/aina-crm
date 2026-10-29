/**
 * The practice as a system (The E-Myth Revisited) — migration 0245.
 * See src/lib/practice/ for what reads and writes these.
 */

import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";
import { sops } from "./compliance";

/** A job in the firm, independent of who does it, with its position contract. */
export const practicePositions = pgTable(
  "practice_positions",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    key: text("key").notNull(),
    title: text("title").notNull(),
    purpose: text("purpose"),
    results: jsonb("results").$type<string[]>().notNull().default([]),
    approvals: jsonb("approvals").$type<string[]>().notNull().default([]),
    sort: integer("sort").notNull().default(0),
    ...timestamps,
  },
  (t) => ({ keyUq: uniqueIndex("practice_positions_key_uq").on(t.tenantId, t.key) })
);

/** Who fills a position. One person may fill several; the owner usually fills most. */
export const practicePositionHolders = pgTable(
  "practice_position_holders",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    positionId: uuid("position_id").notNull().references(() => practicePositions.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uq: uniqueIndex("practice_position_holders_uq").on(t.positionId, t.userId),
    userIdx: index("practice_position_holders_user_idx").on(t.tenantId, t.userId),
  })
);

export const SOP_LINK_KINDS = ["task_type", "task_template", "process", "position", "blueprint_stage", "sr_type"] as const;
export type SopLinkKind = (typeof SOP_LINK_KINDS)[number];

/** An SOP attached to where the work happens. */
export const sopLinks = pgTable(
  "sop_links",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    sopId: uuid("sop_id").notNull().references(() => sops.id, { onDelete: "cascade" }),
    targetKind: text("target_kind", { enum: SOP_LINK_KINDS }).notNull(),
    targetKey: text("target_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uq: uniqueIndex("sop_links_uq").on(t.tenantId, t.sopId, t.targetKind, t.targetKey),
    targetIdx: index("sop_links_target_idx").on(t.tenantId, t.targetKind, t.targetKey),
  })
);

/** Per-firm settings of the core processes defined in lib/practice/processes.ts. */
export const practiceProcessSettings = pgTable(
  "practice_process_settings",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    processKey: text("process_key").notNull(),
    ownerPositionId: uuid("owner_position_id").references(() => practicePositions.id, { onDelete: "set null" }),
    notes: text("notes"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ uq: uniqueIndex("practice_process_settings_uq").on(t.tenantId, t.processKey) })
);

export type ServicePromiseItems = {
  reviewEveryDays?: number | null;
  callEveryDays?: number | null;
  statementEveryDays?: number | null;
  birthdayWish?: boolean;
  querySlaHours?: number | null;
};

/** What every client of a service tier gets. */
export const servicePromises = pgTable(
  "service_promises",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    tier: text("tier").notNull(),
    items: jsonb("items").$type<ServicePromiseItems>().notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => ({ tierUq: uniqueIndex("service_promises_tier_uq").on(t.tenantId, t.tier) })
);

export type StrategyFigures = {
  aum?: number | null;
  clients?: number | null;
  sipBook?: number | null;
  revenue?: number | null;
  teamSize?: number | null;
  ownerHoursPerWeek?: number | null;
};

/** The owner's primary aim and the strategic objective the annual targets serve. */
export const firmStrategy = pgTable(
  "firm_strategy",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    primaryAim: text("primary_aim"),
    objectiveYear: integer("objective_year"),
    targets: jsonb("targets").$type<StrategyFigures>().notNull().default({}),
    baseline: jsonb("baseline").$type<StrategyFigures>().notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => ({ tenantUq: uniqueIndex("firm_strategy_tenant_uq").on(t.tenantId) })
);
