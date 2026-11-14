import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/pincode/[pin] — the city (India Post district) and state for an
 * Indian pincode, for the client forms' address auto-fill
 * (lib/pincode/autofill.ts decides what is filled: blanks only).
 *
 * Any signed-in user; no client data is read or written. The lookup is
 * India Post's public directory through lookupPincode (cached per process).
 * 404 when the pincode is unknown or the directory does not answer — the form
 * then simply leaves the fields to the user.
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { lookupPincode } from "@/lib/pincode/lookup";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ pin: string }> }) {
  try {
    await requireSession();
    const { pin } = await params;
    if (!/^[1-9]\d{5}$/.test(pin)) return NextResponse.json({ error: "A pincode is 6 digits." }, { status: 400 });
    const place = await lookupPincode(pin);
    if (!place) return NextResponse.json({ error: "Pincode not found." }, { status: 404 });
    return NextResponse.json({ pincode: pin, city: place.city, state: place.state, country: "India" });
  } catch (err) {
    return handleApiError(err);
  }
}
