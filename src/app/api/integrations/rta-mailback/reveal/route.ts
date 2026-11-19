/**
 * POST /api/integrations/rta-mailback/reveal { source: "cams" | "kfintech", index }
 *
 * Returns ONE saved ZIP password in plain text so the person who saved it can see exactly what the
 * importer will try on an archive (the "eye" on Settings → Integrations → RTA Mailback). The list
 * endpoint still never carries a password.
 *
 *   - Owner / `settings.users` only: stricter than saving one (`transactions.execute`), because this
 *     hands a secret back.
 *   - Each reveal is audited (who, which registrar, which entry — never the text).
 *   - `Cache-Control: no-store`; the page hides the value again after 30 seconds.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { getMailbackPasswords, listPasswordEntries } from "@/lib/rta/mailback-config";

export const dynamic = "force-dynamic";

const Body = z.object({ source: z.enum(["cams", "kfintech"]), index: z.number().int().min(0).max(20) });

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!can(session.roles, "settings.users", session.permissions)) {
    return NextResponse.json({ error: "Only the owner can view a saved password." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const { source, index } = parsed.data;

  const found = await withTenant(session.tenantId, async (tx) => {
    const pw = await getMailbackPasswords(tx, session.tenantId);
    const entry = listPasswordEntries(pw, source)[index];
    if (!entry) return null;
    await recordAudit(tx, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "rta_mailback.password_viewed",
      entityType: "tenant_integration",
      entityId: session.tenantId,
      after: { source, index, label: entry.label },
      ...clientMetaFromHeaders(req.headers),
    });
    return entry;
  });
  if (!found) {
    return NextResponse.json({ error: "No such saved password." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ password: found.password, label: found.label }, { headers: { "Cache-Control": "no-store" } });
}
