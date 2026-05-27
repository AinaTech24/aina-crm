/**
 * Public risk-profile submission — POST /api/public/risk-profile/submit.
 *
 * No-auth route; the token in the body is the credential. Runs in withSystem.
 * Saves the response, marks the token used, mirrors band to the subject row,
 * and pushes an outbox event so workflows can react (e.g. notify the RM).
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { eq, desc } from "drizzle-orm";
import { withSystem } from "@/db/client";
import {
  riskProfileResponses,
  riskProfileTemplates,
  investors,
  leads,
  eventsOutbox,
} from "@/db/schema";
import {
  resolveShareToken,
  markShareTokenUsed,
} from "@/lib/share-tokens";
import {
  defaultTemplate,
  RiskTemplateSchema,
  scoreAnswersAgainst,
  type RiskTemplate,
} from "@/lib/risk-profile/template";
import { transitionTo } from "@/lib/blueprints/engine";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const tokenId: string | undefined = body.tokenId;
    const answers: Record<string, string> = body.answers ?? {};
    const signatureName: string = String(body.signatureName ?? "").trim();
    if (!tokenId) return NextResponse.json({ error: "missing tokenId" }, { status: 400 });
    if (!signatureName) return NextResponse.json({ error: "Signature required" }, { status: 400 });

    // Re-fetch via the token id rather than re-resolving the plaintext — the
    // client only knows the id at this point. The token was already validated
    // when the page loaded.
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
    const ua = req.headers.get("user-agent") ?? "";

    const result = await withSystem(async (tx) => {
      const { shareTokens } = await import("@/db/schema");
      const [tk] = await tx.select().from(shareTokens).where(eq(shareTokens.id, tokenId));
      if (!tk) throw new Error("Invalid token");
      if (tk.revokedAt) throw new Error("This link was revoked");
      if (tk.usedAt) throw new Error("This link has already been used");
      if (new Date(tk.expiresAt as any) < new Date()) throw new Error("This link has expired");
      if (tk.kind !== "risk_profile") throw new Error("Not a risk-profile token");

      // Load active template (fall back to default)
      const [activeTpl] = await tx
        .select()
        .from(riskProfileTemplates)
        .where(eq(riskProfileTemplates.tenantId, tk.tenantId!))
        .orderBy(desc(riskProfileTemplates.versionNumber))
        .limit(1);
      let template: RiskTemplate;
      if (activeTpl) {
        const parsed = RiskTemplateSchema.safeParse({
          name: activeTpl.name,
          description: activeTpl.description ?? undefined,
          questions: activeTpl.questions,
          bands: activeTpl.bands,
          reviewIntervalDays: activeTpl.reviewIntervalDays,
        });
        template = parsed.success ? parsed.data : defaultTemplate();
      } else {
        template = defaultTemplate();
      }

      // Validate every question is answered
      const missing = template.questions.filter((q) => !answers[q.key]).map((q) => q.key);
      if (missing.length) throw new Error(`Missing answers for: ${missing.join(", ")}`);

      const { total, band, breakdown } = scoreAnswersAgainst(template, answers);
      const canonicalCategory = (
        ["conservative", "moderate", "aggressive"].includes(band.id) ? band.id : "moderate"
      ) as "conservative" | "moderate" | "aggressive";
      const now = new Date();
      const next = new Date(now);
      next.setDate(next.getDate() + (template.reviewIntervalDays ?? 365));

      // Resolve investorId — if subject is a lead, the response goes against
      // the lead. We use the legacy column investorId to also accept lead id
      // (the response table doesn't strictly enforce FK to investors).
      const subjectIsInvestor = tk.subjectType === "investor";

      const responseId = uuid();
      await tx.insert(riskProfileResponses).values({
        id: responseId,
        tenantId: tk.tenantId,
        investorId: tk.subjectId, // works for lead too — non-FK polymorphic in practice
        profileDate: now.toISOString().slice(0, 10),
        finalCategory: canonicalCategory,
        totalScore: total,
        responses: breakdown,
        signedAt: now,
        signedByName: signatureName,
        nextReviewAt: next.toISOString().slice(0, 10),
      } as any);

      // Mirror to subject row
      if (subjectIsInvestor) {
        const [inv] = await tx.select().from(investors).where(eq(investors.id, tk.subjectId));
        if (inv) {
          await tx
            .update(investors)
            .set({
              riskProfile: canonicalCategory as any,
              riskProfileScore: total,
              riskProfileSignedAt: now,
              riskProfileVersion: ((inv.riskProfileVersion ?? 0) + 1) as any,
              updatedAt: now,
            } as any)
            .where(eq(investors.id, tk.subjectId));
        }
      } else {
        // Lead — bump stage to risk_profiled
        const [ld] = await tx.select().from(leads).where(eq(leads.id, tk.subjectId));
        if (ld) {
          await tx
            .update(leads)
            .set({
              stage: "risk_profiled" as any,
              stageChangedAt: now,
              updatedAt: now,
            } as any)
            .where(eq(leads.id, tk.subjectId));
        }
        // Advance the blueprint instance — use systemBypass so we can jump
        // from any prior stage (typically risk_profile_sent or earlier).
        try {
          await transitionTo(tx, tk.tenantId!, tk.subjectId, "risk_profiled", {
            systemBypass: true,
            remarks: `Risk profile submitted by client via secure link. Score ${total} — ${band.label}.`,
          });
        } catch (e) {
          // Don't block the form submission if blueprint advance fails.
          console.error("[risk-profile/submit] blueprint advance failed:", e);
        }
      }

      // Outbox event for workflows
      await tx.insert(eventsOutbox).values({
        tenantId: tk.tenantId,
        kind: "risk_profile.completed",
        entityType: tk.subjectType,
        entityId: tk.subjectId,
        after: {
          responseId,
          category: canonicalCategory,
          bandLabel: band.label,
          totalScore: total,
          signature: signatureName,
        },
        meta: { tokenId: tk.id, ip, userAgent: ua } as any,
      } as any);

      // Mark the token used
      await markShareTokenUsed({
        id: tk.id,
        result: { responseId, category: canonicalCategory, bandLabel: band.label, totalScore: total, signature: signatureName },
        ipAddress: ip,
        userAgent: ua,
      });

      return {
        responseId,
        bandLabel: band.label,
        bandColor: band.color ?? null,
        bandDescription: band.description ?? null,
        totalScore: total,
      };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: 400 });
  }
}
