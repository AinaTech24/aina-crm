/**
 * Export — Visitor Register (/dashboard/visitors), only for a firm with the
 * `visitorRegister` switch. The file holds what the list shows under its search
 * and filters, and its headings are the import's, so it can be imported again.
 */

import { sql } from "drizzle-orm";
import { visitorRegisterEnabled } from "@/lib/visitors/access";
import { VISITOR_LABELS, parseVisitorFilter } from "@/lib/visitors/entry";
import { visitorConditions } from "@/lib/visitors/service";
import { d, dt, userName } from "../helpers";
import type { ExportModule } from "../types";

export const visitorsExport: ExportModule = {
  key: "visitors",
  label: "Visitor Register",
  fileName: "visitors",
  enabled: visitorRegisterEnabled,
  // The register is the whole team's to read; exporting it needs "Export data" (checked by the engine).
  canView: () => true,
  // A visitor is not a client or a lead, whose fields the licence can hide.
  piiGated: false,
  from: sql`visitor_entries LEFT JOIN users meeting_with ON meeting_with.id = visitor_entries.meeting_with_user_id`,
  async where(_tx, session, params) {
    return visitorConditions(session.tenantId, parseVisitorFilter(Object.fromEntries(params)));
  },
  orderBy: sql`visitor_entries.visit_date DESC, visitor_entries.entry_time DESC NULLS LAST, visitor_entries.created_at DESC`,
  columns: [
    { key: "visitorName", label: VISITOR_LABELS.visitorName, group: "Visitor", sql: sql`visitor_entries.visitor_name`, default: true },
    { key: "email", label: VISITOR_LABELS.email, group: "Visitor", sql: sql`visitor_entries.email`, pii: "email", default: true },
    { key: "mobile", label: VISITOR_LABELS.mobile, group: "Visitor", sql: sql`visitor_entries.mobile`, pii: "phone", default: true },
    { key: "companyName", label: VISITOR_LABELS.companyName, group: "Visitor", sql: sql`visitor_entries.company_name`, default: true },
    { key: "visitDate", label: VISITOR_LABELS.visitDate, group: "Visit", sql: d(sql`visitor_entries.visit_date`), kind: "date", default: true },
    { key: "entryTime", label: VISITOR_LABELS.entryTime, group: "Visit", sql: sql`to_char(visitor_entries.entry_time, 'HH24:MI')`, default: true },
    { key: "exitTime", label: VISITOR_LABELS.exitTime, group: "Visit", sql: sql`to_char(visitor_entries.exit_time, 'HH24:MI')`, default: true },
    { key: "purpose", label: VISITOR_LABELS.purpose, group: "Visit", sql: sql`visitor_entries.purpose`, default: true },
    { key: "meetingWith", label: VISITOR_LABELS.meetingWithUserId, group: "Visit", sql: sql`meeting_with.name`, default: true },
    { key: "remarks", label: VISITOR_LABELS.remarks, group: "Visit", sql: sql`visitor_entries.remarks`, default: true },
    { key: "recordedBy", label: "Recorded by", group: "Record", sql: userName(sql`visitor_entries.created_by`) },
    { key: "recordedOn", label: "Recorded on", group: "Record", sql: dt(sql`visitor_entries.created_at`), kind: "datetime" },
  ],
};
