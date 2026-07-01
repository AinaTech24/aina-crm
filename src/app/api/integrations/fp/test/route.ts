/**
 * POST /api/integrations/fp/test — verify FP credentials by minting a live
 * Bearer token. Tests the creds in the request body if provided (so the owner
 * can validate BEFORE saving), otherwise the stored per-tenant config.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { withTenant, type Tx } from "@/db/client";
import { getFpToken, type FpConfig } from "@/lib/fp/client";
import { getFpConfigForTenant } from "@/lib/fp/credentials";

export const dynamic = "force-dynamic";

const Body = z.object({
  baseUrl: z.string().trim().max(200).optional(),
  tenant: z.string().trim().max(100).optional(),
  clientId: z.string().trim().max(200).optional(),
  clientSecret: z.string().trim().max(300).optional(),
});

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session.roles.includes("owner")) {
    return NextResponse.json({ error: "Only the firm owner can test integrations." }, { status: 403 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  const b = parsed.success ? parsed.data : {};

  let cfg: FpConfig | null = null;
  if (b.tenant && b.clientId && b.clientSecret) {
    cfg = {
      baseUrl: (b.baseUrl || "https://s.finprim.com").replace(/\/+$/, ""),
      tenant: b.tenant,
      clientId: b.clientId,
      clientSecret: b.clientSecret,
    };
  } else {
    cfg = await withTenant(session.tenantId, (tx) => getFpConfigForTenant(tx as Tx, session.tenantId), {
      roles: ["system"],
    });
  }
  if (!cfg) {
    return NextResponse.json({ ok: false, error: "No credentials to test — enter your Tenant ID and client id/secret." }, { status: 400 });
  }

  try {
    const token = await getFpToken(cfg);
    return NextResponse.json({ ok: true, fpTenant: cfg.tenant, tokenLength: token.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Those credentials were rejected." }, { status: 200 });
  }
}
