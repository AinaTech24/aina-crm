/** Account identity must survive every valuation/FIFO/report projection. */
export type PositionIdentity = {
  investor_id?: string | null;
  folio_id?: string | null;
  folio_number?: string | null;
  amc_code?: string | null;
  amc_name?: string | null;
  scheme_code?: string | null;
  scheme_name?: string | null;
};

const normalized = (v?: string | null) => v?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";

export function positionKey(row: PositionIdentity): string {
  return JSON.stringify([
    row.investor_id ?? "",
    row.folio_id || [normalized(row.amc_code || row.amc_name), normalized(row.folio_number)],
    normalized(row.scheme_code) || normalized(row.scheme_name) || "unknown",
  ]);
}
