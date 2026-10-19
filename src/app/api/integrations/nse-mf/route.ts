/**
 * The firm's NSE MF Invest connection — used to fetch each client's KYC status
 * from the KRA by PAN (lib/kyc/).
 *
 *   GET    → status (never a secret)
 *   POST   → save the credentials NSE issued to the firm (encrypted)
 *   DELETE → disconnect (secrets wiped, the row kept switched off)
 *
 * Owner only, like every other firm-wide integration.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { withTenant } from "@/db/client";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { disconnectNse, getNseState, saveNseCredentials } from "@/lib/kyc/credentials";
import { nseEgressIp } from "@/lib/kyc/egress";

export const dynamic = "force-dynamic";

function ownerOnly(roles: string[]) {
  return roles.includes("owner")
    ? null
    : NextResponse.json({ error: "Only the firm owner can configure the NSE connection." }, { status: 403 });
}

export async function GET() {
  const session = await requireSession();
  const denied = ownerOnly(session.roles);
  if (denied) return denied;
  const state = await withTenant(session.tenantId, (tx) => getNseState(tx, session.tenantId));
  return NextResponse.json({ ...state, egressIp: nseEgressIp() });
}

const Body = z.object({
  loginUserId: z.string().trim().min(2).max(100),
  memberCode: z.string().trim().min(1).max(30),
  env: z.enum(["live", "uat"]).default("live"),
  autoRefresh: z.boolean().default(true),
  apiSecret: z.string().max(500).optional(),
  licenseKey: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  const session = await requireSession();
  const denied = ownerOnly(session.roles);
  if (denied) return denied;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter the Login User ID and member code NSE gave you." }, { status: 400 });
  }
  const meta = clientMetaFromHeaders(req.headers);
  const err = await withTenant(session.tenantId, async (tx) => {
    const e = await saveNseCredentials(tx, session.tenantId, parsed.data);
    if (!e) {
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "integration.nse_mf.save",
        entityType: "tenant_integration",
        after: {
          memberCode: parsed.data.memberCode,
          env: parsed.data.env,
          autoRefresh: parsed.data.autoRefresh,
          secretsChanged: !!(parsed.data.apiSecret || parsed.data.licenseKey),
        },
        ...meta,
      });
    }
    return e;
  });
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await requireSession();
  const denied = ownerOnly(session.roles);
  if (denied) return denied;
  const meta = clientMetaFromHeaders(req.headers);
  await withTenant(session.tenantId, async (tx) => {
    await disconnectNse(tx, session.tenantId);
    await recordAudit(tx, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "integration.nse_mf.disconnect",
      entityType: "tenant_integration",
      ...meta,
    });
  });
  return NextResponse.json({ ok: true });
}
