/**
 * POST /api/integrations/fp/credentials
 *
 * The MFD owner saves their OWN FintechPrimitives account credentials
 * (FP tenant + client id/secret, optional base URL). Stored encrypted.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { withTenant } from "@/db/client";
import { saveFpCredentials } from "@/lib/fp/credentials";

export const dynamic = "force-dynamic";

const Body = z.object({
  baseUrl: z.string().trim().url().max(200).optional().or(z.literal("")),
  tenant: z.string().trim().min(1).max(100),
  clientId: z.string().trim().min(5).max(200),
  clientSecret: z.string().trim().min(5).max(300),
});

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session.roles.includes("owner")) {
    return NextResponse.json({ error: "Only the firm owner can configure integrations." }, { status: 403 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid Tenant ID, Client ID and Client Secret." }, { status: 400 });
  }
  await withTenant(session.tenantId, async (tx) => {
    await saveFpCredentials(tx, session.tenantId, {
      baseUrl: parsed.data.baseUrl || undefined,
      tenant: parsed.data.tenant,
      clientId: parsed.data.clientId,
      clientSecret: parsed.data.clientSecret,
      grantedBy: session.email ?? session.userId,
    });
  });
  return NextResponse.json({ ok: true });
}
