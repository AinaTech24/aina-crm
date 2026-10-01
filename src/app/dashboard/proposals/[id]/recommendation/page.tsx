/**
 * The old SIP / Lumpsum / SWP / STP "recommendation worksheet".
 *
 * Its rows saved to proposal_schemes, which nothing the client sees ever read:
 * the PDF, the send and the approval page all read proposals.products. Those
 * four kinds are now row types in the builder's one recommendation list, and
 * migration 0225 folded unsent worksheet rows into it. Old links land on the
 * builder instead.
 */

import { redirect } from "next/navigation";

export default async function RecommendationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/dashboard/proposals/${id}/edit`);
}
