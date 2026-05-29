import { boolean, date, index, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { branches } from "./branches";

export const users = pgTable(
  "users",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    branchId: uuid("branch_id").references(() => branches.id),
    email: text("email").notNull(),
    name: text("name").notNull(),
    phone: text("phone"),
    passwordHash: text("password_hash"),
    avatarUrl: text("avatar_url"),

    /** Stacked roles. A user is often owner + RM + compliance simultaneously.
     *  'platform_admin' is reserved for AINA staff who manage the SaaS itself.
     *  'platform_admin' users always have tenant_id = PLATFORM_TENANT_ID. */
    roles: text("roles", {
      enum: [
        "platform_admin",
        "platform_support",
        "owner",
        "compliance",
        "branch_head",
        "rm",
        "back_office",
        "ops",
        "marketing",
        "team_member",
        "investor",
      ],
    })
      .array()
      .notNull()
      .default(["rm"]),

    /**
     * Module 19 spec — Department this employee belongs to. Separate from
     * `roles` because a user can be (e.g.) RM + Compliance but belong to a
     * single department for reporting / target-rollup purposes.
     */
    department: text("department", {
      enum: [
        "sales",
        "operations",
        "back_office",
        "compliance",
        "marketing",
        "advisory",
        "support",
        "leadership",
        "other",
      ],
    }),

    /** Date the employee joined the firm (separate from invitedAt/activatedAt). */
    joiningDate: date("joining_date"),

    /** Reporting line — points at another user in the same tenant. */
    reportingManagerId: uuid("reporting_manager_id"),

    /** Annual sales/AUM target in ₹ (used by RM-wise business report). */
    annualTarget: numeric("annual_target", { precision: 18, scale: 2 }),
    /** Monthly SIP-mobilisation target in ₹ (used by SIP book report). */
    sipMonthlyTarget: numeric("sip_monthly_target", { precision: 18, scale: 2 }),

    /** Free-form HR / manager notes. */
    notes: text("notes"),

    euin: text("euin"),
    nismCertificateNo: text("nism_cert_no"),
    nismExpiryAt: date("nism_expiry_at"),
    nismCategory: text("nism_category"), // V-A, V-B, etc.

    territory: jsonb("territory").$type<{ states?: string[]; cities?: string[]; pincodes?: string[] }>(),

    twoFaEnabled: boolean("two_fa_enabled").default(false),
    twoFaSecret: text("two_fa_secret"),
    permissions: jsonb("permissions").$type<string[]>(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    status: text("status", { enum: ["invited", "active", "suspended", "offboarding", "offboarded"] })
      .notNull()
      .default("invited"),
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    offboardedAt: timestamp("offboarded_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    emailUnique: uniqueIndex("users_tenant_email_unique").on(t.tenantId, t.email),
    deptIdx: index("users_tenant_department_idx").on(t.tenantId, t.department, t.status),
    managerIdx: index("users_reporting_manager_idx").on(t.tenantId, t.reportingManagerId),
  })
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
