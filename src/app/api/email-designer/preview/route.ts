import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { tenants } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { renderEmailHtml } from "@/lib/email-designer/render";
import type { EmailDesignerBody } from "@/lib/email-designer/types";
import { MERGE_FIELDS } from "@/lib/email-designer/merge-fields";

export const dynamic = "force-dynamic";

/** Build a sample-data envelope so the preview shows realistic merge values. */
function buildPreviewVariables(): Record<string, unknown> {
  const out: Record<string, any> = {};
  for (const f of MERGE_FIELDS) {
    const [root, ...rest] = f.token.split(".");
    out[root] ??= {};
    let cur: any = out[root];
    for (let i = 0; i < rest.length - 1; i++) {
      cur[rest[i]] ??= {};
      cur = cur[rest[i]];
    }
    cur[rest[rest.length - 1]] = f.example;
  }
  return out;
}

export async function POST(req: NextRequest) {
  const session = await requireSession();
  const { body } = await req.json().catch(() => ({ body: null }));
  if (!body) return NextResponse.json({ error: "missing body" }, { status: 400 });

  // Fetch tenant for branding context
  const tenant = await withTenant(session.tenantId, async (tx) => {
    const [t] = await tx.select().from(tenants).where(eq(tenants.id, session.tenantId));
    return t;
  });

  const sample = buildPreviewVariables();
  const html = renderEmailHtml(body as EmailDesignerBody, {
    variables: sample,
    tenant: {
      legalName: tenant?.legalName,
      displayName: tenant?.displayName,
      arn: tenant?.arn,
      principalEuin: tenant?.principalEuin,
      address: (tenant as any)?.addressLine1 ?? (tenant as any)?.officeAddress ?? null,
      websiteUrl: (tenant as any)?.websiteUrl ?? null,
      brandColor: ((tenant as any)?.brandingConfig as any)?.brandColor ?? null,
      logoUrl: tenant?.logoUrl ?? ((tenant as any)?.brandingConfig as any)?.logoUrl ?? null,
    },
    unsubscribeUrl: "#preview",
  });
  return NextResponse.json({ html });
}
