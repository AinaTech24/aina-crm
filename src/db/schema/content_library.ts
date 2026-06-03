import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_shared";
import { tenants } from "./tenants";

/**
 * AINA-managed content library — assets uploaded by AINA platform admins
 * that every tenant (MFD) can download with their own branding overlaid.
 *
 * NOT scoped by tenant_id — this table is platform-shared. The RLS policy
 * lets anyone in any tenant SELECT, but only platform admins INSERT/UPDATE.
 */

export const ASSET_TYPES = [
  "image",
  "pdf",
  "article",
  "presentation",
  "video",
  "audio",
  "other",
] as const;

export const ASSET_CATEGORIES = [
  "festive",
  "market_update",
  "investor_education",
  "scheme_recommendation",
  "tax_planning",
  "retirement",
  "child_education",
  "wealth_creation",
  "sebi_compliance",
  "general",
] as const;

export const contentLibraryAssets = pgTable(
  "content_library_assets",
  {
    id,
    title: text("title").notNull(),
    description: text("description"),
    type: text("type", { enum: ASSET_TYPES }).notNull(),
    category: text("category", { enum: ASSET_CATEGORIES }).notNull().default("general"),
    /** Public-or-presigned URL where MFDs fetch the file from (S3, CDN, …). */
    fileUrl: text("file_url").notNull(),
    fileName: text("file_name"),
    fileSizeBytes: text("file_size_bytes"),
    mimeType: text("mime_type"),
    /** Thumbnail/preview shown in the browse grid. Defaults to fileUrl for images. */
    thumbnailUrl: text("thumbnail_url"),
    tags: jsonb("tags").$type<string[]>().default([]),
    /**
     * Configures where the MFD's branding strip goes when downloading an
     * image. Optional; the compositor uses sensible defaults if absent.
     *   - position: 'top' | 'bottom' | 'both'   (default 'bottom')
     *   - heightPct: how tall the strip is as % of image height
     *   - background: hex (default tenant primaryColor)
     */
    brandingConfig: jsonb("branding_config").$type<{
      position?: "top" | "bottom" | "both";
      heightPct?: number;
      background?: string;
    }>(),
    /** Hide from MFD library when false (kept for archival audit). */
    isActive: boolean("is_active").notNull().default(true),
    /** Optional date when the asset becomes available + expires. */
    publishAt: timestamp("publish_at", { withTimezone: true }),
    expireAt: timestamp("expire_at", { withTimezone: true }),

    uploadedByUserId: uuid("uploaded_by_user_id"),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    ...timestamps,
  },
  (t) => ({
    typeIdx: index("cla_type_idx").on(t.type, t.isActive),
    catIdx: index("cla_category_idx").on(t.category, t.isActive),
    activeIdx: index("cla_active_idx").on(t.isActive, t.publishAt),
    tenantIdx: index("cla_tenant_idx").on(t.tenantId),
  })
);

export type ContentLibraryAsset = typeof contentLibraryAssets.$inferSelect;
export type NewContentLibraryAsset = typeof contentLibraryAssets.$inferInsert;

