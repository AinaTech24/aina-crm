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
import { withSystem, withTenant } from "@/db/client";
import {
  riskProfileResponses,
  riskProfileTemplates,
  investors,
  leads,
  eventsOutbox,
} from "@/db/schema";
import {
  claimShareToken,
  releaseShareToken,
  finalizeShareToken,
} from "@/lib/share-tokens";
import {
  defaultTemplate,
  RiskTemplateSchema,
  scoreAnswersAgainst,
  type RiskTemplate,
} from "@/lib/risk-profile/template";
import { transitionTo } from "@/lib/blueprints/engine";
import { enforce } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    // 20 submissions per IP per hour. Real client clicks "Submit" once;
    // a bot trying every (tokenId, answers) combo gets blocked fast.
    const limited = enforce(req, "public.risk-profile", { limit: 20, windowSec: 60 * 60 });
    if (limited) return limited;

    const body = await req.json().catch(() => ({}));
    const tokenId: string | undefined = body.tokenId;
    if (!tokenId) return NextResponse.json({ error: "missing tokenId" }, { status: 400 });

    // Bound the untrusted input. The answers object is keyed by question key;
    // cap the number of entries and each value's length so a single submission
    // can't store an unbounded blob into the responses JSONB.
    const rawAnswers = body.answers;
    if (rawAnswers == null || typeof rawAnswers !== "object" || Array.isArray(rawAnswers)) {
      return NextResponse.json({ error: "invalid answers" }, { status: 400 });
    }
    const answerEntries = Object.entries(rawAnswers as Record<string, unknown>);
    if (answerEntries.length > 100) {
      return NextResponse.json({ error: "too many answers" }, { status: 400 });
    }
    const answers: Record<string, string> = {};
    for (const [k, v] of answerEntries) {
      answers[String(k).slice(0, 120)] = String(v ?? "").slice(0, 500);
    }

    const signatureName: string = String(body.signatureName ?? "").trim().slice(0, 120);
    if (!signatureName) return NextResponse.json({ error: "Signature required" }, { status: 400 });

    // The client cannot ASSERT how it was verified. We do NOT run an OTP check
    // on this path, so recording "client_otp" would overclaim on a SEBI audit
    // trail. The token (single-use, signed, tenant-scoped) is the credential —
    // record that truthfully as a secure-link signature.
    const verificationMethod = "client_link";
    const otpTransactionId: string | undefined = undefined;

    // Re-fetch via the token id rather than re-resolving the plaintext — the
    // client only knows the id at this point. The token was already validated
    // when the page loaded.
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
    const ua = req.headers.get("user-agent") ?? "";

    // Step 1: token lookup needs cross-tenant context (no session yet).
    // This block is intentionally tiny — only the share_tokens read.
    const { shareTokens } = await import("@/db/schema");
    const tk = await withSystem(async (tx) => {
      const [t] = await tx.select().from(shareTokens).where(eq(shareTokens.id, tokenId));
      if (!t) throw new Error("Invalid token");
      if (t.revokedAt) throw new Error("This link was revoked");
      if (t.usedAt) throw new Error("This link has already been used");
      if (new Date(t.expiresAt as any) < new Date()) throw new Error("This link has expired");
      if (t.kind !== "risk_profile") throw new Error("Not a risk-profile token");
      return t;
    });

    // Step 1b: atomically CLAIM the single-use token before doing any work.
    // This is the serialization point — two concurrent submits both pass the
    // read-only validation above, but only the first claim wins. The loser
    // aborts here, so a double-click / race can never create two responses.
    const claimed = await claimShareToken(tokenId);
    if (!claimed) {
      return NextResponse.json({ error: "This link has already been used" }, { status: 409 });
    }

    // Step 2: everything else runs inside the token's tenant scope so RLS
    // guards every read/write. If a future bug ever leaks a tokenId across
    // tenants, the worst case is "the token resolves" — actual mutation
    // is hard-bounded to the tenant the token belongs to.
    // If the work throws after the claim, release the token so the client can
    // retry (the claim is only "confirmed" by finalizeShareToken on success).
    let result;
    try {
      result = await withTenant(tk.tenantId!, async (tx) => {
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
        ["conservative", "moderate", "aggressive", "very_aggressive"].includes(band.id) ? band.id : "moderate"
      ) as "conservative" | "moderate" | "aggressive" | "very_aggressive";
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
        verificationMethod,
        otpTransactionId: otpTransactionId || null,
        clientIp: ip || null,
        clientUserAgent: ua || null,
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

      // Token already claimed up front; we finalize (store result) after the
      // transaction commits — see below.
      return {
        responseId,
        category: canonicalCategory,
        bandLabel: band.label,
        bandColor: band.color ?? null,
        bandDescription: band.description ?? null,
        totalScore: total,
      };
      });
    } catch (e) {
      // Work failed after we claimed the token — release it so the client can
      // retry with the same link instead of being stuck on "already used".
      await releaseShareToken(tokenId).catch(() => {});
      throw e;
    }

    // Confirm the claim by storing the result payload (the token's used_at was
    // already set by claimShareToken).
    await finalizeShareToken({
      id: tk.id,
      result: {
        responseId: result.responseId,
        category: result.category,
        bandLabel: result.bandLabel,
        totalScore: result.totalScore,
        signature: signatureName,
      },
      ipAddress: ip,
      userAgent: ua,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: 400 });
  }
}
