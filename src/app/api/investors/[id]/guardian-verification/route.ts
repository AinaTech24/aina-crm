import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/investors/[id]/guardian-verification — a minor's guardian status
 * (lib/investors/guardian-verification.ts, G-1). Read-only: anyone who can
 * open the minor gets { status, label }; anyone else gets 404.
 *
 * There is no POST. A guardian is verified only by linking a CRM client
 * record (the normal, access-checked, audited link in Edit client). A note
 * typed by one person is not identity evidence, so a guardian who is not a
 * CRM client stays pending until a verified-evidence workflow exists
 * (owner decision, 2026-10-15). Never automatically merge duplicate-PAN
 * clients.
 */
import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { loadViewableInvestor } from "@/lib/investors/access";
import { guardianVerification, guardianVerificationLabel } from "@/lib/investors/guardian-verification";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();
    const out = await withTenant(session.tenantId, async (tx) => {
      if (!(await loadViewableInvestor(tx, session, id))) return null;
      const status = await guardianVerification(tx, session.tenantId, id);
      return { status, label: guardianVerificationLabel(status) };
    });
    if (!out) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(out);
  } catch (err) {
    return handleApiError(err);
  }
}
