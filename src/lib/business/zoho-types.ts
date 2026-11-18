/**
 * Zoho's own business-entry types, for a firm moving off Zoho CRM (We Care
 * Freedom Wealth, 2026-11-18). Each is offered in the entry form's Type
 * picklist for a firm with the "zohoImport" flag, and used by the Zoho MF
 * business import.
 *
 * A line keeps a STANDARD txn_type — that is what every dashboard, target and
 * report counts — and stores the Zoho value as business_entry_lines.type_label
 * (migration 0264). The standard type mirrors how Zoho itself totalled the
 * value, read from the firm's own export: Red. Done by Client and Transfer Out
 * were in Zoho's Total Redemption; Broker Code Change and Switch In in Total
 * Purchase; SIP Auto Stop in SIP Stop; Daily SIP in SIP Added. SIP Pause was in
 * neither, so it is "other" (not counted) — the firm's choice.
 *
 * Pure data: safe for client components.
 */

export type ZohoType = { label: string; txnType: string };

export const ZOHO_TYPES: ZohoType[] = [
  { label: "Red. Done by Client", txnType: "redemption" },
  { label: "Transfer Out from Our Code", txnType: "redemption" },
  { label: "Broker Code Change in Our Code", txnType: "lumpsum" },
  { label: "Switch In Our Code", txnType: "switch" },
  { label: "Daily SIP", txnType: "sip" },
  { label: "SIP Auto Stop", txnType: "sip_stop" },
  { label: "SIP Pause", txnType: "other" },
];

/** Picklist value for a Zoho type: "zoho:<label>". */
export const zohoValue = (label: string) => `zoho:${label}`;

export function zohoTypeFromValue(v: string): ZohoType | null {
  if (!v.startsWith("zoho:")) return null;
  const label = v.slice(5);
  return ZOHO_TYPES.find((t) => t.label === label) ?? null;
}

/** What a line's type reads as: its own label, else the standard one. */
export function lineTypeLabel(typeLabel: string | null | undefined, txnType: string, standard: (t: string) => string): string {
  return typeLabel?.trim() || standard(txnType);
}
