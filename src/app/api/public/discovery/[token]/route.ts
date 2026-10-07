import { handleApiError } from "@/lib/api/error-handler";
/**
 * Public Financial Discovery ("Financial Health Check") endpoints — no auth.
 *   GET  /api/public/discovery/[token]  — form data + firm branding for rendering
 *   POST /api/public/discovery/[token]  — the client saves progress
 *                                         (`draft: true`) or submits
 *
 * The client fills only their own sections (lib/discovery/validate
 * CLIENT_SECTIONS), cleaned to the form's shape. The risk profile on record
 * and every other server-owned field is never taken from the client.
 *
 * - PAN and mobile go out MASKED: the link can be forwarded, and it is a
 *   bearer credential for 14 days. A masked value sent back means "unchanged"
 *   and the stored value is kept.
 * - Saving progress does not use up the link, so the client can come back to
 *   it; submitting claims it (single-use) and tells the RM.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { financialDiscoveries, tasks, tenants } from "@/db/schema";
import { resolveShareToken, claimShareToken, finalizeShareToken, releaseShareToken } from "@/lib/share-tokens";
import { computeDiscovery, type DiscoveryData } from "@/lib/discovery/calc";
import { cleanSections, keepServerFields } from "@/lib/discovery/validate";
import { forClientLink, isMasked } from "@/lib/discovery/mask";
import { createNotification } from "@/lib/notifications/create";
import { captureError } from "@/lib/observability/capture";
import { enforce } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";


export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const limited = enforce(req, `discovery.get.${token.slice(0, 12)}`, { limit: 60, windowSec: 60 });
    if (limited) return limited;

    const tk = await resolveShareToken(token);
    if (tk.kind !== "financial_discovery") return NextResponse.json({ error: "Invalid link" }, { status: 400 });
    const discoveryId = (tk.payload as any)?.discoveryId as string | undefined;
    if (!discoveryId) return NextResponse.json({ error: "Invalid link" }, { status: 400 });

    const out = await withTenant(tk.tenantId, async (tx) => {
      const disc = (await tx.select().from(financialDiscoveries).where(eq(financialDiscoveries.id, discoveryId)).limit(1))[0];
      const tenant = (await tx.select({ name: tenants.displayName, logo: tenants.logoUrl }).from(tenants).where(eq(tenants.id, tk.tenantId)).limit(1))[0];
      return { disc, tenant };
    });
    if (!out.disc) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // No advisor assessment; PAN and mobile masked (lib/discovery/mask).
    const data = forClientLink(out.disc.data);

    return NextResponse.json({
      firmName: out.tenant?.name ?? "Your advisor",
      firmLogo: out.tenant?.logo ?? null,
      reviewType: out.disc.reviewType,
      data,
      alreadySubmitted: out.disc.status === "submitted" || out.disc.status === "reviewed",
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "This link is not available" }, { status: 400 });
  }
}

/** The stored data with the client's sections applied; masked PAN / mobile keep the stored value. */
function mergeClient(stored: DiscoveryData, body: unknown): DiscoveryData {
  const incoming = cleanSections(body);
  if (incoming.identification) {
    const ident = { ...incoming.identification } as Record<string, any>;
    const prev = (stored.identification ?? {}) as Record<string, any>;
    if (isMasked(ident.pan)) ident.pan = prev.pan ?? "";
    if (isMasked(ident.mobile)) ident.mobile = prev.mobile ?? "";
    incoming.identification = ident;
  }
  return keepServerFields(stored, incoming);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const body = await req.json().catch(() => ({}));
    const draft = body?.draft === true;
    // Progress saves are frequent (autosave); submits are not.
    const limited = enforce(req, `discovery.${draft ? "draft" : "post"}.${token.slice(0, 12)}`, { limit: draft ? 40 : 10, windowSec: 60 });
    if (limited) return limited;

    const tk = await resolveShareToken(token);
    if (tk.kind !== "financial_discovery") return NextResponse.json({ error: "Invalid link" }, { status: 400 });
    const discoveryId = (tk.payload as any)?.discoveryId as string | undefined;
    if (!discoveryId) return NextResponse.json({ error: "Invalid link" }, { status: 400 });

    // ── Save progress: the link stays usable ──────────────────────────────
    if (draft) {
      const saved = await withTenant(tk.tenantId, async (tx) => {
        const disc = (await tx.select().from(financialDiscoveries).where(eq(financialDiscoveries.id, discoveryId)).limit(1))[0];
        if (!disc) return "missing" as const;
        if (disc.status === "submitted" || disc.status === "reviewed") return "closed" as const;
        const merged = mergeClient((disc.data ?? {}) as DiscoveryData, body?.data);
        const computed = computeDiscovery(merged);
        await tx
          .update(financialDiscoveries)
          .set({ data: merged as any, computed: computed as any, healthScore: computed.healthScore, updatedAt: new Date() } as any)
          .where(eq(financialDiscoveries.id, discoveryId));
        return "ok" as const;
      });
      if (saved === "missing") return NextResponse.json({ error: "Not found" }, { status: 404 });
      if (saved === "closed") return NextResponse.json({ error: "This form has already been submitted." }, { status: 409 });
      return NextResponse.json({ ok: true, savedAt: new Date().toISOString() });
    }

    // ── Submit: claim the single-use link before writing ──────────────────
    if (!(await claimShareToken(tk.id))) {
      return NextResponse.json({ error: "This link has already been submitted." }, { status: 409 });
    }

    type Notice = { tenantId: string; rmId: string | null; subjectType: string; subjectId: string; name: string };
    let notice: Notice | null = null;
    try {
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
      notice = await withTenant(tk.tenantId, async (tx): Promise<Notice | null> => {
        const disc = (await tx.select().from(financialDiscoveries).where(eq(financialDiscoveries.id, discoveryId)).limit(1))[0];
        const merged = mergeClient((disc?.data ?? {}) as DiscoveryData, body?.data);
        const computed = computeDiscovery(merged);
        const name = String((merged.identification as any)?.fullName ?? "").trim() || disc?.title || "A client";
        await tx
          .update(financialDiscoveries)
          .set({
            data: merged as any,
            computed: computed as any,
            healthScore: computed.healthScore,
            title: name,
            status: "submitted",
            submittedAt: new Date(),
            updatedAt: new Date(),
          } as any)
          .where(eq(financialDiscoveries.id, discoveryId));
        return disc
          ? {
              tenantId: tk.tenantId,
              rmId: (disc.assignedRmId ?? disc.createdBy ?? null) as string | null,
              subjectType: disc.subjectType,
              subjectId: disc.subjectId,
              name,
            }
          : null;
      });
      await finalizeShareToken({ id: tk.id, result: { submitted: true }, ipAddress: ip ?? undefined, userAgent: req.headers.get("user-agent") ?? undefined });
    } catch (e) {
      await releaseShareToken(tk.id); // let them retry
      throw e;
    }

    // Tell the RM. The only sign used to be a banner on the Discovery list.
    // Separate from the submit so a notification failure can never undo it.
    const n = notice as Notice | null;
    if (n?.rmId) {
      try {
        await withTenant(n.tenantId, async (tx) => {
          const link = `/dashboard/discovery/${discoveryId}`;
          await createNotification(tx, {
            tenantId: n.tenantId,
            userId: n.rmId!,
            kind: "discovery.submitted",
            title: `${n.name} submitted their Financial Health Check`,
            body: "Review the fact-find before your meeting.",
            linkUrl: link,
            severity: "info",
            meta: { discoveryId },
          });
          await tx.insert(tasks).values({
            tenantId: n.tenantId,
            subjectType: n.subjectType === "lead" ? "lead" : "investor",
            subjectId: n.subjectId,
            relatedInvestorId: n.subjectType === "investor" ? n.subjectId : null,
            relatedLeadId: n.subjectType === "lead" ? n.subjectId : null,
            type: "follow_up",
            title: `Review fact-find — ${n.name}`,
            description: `${n.name} submitted their Financial Health Check. Review it at ${link}`,
            priority: "normal",
            status: "open",
            assigneeId: n.rmId,
            dueAt: new Date(Date.now() + 864e5),
            meta: { discoveryId },
          } as any);
        });
      } catch (e) {
        captureError("[discovery] submit notification failed", e, { discoveryId });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
