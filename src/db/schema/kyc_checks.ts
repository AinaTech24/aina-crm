/**
 * One row per KYC status answer fetched from a KRA by PAN (migration 0237).
 * Append-only: the client's current status lives on investors.kyc_status;
 * this is how it got there. Written by lib/kyc/refresh.ts.
 */

import { boolean, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { investors } from "./investors";
import { users } from "./users";

export const kycChecks = pgTable(
  "kyc_checks",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    investorId: uuid("investor_id").references(() => investors.id, { onDelete: "set null" }),
    pan: text("pan").notNull(),
    source: text("source").notNull(),
    trigger: text("trigger", { enum: ["manual", "nightly"] }).notNull(),
    outcome: text("outcome", { enum: ["ok", "service_down", "error"] }).notNull(),
    kraFlag: text("kra_flag"),
    kraRemark: text("kra_remark"),
    kraName: text("kra_name"),
    kraStatusDate: text("kra_status_date"),
    statusBefore: text("status_before"),
    statusAfter: text("status_after"),
    changed: boolean("changed").default(false).notNull(),
    error: text("error"),
    checkedBy: uuid("checked_by").references(() => users.id),
    ...timestamps,
  },
  (t) => ({
    investorIdx: index("kyc_checks_investor_idx").on(t.tenantId, t.investorId, t.createdAt),
  })
);
