import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { renderEmailHtml } from "@/lib/email-designer/render";
import type { EmailDesignerBody } from "@/lib/email-designer/types";
import { loadPreviewContext } from "@/lib/email-designer/preview-context";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    // Rendering a preview is READ-ONLY: it renders content the caller just typed,
    // using branding they can already see. Gating it behind `template.edit`
    // (granted only to `marketing`) 403'd every other staff role — even though
    // the Templates nav item has no role restriction, so they can all open the
    // designer. Mirror the read gate used by GET /api/templates instead, and
    // pass `session.permissions` so custom per-user grants are honoured (they
    // are additive grants — dropping the argument silently ignored them).
    requireAny(
      session.roles,
      ["template.view", "template.edit", "communication.send", "workflow.edit"],
      session.permissions
    );
    const { body } = await req.json().catch(() => ({ body: null }));
    if (!body) return NextResponse.json({ error: "missing body" }, { status: 400 });

    // Firm branding + sample client data, signed off as the viewer. Shared with
    // the test-send route so the preview and the delivered mail agree.
    const ctx = await loadPreviewContext(session.tenantId, session.userId);

    const html = renderEmailHtml(body as EmailDesignerBody, {
      variables: ctx.variables,
      tenant: ctx.tenant,
      unsubscribeUrl: "#preview",
      previewMarkers: true,
    });
    return NextResponse.json({ html });
  } catch (err: any) {
    // A forbidden capability carries status 403; everything else is a genuine
    // render/server error. Either way, return JSON so the designer shows a
    // helpful message instead of a bare 500 with no context.
    const status = typeof err?.status === "number" ? err.status : 500;
    console.error("[email-preview] preview failed:", err);
    return NextResponse.json({ error: err?.message ?? "preview failed" }, { status });
  }
}
