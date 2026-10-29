/**
 * The holdings an equity-exposure figure is worked out from. SERVER-ONLY.
 *
 * A client's holdings reach the CRM two ways: a registrar holdings / AUM file
 * (stored on the folio's `schemes`) or the transaction ledger (units bought less
 * units sold — what the client page, valuation, XIRR and allocation card read).
 * A client who has only the second has folios with no schemes and no value, so
 * an exposure read from the folio rows alone said "no holdings" while the page
 * beside it showed ₹18,972 of equity. The suitability email refused to send,
 * the page's suitability panel said "unknown", and proposals carried the same
 * blank.
 *
 * Here the LIVE valuation wins when it holds anything of value — the same
 * rule the allocation card uses — and the stored folio rows are the fallback.
 * Either way a holding without a category takes the AMFI master's
 * (withSchemeCategories: code, ISIN, then an unambiguous name); one the master
 * cannot place stays unclassified and the 25% coverage rule still applies.
 * Nothing is guessed from a scheme's name.
 */

import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { folios } from "@/db/schema";
import { withSchemeCategories } from "@/lib/investors/scheme-categories";
import { valueInvestor, type InvestorValuation } from "@/lib/finance/valuation";

export type ExposureLeg = { schemeCode?: string | null; schemeName?: string | null; category?: string | null; value?: number | null };
export type ExposureFolio = { aum?: string | number | null; schemes?: ExposureLeg[] | null };

export async function loadExposureBook(
  tx: Tx,
  tenantId: string,
  investorId: string,
  /** The valuation the caller already has — saves recomputing it. */
  valuation?: Pick<InvestorValuation, "holdings"> | null
): Promise<ExposureFolio[]> {
  let live: InvestorValuation["holdings"] = [];
  try {
    const v = valuation ?? (await valueInvestor(tx, investorId));
    live = (v.holdings ?? []).filter((h) => (h.currentValue ?? 0) > 0);
  } catch (err) {
    // A valuation failure must not block the check — the stored folios still answer it.
    console.warn("[exposure-book] valuation unavailable, using stored folios:", (err as Error)?.message);
  }

  if (live.length) {
    return withSchemeCategories(
      tx,
      live.map((h) => ({
        aum: h.currentValue,
        schemes: [{ schemeCode: h.schemeCode, schemeName: h.schemeName, value: h.currentValue ?? 0 }],
      }))
    );
  }

  return withSchemeCategories(
    tx,
    await tx
      .select({ aum: folios.aum, schemes: folios.schemes })
      .from(folios)
      .where(and(eq(folios.tenantId, tenantId), eq(folios.investorId, investorId)))
  );
}
