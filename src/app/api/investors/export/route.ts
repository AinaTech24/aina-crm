import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/investors/export — download the (filtered) client book as an .xlsx.
 *
 * Applies the EXACT same filters as the list page via the shared
 * buildInvestorWhere helper, so the export always matches what's on screen
 * (segment / tier / status / kyc / quick-filter chips / data-gap deep-links /
 * search). Respects the tenant licence's field-gating — columns the firm
 * isn't licensed to see are omitted from the file.
 *
 * MFDs export the book constantly for RTA/AMC reconciliation, mailers and
 * offline review prep. Tenant isolation is enforced by RLS (withTenant).
 */

import { NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";
import * as XLSX from "xlsx";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { investors, users } from "@/db/schema";
import { loadTenantLicense } from "@/lib/auth/license";
import { isFieldAllowed } from "@/lib/auth/field-gate";
import { buildInvestorWhere } from "@/lib/investors/list-filters";

export const dynamic = "force-dynamic";

const MAX_ROWS = 5000;

function ymd(v: unknown): string {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(v as any);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const license = await loadTenantLicense(session.tenantId, session.roles);

    const show = {
      pan: isFieldAllowed(license, "investor", "pan"),
      phone: isFieldAllowed(license, "investor", "phone"),
      email: isFieldAllowed(license, "investor", "email"),
      aum: isFieldAllowed(license, "investor", "aum"),
      sip:
        isFieldAllowed(license, "investor", "active_sip_amount") ||
        isFieldAllowed(license, "investor", "sip"),
      inflow: isFieldAllowed(license, "investor", "lifetime_inflow"),
      kyc:
        isFieldAllowed(license, "investor", "kyc_status") ||
        isFieldAllowed(license, "investor", "kyc"),
      tier:
        isFieldAllowed(license, "investor", "service_tier") ||
        isFieldAllowed(license, "investor", "tier"),
      segment:
        isFieldAllowed(license, "investor", "segment_tag") ||
        isFieldAllowed(license, "investor", "segment"),
      status: isFieldAllowed(license, "investor", "status"),
      risk:
        isFieldAllowed(license, "investor", "risk_profile") ||
        isFieldAllowed(license, "investor", "risk"),
      nominee:
        isFieldAllowed(license, "investor", "nominee_name") ||
        isFieldAllowed(license, "investor", "nominee"),
    };

    // Convert the URL params into the plain object the filter helper expects.
    const sp: Record<string, string | undefined> = {};
    req.nextUrl.searchParams.forEach((v, k) => {
      sp[k] = v;
    });

    const rows = await withTenant(
      session.tenantId,
      async (tx) => {
        const where = buildInvestorWhere(sp, session.userId);
        return tx
          .select({ inv: investors, rmName: users.name })
          .from(investors)
          .leftJoin(users, eq(users.id, investors.rmId))
          .where(where as any)
          .orderBy(desc(investors.aum))
          .limit(MAX_ROWS);
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    // Build gated, human-friendly rows for the sheet.
    const data = rows.map(({ inv, rmName }) => {
      const addr = (inv.address as any) ?? {};
      const row: Record<string, any> = { Name: inv.name };
      if (show.pan) row["PAN"] = inv.pan ?? "";
      if (show.segment) row["Segment"] = inv.segmentTag ?? "";
      if (show.tier) row["Service tier"] = inv.serviceTier ?? "";
      if (show.status) row["Status"] = inv.status ?? "";
      if (show.kyc) row["KYC"] = inv.kycStatus ?? "";
      if (show.risk) row["Risk profile"] = inv.riskProfile ?? "";
      if (show.nominee) row["Nominee"] = inv.nomineeName ?? "";
      if (show.aum) row["AUM (INR)"] = Number(inv.aum ?? 0);
      if (show.sip) row["Monthly SIP (INR)"] = Number(inv.activeSipAmount ?? 0);
      if (show.inflow) row["Lifetime inflow (INR)"] = Number(inv.lifetimeInflow ?? 0);
      row["RM"] = rmName ?? "";
      if (show.phone) row["Phone"] = inv.phone ?? "";
      if (show.email) row["Email"] = inv.email ?? "";
      row["City"] = addr.city ?? "";
      row["Last review"] = ymd(inv.lastReviewAt);
      row["Next review"] = ymd(inv.nextReviewAt);
      row["Last transaction"] = ymd(inv.lastTransactionAt);
      row["Client since"] = ymd(inv.onboardedAt);
      return row;
    });

    // Always emit at least a header row so an empty filter still downloads a
    // valid file rather than a confusing blank.
    const ws = XLSX.utils.json_to_sheet(
      data.length ? data : [{ Name: "(no clients match the current filters)" }]
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Investors");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="investors-${stamp}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
