/**
 * Public, uncached feed of the published landing-page pricing cards. The landing
 * page renders the same data server-side for SEO, then polls this endpoint so an
 * already-open tab reflects admin edits live (no manual refresh). No auth — only
 * published, display-only marketing copy is exposed.
 */

import { NextResponse } from "next/server";
import { loadLandingPlans } from "@/lib/landing/packages";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const plans = await loadLandingPlans();
  return NextResponse.json(
    { plans },
    { headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } }
  );
}
