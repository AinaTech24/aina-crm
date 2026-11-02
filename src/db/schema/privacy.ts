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

/**
 * Requests from a client, lead or anyone else to use their DPDP rights
 * (migration 0256, lib/privacy/requests.ts): access, correction, erasure,
 * withdrawing consent, nomination, a grievance. The firm must answer within
 * 90 days (DPDP Rules 2025); `due_at` is that deadline. The person is linked
 * when they are on the CRM; the requester's own details stay on the row as the
 * record of who asked — even after an erasure removed the client.
 */
export const privacyRequests = pgTable(
  "privacy_requests",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    reference: text("reference").notNull(),
    subjectType: text("subject_type"),
    subjectId: uuid("subject_id"),
    requesterName: text("requester_name").notNull(),
    requesterEmail: text("requester_email"),
    requesterPhone: text("requester_phone"),
    type: text("type").notNull(),
    channel: text("channel").notNull(),
    details: text("details"),
    status: text("status").notNull().default("open"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    identityVerifiedAt: timestamp("identity_verified_at", { withTimezone: true }),
    identityVerifiedBy: uuid("identity_verified_by"),
    assigneeId: uuid("assignee_id"),
    taskId: uuid("task_id"),
    outcome: text("outcome"),
    /** What an erasure did: "erased", or "retained_until:<yyyy-mm-dd>". */
    erasureResult: text("erasure_result"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: uuid("closed_by"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    statusIdx: index("privacy_requests_status_idx").on(t.tenantId, t.status, t.dueAt),
    subjectIdx: index("privacy_requests_subject_idx").on(t.tenantId, t.subjectType, t.subjectId),
  })
);

export type PrivacyRequest = typeof privacyRequests.$inferSelect;
