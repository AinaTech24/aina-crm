/**
 * Lead sources as people read them. The New lead form, the Leads filters, the
 * quick filter, the kanban card and the list all use this list — every value
 * the leads table stores (lib/leads/normalize.ts LEAD_SOURCE_VALUES) — so
 * "referral" reads "Client Referral" on every one of them and every stored
 * source can be filtered on. Pure data: safe to import from client components.
 */
export const LEAD_SOURCE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "referral", label: "Client Referral" },
  { value: "website", label: "Website" },
  { value: "social_media", label: "Social Media" },
  // Paid ads are their own sources (the import and the API already store
  // them): a "Google" filter that missed every Google-ads lead read as a bug.
  { value: "google_ads", label: "Google Ads" },
  { value: "meta_ads", label: "Meta Ads" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "youtube", label: "YouTube" },
  { value: "google", label: "Google (search)" },
  { value: "webinar", label: "Webinar" },
  { value: "seminar", label: "Seminar" },
  { value: "event", label: "Event" },
  { value: "walk_in", label: "Walk-in" },
  { value: "cold_call", label: "Cold Call" },
  { value: "manual", label: "Manual entry" },
  { value: "other", label: "Other" },
];

/**
 * Stored values that mean the same as a listed source. "Existing Client
 * Reference" was a second "Client Referral" in the picker (removed
 * 2026-10-02); older and imported leads still carry `existing_client`, so they
 * read as Client Referral and a Client Referral filter finds them.
 */
const SOURCE_ALIASES: Record<string, string> = { existing_client: "referral" };

/** A filter's source values plus every stored value that means the same. */
export function expandLeadSources(values: readonly string[]): string[] {
  const out = new Set(values);
  for (const [alias, target] of Object.entries(SOURCE_ALIASES)) if (out.has(target)) out.add(alias);
  return [...out];
}

/** A source value's label; an unlisted value (an import's own vocabulary) is humanised. */
export function leadSourceLabel(source: string | null | undefined): string {
  if (!source) return "—";
  source = SOURCE_ALIASES[source] ?? source;
  const hit = LEAD_SOURCE_OPTIONS.find((o) => o.value === source);
  if (hit) return hit.label;
  const words = source.replace(/_/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "—";
}
