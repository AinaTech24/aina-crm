/**
 * Lead sources as people read them. The Leads filters, the quick filter and the
 * kanban card all use this list, so "referral" reads "Client Referral" on every
 * one of them. Pure data: safe to import from client components.
 */
export const LEAD_SOURCE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "referral", label: "Client Referral" },
  { value: "existing_client", label: "Existing Client Reference" },
  { value: "website", label: "Website" },
  { value: "social_media", label: "Social Media" },
  { value: "webinar", label: "Webinar" },
  { value: "seminar", label: "Seminar" },
  { value: "walk_in", label: "Walk-in" },
  { value: "google", label: "Google" },
  { value: "cold_call", label: "Cold Call" },
  { value: "manual", label: "Manual entry" },
  { value: "other", label: "Other" },
];

/** A source value's label; an unlisted value (an import's own vocabulary) is humanised. */
export function leadSourceLabel(source: string | null | undefined): string {
  if (!source) return "—";
  const hit = LEAD_SOURCE_OPTIONS.find((o) => o.value === source);
  if (hit) return hit.label;
  const words = source.replace(/_/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "—";
}
