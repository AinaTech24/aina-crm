/**
 * A family's name from its head — one rule for the New family form, which
 * shows the name before saving, and POST /api/families, which saves it.
 * Plain module: the form is a client component.
 *
 * The firm's pattern (Family settings, "{head} Family" by default) wraps a
 * PERSON'S name. A name that already reads as a household ("Adesh Manocha
 * Family", "Sharma Trust", "… HUF") is used as given — the pattern used to
 * turn it into "Adesh Manocha Family Family".
 */

export const DEFAULT_FAMILY_NAME_PATTERN = "{head} Family";

export function looksLikeHousehold(name: string): boolean {
  return /\b(family|families|group|trust|huf|household)\s*$/i.test((name ?? "").trim());
}

export function familyNameForHead(headName: string, pattern: string = DEFAULT_FAMILY_NAME_PATTERN): string {
  const head = (headName ?? "").trim().replace(/\s+/g, " ");
  if (!head) return "";
  if (looksLikeHousehold(head)) return head.slice(0, 120);
  const named = (pattern || DEFAULT_FAMILY_NAME_PATTERN).replace(/\{head\}/gi, head).trim().slice(0, 120);
  return named || `${head} Family`.slice(0, 120);
}
