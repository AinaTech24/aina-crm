export const SUMMARY_LABELS: Record<string, string> = {
  discussion: "Discussion", requirements: "Client requirements", products: "Products discussed",
  objections: "Objections", nextSteps: "Proposed next steps",
};
export function formatSummary(summary: Record<string, string>) {
  return Object.entries(SUMMARY_LABELS).map(([key, label]) => `${label}: ${summary[key] || "Not discussed"}`).join("\n\n");
}
export function summaryNotes(existing: string | null, draft: string) {
  if (!draft.trim()) throw new Error("Review the summary before saving.");
  const block = `Reviewed English call summary:\n${draft.trim()}`;
  if (existing?.endsWith(block)) return { notes: existing, alreadySaved: true };
  const notes = [existing, block].filter(Boolean).join("\n\n");
  if (notes.length > 4000) throw new Error("Notes and summary exceed 4,000 characters. Shorten the draft before saving.");
  return { notes, alreadySaved: false };
}
