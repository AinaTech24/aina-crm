import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { workflowRules } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  requireCap(session.roles, "workflow.edit");
  const { id } = await params;
  const body = await req.json().catch(() => ({} as any));
  const action = String(body.action ?? "lock"); // "lock" | "unlock"
  const reason = body.reason ? String(body.reason) : null;

  const row = await withTenant(session.tenantId, async (tx) => {
    const [r] = await tx
      .update(workflowRules)
      .set(
        action === "unlock"
          ? { locked: false, lockReason: null, lockedBy: null, lockedAt: null, updatedAt: new Date() }
          : { locked: true, lockReason: reason, lockedBy: session.userId, lockedAt: new Date(), updatedAt: new Date() }
      )
      .where(eq(workflowRules.id, id))
      .returning();
    return r;
  });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ rule: row });
}
