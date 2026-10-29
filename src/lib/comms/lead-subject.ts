/**
 * A lead as the merge-field subject of a send (`dispatch()` in pipeline.ts).
 *
 * Templates address a lead as {{lead.name}}, {{lead.first_name}} … and sign
 * off through the same `rm_*` keys a client's email uses — for a lead those
 * are its OWNER's, the person who will follow it up. Pure, so the shape is
 * tested without a database.
 */

export type LeadOwner = {
  name: string | null;
  email: string | null;
  phone: string | null;
  signatureUrl: string | null;
} | null;

export function leadSubject(
  lead: Record<string, unknown>,
  owner: LeadOwner,
  designation: string,
  absolute: (url: string) => string
): Record<string, unknown> {
  const name = String(lead.name ?? "").trim();
  return {
    ...lead,
    first_name: name.split(/\s+/)[0] ?? "",
    owner_name: owner?.name ?? "",
    rm_name: owner?.name ?? "",
    rm_email: owner?.email ?? "",
    rm_phone: owner?.phone ?? "",
    rm_designation: designation,
    rm_signature_url: owner?.signatureUrl ? absolute(owner.signatureUrl) : "",
  };
}
