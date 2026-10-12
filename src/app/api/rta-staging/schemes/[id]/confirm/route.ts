import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { withTenant } from "@/db/client";
import { assertRtaImportAccess, isUuid } from "@/lib/rta/import-access";
import { confirmSchemeCode, EVIDENCE_SOURCES, SchemeMappingError, type EvidenceSource } from "@/lib/rta/scheme-resolution";
import { reprocessHeldTransactions } from "@/lib/rta/posting/reprocess";

/**
 * POST /api/rta-staging/schemes/:id/confirm — a person states which AMFI
 * scheme (the CRM Scheme Master key) a registrar code is (Phase 3H), citing
 * the evidence (Phase 3I). The server refuses a scheme that is not in the AMFI
 * feed, or one the registrar's own ISIN, a platform mapping, the registrar
 * AMC's established identity or explicit plan / option words contradict;
 * records the decision, its evidence and its reason in the audit log;
 * then re-evaluates the transactions held on that code. While posting is
 * paused the mapping is kept and they post on resume.
 */
export const dynamic = "force-dynamic";
const Body = z.object({
  amfiSchemeCode: z.string().trim().min(1).max(20), note: z.string().trim().min(10).max(500),
  evidenceSource: z.enum(Object.keys(EVIDENCE_SOURCES) as [EvidenceSource, ...EvidenceSource[]]),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();
    requireCap(session.roles, "transactions.execute", session.permissions);
    if (!isUuid(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "choose the AMFI scheme, where the evidence comes from, and say why (10–500 characters)" }, { status: 400 });
    const ctx = { userId: session.userId, branchId: session.branchId, roles: session.roles };
    const out = await withTenant(session.tenantId, async (tx) => {
      await assertRtaImportAccess(tx, session);
      const decision = await confirmSchemeCode(tx, session.tenantId, id, { ...parsed.data, by: session.userId });
      const k = (await tx.execute(sql`SELECT rta, rta_amc_code, rta_scheme_code FROM scheme_rta_codes WHERE id = ${id}::uuid`)).rows[0] as { rta: string; rta_amc_code: string; rta_scheme_code: string };
      return { decision, key: { rta: k.rta, amcCode: k.rta_amc_code, schemeCode: k.rta_scheme_code } };
    }, ctx);
    let reevaluation: unknown = null;
    let pending: string | null = null;
    try {
      reevaluation = await reprocessHeldTransactions(session.tenantId, { schemeKeys: [out.key], userId: session.userId });
    } catch (e: any) {
      if (e?.name !== "PostingGateError") throw e;
      pending = `Mapping saved. The held transactions post when posting resumes (${e.message}).`;
    }
    return NextResponse.json({ decision: out.decision, reevaluation, pending });
  } catch (err: any) {
    if (err instanceof SchemeMappingError || err?.status === 404) return NextResponse.json({ error: err.message }, { status: err.status ?? 409 });
    return handleApiError(err);
  }
}
