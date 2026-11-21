/**
 * The line under a client in a picker — the CRM's InvestorLookup (commit
 * 33604b7b): PAN · mobile · RM. `/api/search` sends `pan` and `pan_display`
 * as the MASKED own PAN (never the stored column, which can hold a registrar
 * key), plus `rm_name`. A blank reads "—", as on the web.
 */

export interface PickerClient {
  pan_display?: string | null;
  pan?: string | null;
  phone?: string | null;
  rm_name?: string | null;
}

export function clientPickerLine(r: PickerClient | null | undefined): string {
  if (!r) return "";
  return [r.pan_display ?? r.pan ?? "—", r.phone || "—", r.rm_name ? `RM ${r.rm_name}` : null].filter(Boolean).join(" · ");
}
