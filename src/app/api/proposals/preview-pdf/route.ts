import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/proposals/preview-pdf — the proposal PDF exactly as it would go out,
 * rendered from what is in the builder right now. Nothing is saved.
 *
 * The builder's Review step shows it, so what the RM checks is the document
 * the client receives (renderProposalPdf — the renderer the download, the
 * email attachment and the client's link all use), not a summary of it.
 *
 * The recipient is authorised the way the snapshot route does it: a client
 * (or a family's member / head) the viewer may open, or a lead in their scope.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { families, leads, tenants } from "@/db/schema";
import { loadViewableInvestor } from "@/lib/investors/access";
import { leadScopeCondition } from "@/lib/leads/access";
import { renderProposalPdf } from "@/lib/proposal/proposal-pdf";
import { loadProposalPdfPeople, proposalBrand } from "@/lib/proposal/pdf-context";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  recipient: z.object({
    type: z.enum(["investor", "lead", "family"]),
    id: z.string().uuid(),
    /** A family proposal about one member. */
    memberId: z.string().uuid().optional(),
  }),
  /** The saved proposal's number, when editing one. */
  proposalNumber: z.string().max(60).optional(),
  version: z.number().int().positive().optional(),
  title: z.string().max(300).default(""),
  riskRating: z.string().max(40).optional(),
  validUntil: z.string().max(40).optional(),
  coverLetter: z.string().max(20000).optional(),
  disclaimer: z.string().max(20000).optional(),
  products: z.array(z.record(z.string(), z.any())).max(100).default([]),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "proposal.write", session.permissions);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const b = parse.data;

    const pdf = await withTenant(session.tenantId, async (tx) => {
      let investorId: string | null = b.recipient.type === "investor" ? b.recipient.id : b.recipient.memberId ?? null;
      let person: { name: string; email: string | null; phone: string | null } | null = null;

      if (b.recipient.type === "family" && !investorId) {
        const [f] = await tx
          .select({ primary: families.primaryInvestorId })
          .from(families)
          .where(and(eq(families.id, b.recipient.id), eq(families.tenantId, session.tenantId)))
          .limit(1);
        investorId = f?.primary ?? null;
      }
      if (investorId) {
        const inv = await loadViewableInvestor(tx as any, session, investorId);
        if (!inv) return null;
        person = { name: inv.name, email: (inv as any).email ?? null, phone: (inv as any).phone ?? null };
      } else if (b.recipient.type === "lead") {
        const [l] = await tx
          .select({ name: leads.name, email: leads.email, phone: leads.phone })
          .from(leads)
          .where(and(eq(leads.id, b.recipient.id), eq(leads.tenantId, session.tenantId), leadScopeCondition(session)))
          .limit(1);
        if (!l) return null;
        person = { name: l.name, email: l.email ?? null, phone: l.phone ?? null };
      }
      if (!person) return null;

      const [t] = await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
      const people = await loadProposalPdfPeople(tx, { tenantId: session.tenantId, preparedByUserId: session.userId, investorId });
      return renderProposalPdf({
        proposal: {
          title: b.title,
          proposalNumber: b.proposalNumber ?? "Draft",
          version: b.version ?? null,
          recipientName: person.name,
          recipientEmail: person.email,
          recipientPhone: person.phone,
          coverLetter: b.coverLetter ?? null,
          disclaimer: b.disclaimer ?? null,
          riskRating: b.riskRating ?? null,
          validUntil: b.validUntil || null,
          preparedAt: new Date().toISOString(),
          products: b.products,
        },
        brand: proposalBrand(t),
        ...people,
      });
    });

    if (!pdf) return NextResponse.json({ error: "Recipient not found" }, { status: 404 });
    return new NextResponse(pdf as any, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="Proposal_preview.pdf"`,
        "cache-control": "no-store",
      },
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
