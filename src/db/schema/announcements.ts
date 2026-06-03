/**
 * Announcements — internal team notice board (Sanchay "Announcements" parity).
 *
 * Owners / branch heads post firm-wide (or branch- / role-scoped) notices that
 * staff see on login (a strip on the dashboard) and on the Announcements page.
 * Distinct from `tenant_circulars` (the AMFI regulatory circular digest) — this
 * is internal operational comms ("Office closed Fri", "New SIP process live").
 */

import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";

export const ANNOUNCEMENT_CATEGORIES = ["general", "policy", "event", "system", "urgent"] as const;
export type AnnouncementCategory = (typeof ANNOUNCEMENT_CATEGORIES)[number];

export const announcements = pgTable(
  "announcements",
  {
    id,
    tenantId,
    title: text("title").notNull(),
    body: text("body").notNull(),
    category: text("category", { enum: ANNOUNCEMENT_CATEGORIES }).notNull().default("general"),

    /**
     * Target audience by role. Empty / null array = everyone in the tenant.
     * Otherwise the viewer must hold at least one of these roles.
     */
    audienceRoles: jsonb("audience_roles").$type<string[]>().default([]),
    /** Optional branch scope — null = all branches. */
    branchId: uuid("branch_id"),

    isPinned: boolean("is_pinned").notNull().default(false),
    /** Null until published (draft). Active = published & now < expiresAt. */
    publishedAt: timestamp("published_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),

    createdByUserId: uuid("created_by_user_id"),

    ...timestamps,
  },
  (t) => ({
    activeIdx: index("announcements_active_idx").on(t.tenantId, t.publishedAt, t.expiresAt),
    pinnedIdx: index("announcements_pinned_idx").on(t.tenantId, t.isPinned),
  })
);

export type Announcement = typeof announcements.$inferSelect;
export type NewAnnouncement = typeof announcements.$inferInsert;
