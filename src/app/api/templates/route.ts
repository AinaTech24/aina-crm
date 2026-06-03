import { handleApiError } from "@/lib/api/error-handler";
/**
 * Templates collection.
 *
 *   GET  /api/templates           — list templates in tenant
 *   POST /api/templates           — create new template + draft version 1
 *
 * Every save runs the compliance gate; the result is snapshotted on the version.
 * Marketing-category templates need explicit human approval before they can send.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, requireAny } from "@/lib/auth/rbac";
import { tenants, templates, templateVersions } from "@/db/schema";
import { runComplianceChecks } from "@/lib/comms/compliance";
import { findUndeclaredPlaceholders } from "@/lib/comms/tokens";

export const dynamic = "force-dynamic";

const VariableDecl = z.object({
  key: z.string(),
  type: z.enum(["string", "number", "currency", "date", "boolean", "url"]),
  source: z.string().optional(),
  required: z.boolean().optional(),
  fallback: z.any().optional(),
  format: z.string().optional(),
});

const CreateBody = z.object({
  key: z.string().min(2).max(80).regex(/^[a-z0-9_]+$/, "lowercase, underscore, numbers only"),
  channel: z.enum(["whatsapp", "email", "sms", "inapp"]),
  name: z.string().min(2).max(120),
  description: z.string().max(1000).optional(),
  category: z.enum(["transactional", "utility", "marketing", "authentication"]).default("transactional"),
  locale: z.string().default("en-IN"),
  body: z.any(),
  variables: z.array(VariableDecl).default([]),
  attachments: z.array(z.object({ name: z.string().max(200), url: z.string().max(2000) })).default([]),
});

export async function GET() {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["template.view", "template.edit", "communication.send", "workflow.edit"], session.permissions);
    const rows = await withTenant(session.tenantId, async (tx) => {
      return tx
        .select()
        .from(templates)
        .where(eq(templates.tenantId, session.tenantId))
        .orderBy(desc(templates.updatedAt));
    });
    return NextResponse.json({ templates: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "template.edit");
    const parse = CreateBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const body = parse.data;

    const tplId = uuid();
    const verId = uuid();

    const result = await withTenant(session.tenantId, async (tx) => {
      // Fetch tenant for compliance context
      const tenant = await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
      const t = tenant[0];

      // Render plain text for compliance scan
      const previewText = extractText(body.channel, body.body);
      const subject = body.channel === "email" ? (body.body?.subject ?? "") : undefined;
      const dltTemplateId = body.channel === "sms" ? body.body?.dltTemplateId : undefined;

      const compliance = runComplianceChecks({
        channel: body.channel as any,
        category: body.category as any,
        tenant: {
          legalName: t?.legalName ?? "",
          arn: t?.arn ?? "",
          principalEuin: t?.principalEuin ?? undefined,
          riaRegistered: t?.riaRegistered ?? false,
        },
        text: previewText,
        subject,
        dltTemplateId,
      });

      await tx.insert(templates).values({
        id: tplId,
        tenantId: session.tenantId,
        key: body.key,
        channel: body.channel,
        name: body.name,
        description: body.description,
        category: body.category,
        locale: body.locale,
        status: "draft",
        currentVersionId: verId,
      } as any);

      await tx.insert(templateVersions).values({
        id: verId,
        templateId: tplId,
        tenantId: session.tenantId,
        versionNumber: 1,
        body: body.body,
        variables: body.variables,
        attachments: body.attachments ?? [],
        complianceChecks: compliance,
        complianceScore: String(compliance.score),
        autoComplianceBlocked: compliance.blocked,
        approvalStatus: "draft",
        createdByUserId: session.userId,
      } as any);

      // Non-blocking authoring hint: merge fields used in the body but not
      // declared as variables will render blank at send.
      const undeclared = findUndeclaredPlaceholders(previewText, body.variables.map((v) => v.key));
      const warnings = undeclared.length
        ? [`Undeclared merge fields will render blank: ${undeclared.map((k) => `{{${k}}}`).join(", ")}`]
        : [];

      return { id: tplId, versionId: verId, compliance, warnings };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    if (String(err?.message).includes("templates_tenant_key_channel_locale_unique")) {
      return NextResponse.json({ error: "template key already exists for this channel + locale" }, { status: 409 });
    }
    return handleApiError(err);
  }
}

function extractText(channel: string, body: any): string {
  if (!body) return "";
  if (channel === "whatsapp") {
    return [body?.header?.text, body?.body?.text, body?.footer?.text].filter(Boolean).join("\n");
  }
  if (channel === "email") {
    const blocks = body?.blocks ?? [];
    const txt = blocks
      .map((b: any) => b?.text ?? b?.content ?? "")
      .filter(Boolean)
      .join("\n");
    return [body?.subject, body?.preheader, txt, body?.textFallback].filter(Boolean).join("\n");
  }
  if (channel === "sms") {
    return body?.text ?? "";
  }
  return JSON.stringify(body);
}
