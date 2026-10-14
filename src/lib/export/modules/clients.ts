/**
 * Clients — the Clients list (/dashboard/investors). Rows go through the
 * list's own filter builder (buildInvestorWhere) and the client access scope,
 * so the file is what is on screen. Exporting clients needs the existing
 * "Bulk export clients" permission.
 */

import { sql } from "drizzle-orm";
import { investors } from "@/db/schema";
import { requireInvestorView, investorScopeCondition } from "@/lib/investors/access";
import { buildInvestorWhere } from "@/lib/investors/list-filters";
import { can } from "@/lib/auth/rbac";
import { d, dIst, userName } from "../helpers";
import type { ExportModule } from "../types";
import { clientRiskSql } from "@/lib/risk-profile/own-assessment";

const i = (c: string) => sql.raw(`investors.${c}`);

export const clientsExport: ExportModule = {
  key: "clients",
  label: "Clients",
  fileName: "clients",
  piiSubject: "investor",
  exportCapability: "investor.bulk_export",
  canView: (s) => can(s.roles, "investor.view.all", s.permissions) || can(s.roles, "investor.view.assigned", s.permissions),
  from: sql`investors`,
  async where(tx, session, params) {
    requireInvestorView(session);
    const sp: Record<string, string> = Object.fromEntries(params);
    const filters = buildInvestorWhere(sp, session.userId);
    const scope = await investorScopeCondition(tx, session);
    return [
      sql`${investors.tenantId} = ${session.tenantId}::uuid`,
      sql`${investors.deletedAt} IS NULL`,
      sql`${investors.mergedIntoId} IS NULL`,
      ...(filters ? [filters] : []),
      ...(scope ? [scope] : []),
    ];
  },
  orderBy: sql`investors.aum DESC NULLS LAST, investors.name`,
  columns: [
    { key: "name", label: "Name", group: "Client", sql: i("name"), default: true },
    { key: "status", label: "Status", group: "Client", sql: i("status"), default: true },
    { key: "category", label: "Client grade", group: "Client", sql: i("client_category"), default: true },
    { key: "investor_type", label: "Investor type", group: "Client", sql: i("investor_category") },
    { key: "segment", label: "Segment", group: "Client", sql: i("segment_tag") },
    { key: "tier", label: "Service tier", group: "Client", sql: i("service_tier") },
    { key: "rm", label: "Relationship manager", group: "Client", sql: userName(i("rm_id")), default: true },
    { key: "branch", label: "Branch", group: "Client", sql: sql`(SELECT b.name FROM branches b WHERE b.id = investors.branch_id)` },
    { key: "family", label: "Family", group: "Client", sql: sql`(SELECT COALESCE(f.family_name, f.head_name) FROM families f WHERE f.id = investors.family_id)` },
    { key: "family_role", label: "Family role", group: "Client", sql: i("family_role") },
    { key: "onboarded", label: "Client since", group: "Client", sql: dIst(i("onboarded_at")), kind: "date" },

    { key: "phone", label: "Mobile", group: "Contact", sql: i("phone"), pii: "phone", default: true },
    { key: "whatsapp", label: "WhatsApp number", group: "Contact", sql: i("whatsapp_phone"), pii: "phone" },
    { key: "alt_phone", label: "Alternate phone", group: "Contact", sql: i("alternate_phone"), pii: "phone" },
    { key: "email", label: "Email", group: "Contact", sql: i("email"), pii: "email", default: true },
    { key: "city", label: "City", group: "Contact", sql: sql`investors.address->>'city'` },
    { key: "state", label: "State", group: "Contact", sql: sql`investors.address->>'state'` },
    { key: "pincode", label: "PIN code", group: "Contact", sql: sql`investors.address->>'pincode'`, pii: "address" },
    { key: "address", label: "Address", group: "Contact", sql: sql`concat_ws(', ', investors.address->>'line1', investors.address->>'line2', investors.address->>'city', investors.address->>'state', investors.address->>'pincode')`, pii: "address" },

    { key: "pan", label: "PAN", group: "Identity & KYC", sql: i("pan"), pii: "pan" },
    { key: "name_pan", label: "Name as per PAN", group: "Identity & KYC", sql: i("name_as_per_pan"), pii: "pan" },
    { key: "dob", label: "Date of birth", group: "Identity & KYC", sql: d(i("dob")), kind: "date", pii: "dob" },
    { key: "gender", label: "Gender", group: "Identity & KYC", sql: i("gender") },
    { key: "kyc", label: "KYC status", group: "Identity & KYC", sql: i("kyc_status") },
    { key: "pan_aadhaar", label: "PAN–Aadhaar link", group: "Identity & KYC", sql: i("pan_aadhaar_link_status") },
    { key: "residency", label: "Residency", group: "Identity & KYC", sql: i("residency_status") },
    { key: "fatca", label: "FATCA status", group: "Identity & KYC", sql: i("fatca_status") },
    { key: "ucc", label: "BSE UCC", group: "Identity & KYC", sql: i("bse_ucc_code") },
    { key: "can", label: "NSE CAN", group: "Identity & KYC", sql: i("nse_can_code") },
    { key: "mandate", label: "Mandate status", group: "Identity & KYC", sql: i("mandate_status") },
    { key: "mandate_amt", label: "Mandate amount", group: "Identity & KYC", sql: i("mandate_amount"), kind: "money" },
    { key: "bank", label: "Bank", group: "Identity & KYC", sql: i("bank_name"), pii: "bank" },
    { key: "ifsc", label: "IFSC", group: "Identity & KYC", sql: i("bank_ifsc"), pii: "bank" },
    { key: "nominee", label: "Nominee", group: "Identity & KYC", sql: i("nominee_name") },

    { key: "aum", label: "AUM", group: "Investments", sql: i("aum"), kind: "money", default: true },
    { key: "sip", label: "Monthly SIP", group: "Investments", sql: i("active_sip_amount"), kind: "money", default: true },
    { key: "inflow", label: "Lifetime inflow", group: "Investments", sql: i("lifetime_inflow"), kind: "money" },
    { key: "outflow", label: "Lifetime outflow", group: "Investments", sql: i("lifetime_outflow"), kind: "money" },
    // A minor's risk is their own assessment, never the guardian's copy (G-1).
    { key: "risk", label: "Risk profile", group: "Investments", sql: clientRiskSql("investors").category },
    { key: "risk_signed", label: "Risk profile signed on", group: "Investments", sql: dIst(clientRiskSql("investors").signedAt), kind: "date" },
    { key: "health", label: "Health score", group: "Investments", sql: i("health_score"), kind: "number" },

    { key: "last_txn", label: "Last transaction", group: "Relationship", sql: dIst(i("last_transaction_at")), kind: "date" },
    { key: "last_contact", label: "Last contact", group: "Relationship", sql: dIst(i("last_contact_at")), kind: "date" },
    { key: "last_review", label: "Last review", group: "Relationship", sql: dIst(i("last_review_at")), kind: "date" },
    { key: "next_review", label: "Next review", group: "Relationship", sql: dIst(i("next_review_at")), kind: "date" },
    { key: "occupation", label: "Occupation", group: "Relationship", sql: i("occupation") },
    { key: "income", label: "Income range", group: "Relationship", sql: i("income_range") },
  ],
};
