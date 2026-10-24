/**
 * Filling a WhatsApp template that carries a client's name and a link.
 *
 * A firm can hold two stored copies of one template: the CRM's own
 * ("{{client.name}}", "{{doc.link}}") and the copy Meta approved ("{{1}}",
 * "{{2}}"). dispatch() looks a template up by key AND locale ("en-IN"), and a
 * sender that chose its row some other way filled the variables of the wrong
 * copy — "Required variable '1' is missing" on every document request to
 * Nimesh C Shah's clients (15 Oct 2026). So a sender now picks the row the way
 * dispatch will (pickTemplateRow), passes that row's locale, and fills ITS
 * variables, named or positional (nameAndLinkVariables).
 *
 * Plain module (no "use client"): the route handlers and the onboarding sender
 * both call it.
 */

/** The locale dispatch() looks a template up in unless the caller names one. */
export const DISPATCH_LOCALE = "en-IN";

/** The stored copy dispatch() would send: the default locale's, else the first. */
export function pickTemplateRow<T extends { locale?: string | null }>(rows: T[]): T | null {
  return rows.find((r) => r.locale === DISPATCH_LOCALE) ?? rows[0] ?? null;
}

/**
 * Values for a template's declared variables, given a client's name and a link.
 *  - named keys ("client.name", "doc.link", "upload_url"): by what the key says;
 *  - positional keys ("1", "2" — what a Meta-approved copy carries): the first
 *    placeholder greets the client and the last carries the link; a lone one is
 *    the link;
 *  - nothing recognisable: the first declared variable is the link.
 */
export function nameAndLinkVariables(
  declared: Array<{ key?: string | null }> | null | undefined,
  values: { name: string; link: string },
): Record<string, string> {
  const keys = (declared ?? []).map((d) => d?.key).filter((k): k is string => !!k);
  const out: Record<string, string> = {};

  const linkKey = keys.find((k) => /url|link|doc|upload/i.test(k));
  const nameKey = keys.find((k) => /name|client|investor/i.test(k));
  if (linkKey) out[linkKey] = values.link;
  if (nameKey) out[nameKey] = values.name;

  if (!linkKey && !nameKey) {
    const positional = keys.filter((k) => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b));
    if (positional.length === 1) out[positional[0]] = values.link;
    else if (positional.length > 1) {
      out[positional[0]] = values.name;
      out[positional[positional.length - 1]] = values.link;
    }
  }
  if (!Object.keys(out).length && keys.length) out[keys[0]] = values.link;
  return out;
}
