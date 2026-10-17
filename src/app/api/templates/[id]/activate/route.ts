/**
 * POST /api/templates/[id]/activate   body: { versionId }
 *
 * "Use this version": makes an approved version from the template's history the
 * one that is sent (`templates.current_version_id`) and marks the template
 * approved. A draft, submitted or rejected version is refused — see
 * lib/templates/version-use.ts. An open draft is left as it is, still editable.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { handleApiError } from "@/lib/api/error-handler";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { templates, templateVersions, whatsappTemplates } from "@/db/schema";
import { canUseVersion, cannotUseReason } from "@/lib/templates/version-use";

export const dynamic = "force-dynamic";

const Body = z.object({ versionId: z.string().uuid() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "template.edit", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "Pick a version to use." }, { status: 400 });
    const { versionId } = parse.data;

    const clientMeta = clientMetaFromHeaders(req.headers);
    const result = await withTenant(session.tenantId, async (tx) => {
      const tpl = (await tx
        .select()
        .from(templates)
        .where(and(eq(templates.id, id), eq(templates.tenantId, session.tenantId)))
        .limit(1)
        .for("update"))[0];
      if (!tpl) throw Object.assign(new Error("template not found"), { status: 404 });
      // Switching versions must not quietly un-pause or un-archive a template.
      if (tpl.status === "archived" || tpl.status === "paused") {
        throw Object.assign(new Error(`This template is ${tpl.status} — resume it first.`), { status: 400 });
      }

      const ver = (await tx
        .select()
        .from(templateVersions)
        .where(
          and(
            eq(templateVersions.id, versionId),
            eq(templateVersions.templateId, id),
            eq(templateVersions.tenantId, session.tenantId)
          )
        )
        .limit(1))[0];
      if (!ver) throw Object.assign(new Error("version not found"), { status: 404 });

      let metaApproved = false;
      if (tpl.channel === "whatsapp") {
        const meta = (await tx
          .select({ status: whatsappTemplates.metaStatus })
          .from(whatsappTemplates)
          .where(
            and(
              eq(whatsappTemplates.tenantId, session.tenantId),
              eq(whatsappTemplates.metaTemplateName, tpl.key),
              eq(whatsappTemplates.metaStatus, "APPROVED")
            )
          )
          .limit(1))[0];
        metaApproved = !!meta;
      }

      if (!canUseVersion(tpl.channel, ver.approvalStatus, metaApproved)) {
        throw Object.assign(new Error(`${cannotUseReason(ver.approvalStatus)}.`), { status: 400 });
      }

      if (tpl.currentVersionId === ver.id && tpl.status === "approved") {
        return { ok: true, versionId: ver.id, versionNumber: ver.versionNumber, unchanged: true };
      }

      await tx
        .update(templates)
        .set({ currentVersionId: ver.id, status: "approved", updatedAt: new Date() })
        .where(and(eq(templates.id, id), eq(templates.tenantId, session.tenantId)));

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "template.version_activate",
        entityType: "template",
        entityId: id,
        before: { versionId: tpl.currentVersionId, status: tpl.status },
        after: { versionId: ver.id, versionNumber: ver.versionNumber, status: "approved" },
        ...clientMeta,
      });

      return { ok: true, versionId: ver.id, versionNumber: ver.versionNumber };
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
