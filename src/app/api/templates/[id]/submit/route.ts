/**
 * POST /api/templates/[id]/submit
 *
 * Moves a draft template into the approval pipeline.
 *   - For utility/transactional WhatsApp: auto-submit to AiSensy (and Meta).
 *   - For marketing: requires a compliance officer to approve first.
 *   - For email: marks ready (no external approval needed beyond compliance).
 *
 * Compliance gate is re-run on submit — any `block` finding rejects the
 * submission outright.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { templates, templateVersions, templateApprovals, tenants } from "@/db/schema";
import { runComplianceChecks } from "@/lib/comms/compliance";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "template.edit");

    const result = await withTenant(session.tenantId, async (tx) => {
      const tpl = (await tx.select().from(templates).where(and(eq(templates.id, id), eq(templates.tenantId, session.tenantId))).limit(1))[0];
      if (!tpl) throw Object.assign(new Error("template not found"), { status: 404 });
      const ver = (await tx
        .select()
        .from(templateVersions)
        .where(and(eq(templateVersions.templateId, id), eq(templateVersions.tenantId, session.tenantId), eq(templateVersions.approvalStatus, "draft")))
        .limit(1))[0];
      if (!ver) throw Object.assign(new Error("no draft version"), { status: 400 });

      const t = (await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1))[0];

      // Re-run compliance gate
      const text = extractText(tpl.channel, ver.body);
      const compliance = runComplianceChecks({
        channel: tpl.channel as any,
        category: tpl.category as any,
        tenant: {
          legalName: t?.legalName ?? "",
          arn: t?.arn ?? "",
          principalEuin: t?.principalEuin ?? undefined,
          riaRegistered: t?.riaRegistered ?? false,
        },
        text,
        subject: tpl.channel === "email" ? (ver.body as any)?.subject : undefined,
        dltTemplateId: tpl.channel === "sms" ? (ver.body as any)?.dltTemplateId : undefined,
      });

      if (compliance.blocked) {
        throw Object.assign(new Error("compliance blocked"), { status: 422, compliance });
      }

      // Log the auto-compliance step
      await tx.insert(templateApprovals).values({
        templateVersionId: ver.id,
        tenantId: session.tenantId,
        step: "auto_compliance",
        decision: "approved",
        notes: `score=${compliance.score}`,
        decidedAt: new Date(),
      } as any);

      let nextStatus = "submitted";
      let templateStatus = "pending_approval";

      if (tpl.category === "marketing") {
        // Needs human compliance officer
        await tx.insert(templateApprovals).values({
          templateVersionId: ver.id,
          tenantId: session.tenantId,
          step: "compliance_officer",
          decision: "pending",
        } as any);
      } else {
        // Utility/transactional: skip officer step, mark approved-internal
        await tx.insert(templateApprovals).values({
          templateVersionId: ver.id,
          tenantId: session.tenantId,
          step: "compliance_officer",
          decision: "approved",
          notes: "auto-approved for non-marketing category",
          decidedAt: new Date(),
        } as any);
        nextStatus = "approved_internal";
        templateStatus = "approved";

        // WhatsApp: queue submission to AiSensy/Meta (handled by aisensy-template-sync worker)
        if (tpl.channel === "whatsapp") {
          // The worker picks up templates with externalRef IS NULL and submits.
        }
      }

      await tx
        .update(templateVersions)
        .set({
          approvalStatus: nextStatus,
          complianceChecks: compliance,
          complianceScore: String(compliance.score),
        } as any)
        .where(and(eq(templateVersions.id, ver.id), eq(templateVersions.tenantId, session.tenantId)));

      await tx.update(templates).set({ status: templateStatus } as any).where(and(eq(templates.id, id), eq(templates.tenantId, session.tenantId)));

      return { compliance, nextStatus, templateStatus };
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "internal", compliance: err.compliance },
      { status: err.status ?? 500 }
    );
  }
}

function extractText(channel: string, body: any): string {
  if (!body) return "";
  if (channel === "whatsapp")
    return [body?.header?.text, body?.body?.text, body?.footer?.text].filter(Boolean).join("\n");
  if (channel === "email")
    return [
      body?.subject,
      body?.preheader,
      (body?.blocks ?? []).map((b: any) => b?.text ?? b?.content ?? "").filter(Boolean).join("\n"),
      body?.textFallback,
    ]
      .filter(Boolean)
      .join("\n");
  if (channel === "sms") return body?.text ?? "";
  return JSON.stringify(body);
}
