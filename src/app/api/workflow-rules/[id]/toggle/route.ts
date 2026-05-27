import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { workflowRules } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  requireCap(session.roles, "workflow.edit");
  const { id } = await params;

  const row = await withTenant(session.tenantId, async (tx) => {
    const [r] = await tx
      .update(workflowRules)
      .set({ enabled: sql`NOT enabled`, updatedAt: new Date() })
      .where(eq(workflowRules.id, id))
      .returning();
    return r;
  });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ rule: row });
}
