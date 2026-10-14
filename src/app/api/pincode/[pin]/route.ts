/**
 * GET /api/pincode/[pin] → { city, state } for an Indian pincode, or 404.
 * The client master fills City and State from it (lib/pincode/lookup.ts).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { lookupPincode } from "@/lib/pincode/lookup";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ pin: string }> }) {
  try {
    await requireSession();
    const { pin } = await params;
    const place = await lookupPincode(String(pin ?? "").trim());
    if (!place) return NextResponse.json({ error: "Pincode not found" }, { status: 404 });
    return NextResponse.json(place, { headers: { "cache-control": "private, max-age=86400" } });
  } catch (err) {
    return handleApiError(err);
  }
}
