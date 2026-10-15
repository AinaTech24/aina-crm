/**
 * POST /api/integrations/nse-mf/test — ask NSE for one PAN's KYC status with
 * the saved credentials. Body { pan? }; without one, a client's PAN is used.
 * Nothing is written to any client; the result is noted on the connection so
 * the Settings card can show it. Owner only.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { requireSession } from "@/lib/auth/session";
import { withTenant } from "@/db/client";
import { getNseCredentials } from "@/lib/kyc/credentials";
import { testNseConnection } from "@/lib/kyc/refresh";
import { PAN_RE } from "@/lib/kyc/nse-status";

export const dynamic = "force-dynamic";

const Body = z.object({ pan: z.string().trim().max(10).optional() });

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session.roles.includes("owner")) {
    return NextResponse.json({ error: "Only the firm owner can test the NSE connection." }, { status: 403 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  const typed = parsed.success ? (parsed.data.pan ?? "").toUpperCase() : "";
  if (typed && !PAN_RE.test(typed)) return NextResponse.json({ error: "That is not a valid PAN." }, { status: 400 });

  const pre = await withTenant(session.tenantId, async (tx) => {
    const creds = await getNseCredentials(tx, session.tenantId);
    let pan = typed;
    if (!pan) {
      const r = await tx.execute(sql`
        SELECT upper(btrim(pan)) AS pan FROM investors
         WHERE tenant_id = ${session.tenantId}::uuid AND deleted_at IS NULL AND merged_into_id IS NULL
           AND upper(btrim(pan)) ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'
         ORDER BY updated_at DESC LIMIT 1`);
      pan = String((r.rows[0] as { pan?: string } | undefined)?.pan ?? "");
    }
    return { creds, pan };
  });
  if (!pre.creds) return NextResponse.json({ error: "Save the NSE credentials first." }, { status: 400 });
  if (!pre.pan) return NextResponse.json({ error: "Enter a PAN to test with." }, { status: 400 });

  const r = await testNseConnection(session.tenantId, pre.creds, pre.pan);
  if (!r.ok) {
    const hint =
      r.kind === "auth"
        ? "NSE refused the login. Check the Login User ID, API Secret, License Key and member code, and that NSE has whitelisted this server's IP for that user."
        : r.kind === "network"
          ? "NSE did not answer. If this keeps happening, the server's IP may not be whitelisted yet."
          : null;
    return NextResponse.json({ ok: false, error: r.message, hint });
  }
  return NextResponse.json({ ok: true, remark: r.remark, kra: r.kra });
}
