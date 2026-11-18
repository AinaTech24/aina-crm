/**
 * Versioned Terms / NDA and each firm's acceptance of them (migration 0266).
 * See lib/legal/documents.ts.
 */

import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, tenantId } from "./_shared";

/** Platform-level. A published version is frozen by a trigger; a new version is a new row. */
export const legalDocuments = pgTable("legal_documents", {
  id,
  kind: text("kind", { enum: ["terms", "nda"] }).notNull(),
  version: integer("version").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  /** Stamped by the database on publish — SHA-256 hex of the exact UTF-8 text. */
  bodySha256: text("body_sha256"),
  status: text("status", { enum: ["draft", "published"] }).notNull().default("draft"),
  reviewNote: text("review_note"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  publishedBy: uuid("published_by"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** One immutable row per firm per document version (trigger-enforced). */
export const legalAcceptances = pgTable("legal_acceptances", {
  id,
  tenantId,
  userId: uuid("user_id").notNull(),
  documentId: uuid("document_id").notNull(),
  kind: text("kind", { enum: ["terms", "nda"] }).notNull(),
  version: integer("version").notNull(),
  textSha256: text("text_sha256").notNull(),
  signerName: text("signer_name").notNull(),
  designation: text("designation"),
  email: text("email").notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }).defaultNow().notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  otpVerified: boolean("otp_verified").notNull().default(false),
  signedPdfKey: text("signed_pdf_key"),
  complianceDocumentId: uuid("compliance_document_id"),
});

export type LegalDocument = typeof legalDocuments.$inferSelect;
export type LegalAcceptance = typeof legalAcceptances.$inferSelect;
