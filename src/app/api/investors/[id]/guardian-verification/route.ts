import { handleApiError } from "@/lib/api/error-handler";
/**
 * /api/investors/[id]/guardian-verification — a minor's guardian status
 * (lib/investors/guardian-verification.ts, G-1).
 *
 * GET  anyone who can open the minor: { status, label }.
 * POST the owner or compliance (`compliance.approve`) confirms a guardian
 *      verified OUTSIDE the CRM — the guardian is not a client, or the PAN
 *      could not be linked. Body { note } (what was checked: documents seen,
 *      who confirmed). Written straight to the audit log as
 *      `investor.guardian_verified`; the status is read from that row, so a
 *      confirmation that is not recorded never takes effect. Linking the
 *      guardian's client record in the Guardian section resolves it as well.
 *
 * A refusal never says anything about the guardian: not found, not allowed
 * and nothing to confirm are the only answers.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import { withTenant } from "@/db/client";
import { auditLog } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { clientMetaFromHeaders } from "@/lib/audit";
import { loadViewableInvestor } from "@/lib/investors/access";
import { guardianVerification, guardianVerificationLabel } from "@/lib/investors/guardian-verification";

export const dynamic = "force-dynamic";

const Body = z.object({ note: z.string().trim().min(10, "Say what was checked (at least 10 characters).").max(1000) });

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

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();
    requireCap(session.roles, "compliance.approve", session.permissions);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: parse.error.issues[0]?.message ?? "invalid body", field: "note" }, { status: 400 });
    const meta = clientMetaFromHeaders(req.headers);

    const out = await withTenant(session.tenantId, async (tx) => {
      if (!(await loadViewableInvestor(tx, session, id))) return { code: 404 as const };
      const before = await guardianVerification(tx, session.tenantId, id);
      if (before !== "pending" && before !== "not_recorded") return { code: 409 as const, status: before };
      // Directly, not through recordAudit (which swallows a failed write): the
      // status IS this row.
      await tx.insert(auditLog).values({
        id: uuid(),
        tenantId: session.tenantId,
        actorUserId: session.userId,
        actorType: "user",
        action: "investor.guardian_verified",
        entityType: "investor",
        entityId: id,
        before: { status: before },
        after: { status: "confirmed", via: "manual" },
        reason: parse.data.note,
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
      } as any);
      return { code: 200 as const, status: await guardianVerification(tx, session.tenantId, id) };
    });
    if (out.code === 404) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (out.code === 409) return NextResponse.json({ error: "There is nothing to confirm: the guardian is already linked or verified, or this client is not a minor.", status: out.status }, { status: 409 });
    return NextResponse.json({ status: out.status, label: guardianVerificationLabel(out.status) });
  } catch (err) {
    return handleApiError(err);
  }
}
