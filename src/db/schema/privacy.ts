import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, tenantId } from "./_shared";
import { tenants } from "./tenants";

/**
 * The DPDP consent record (migration 0255): every time a person ticked the
 * privacy-notice consent on a public form, or was first sent the notice by
 * email. Under the DPDP Act the FIRM must be able to prove consent and notice,
 * so a row is never edited — a withdrawal stamps `withdrawn_at`.
 */
export const privacyConsents = pgTable(
  "privacy_consents",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    /** "lead" | "investor"; null when the form is not tied to a record yet. */
    subjectType: text("subject_type"),
    subjectId: uuid("subject_id"),
    /** "consent" — ticked on a form; "notice" — the notice was sent to them. */
    kind: text("kind", { enum: ["consent", "notice"] }).notNull(),
    /** lead_form · docs_form · discovery_form · email_notice */
    source: text("source").notNull(),
    /** The purpose the person agreed to, in the words shown. */
    purpose: text("purpose"),
    noticeVersion: integer("notice_version").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  },
  (t) => ({
    subjectIdx: index("privacy_consents_subject_idx").on(t.tenantId, t.subjectType, t.subjectId),
  })
);

export type PrivacyConsent = typeof privacyConsents.$inferSelect;
