/**
 * RTA mailback (email-forward import) settings API.
 *
 *   GET  → status: the firm's unique forward address + which RTA passwords are
 *          set + verification/last-received state + recent auto-imports.
 *          (Provisions the address on first call.)
 *   POST → save/merge the CAMS + KFintech ZIP passwords (encrypted).
 *
 * Gated on `transactions.execute` — the same capability as the manual RTA upload
 * (owner + back-office/ops + RM). Configuring the RTA mailback import is an
 * RTA-operations task, not an owner-only account setting.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { withTenant } from "@/db/client";
import { rtaForwardAddresses } from "@/db/schema/rta_forward_addresses";
import { rtaFileImports } from "@/db/schema/rta_imports";
import { ensureForwardAddress, getMailbackPasswords, saveMailbackPasswords } from "@/lib/rta/mailback-config";
import { loadRtaInboxConfig } from "@/lib/rta/inbox-config";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireSession();
  if (!can(session.roles, "transactions.execute")) {
    return NextResponse.json({ error: "You need RTA import access (owner or back-office) to configure this." }, { status: 403 });
  }

  const inbox = await loadRtaInboxConfig();
  const data = await withTenant(session.tenantId, async (tx) => {
    const { address } = await ensureForwardAddress(tx, session.tenantId);
    const [row] = await tx
      .select({
        verifiedAt: rtaForwardAddresses.verifiedAt,
        lastReceivedAt: rtaForwardAddresses.lastReceivedAt,
        forwardingConfirmCode: rtaForwardAddresses.forwardingConfirmCode,
        forwardingConfirmUrl: rtaForwardAddresses.forwardingConfirmUrl,
        forwardingConfirmAt: rtaForwardAddresses.forwardingConfirmAt,
      })
      .from(rtaForwardAddresses)
      .where(and(eq(rtaForwardAddresses.tenantId, session.tenantId), eq(rtaForwardAddresses.isActive, true)))
      .limit(1);

    const pw = await getMailbackPasswords(tx, session.tenantId);

    const recent = await tx
      .select({
        id: rtaFileImports.id,
        source: rtaFileImports.source,
        kind: rtaFileImports.kind,
        fileName: rtaFileImports.fileName,
        status: rtaFileImports.status,
        rowsImported: rtaFileImports.rowsImported,
        parsedAt: rtaFileImports.parsedAt,
        remarks: rtaFileImports.remarks,
        createdAt: rtaFileImports.createdAt,
      })
      .from(rtaFileImports)
      .where(
        and(
          eq(rtaFileImports.tenantId, session.tenantId),
          isNull(rtaFileImports.deletedAt),
          sql`${rtaFileImports.remarks} ILIKE 'Auto-imported%'`
        )
      )
      .orderBy(desc(rtaFileImports.createdAt))
      .limit(8);

    return {
      address,
      inboundDomain: inbox.domain,
      inboxReady: inbox.configured,
      hasCamsPassword: !!pw.camsPassword,
      hasKfintechPassword: !!pw.kfintechPassword,
      verifiedAt: row?.verifiedAt ?? null,
      lastReceivedAt: row?.lastReceivedAt ?? null,
      forwardingConfirmCode: row?.forwardingConfirmCode ?? null,
      forwardingConfirmUrl: row?.forwardingConfirmUrl ?? null,
      forwardingConfirmAt: row?.forwardingConfirmAt ?? null,
      recent,
    };
  });

  return NextResponse.json(data);
}

const Body = z.object({
  camsPassword: z.string().max(200).optional(),
  kfintechPassword: z.string().max(200).optional(),
});

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!can(session.roles, "transactions.execute")) {
    return NextResponse.json({ error: "You need RTA import access (owner or back-office) to configure this." }, { status: 403 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  await withTenant(session.tenantId, async (tx) => {
    await saveMailbackPasswords(tx, session.tenantId, parsed.data);
    await ensureForwardAddress(tx, session.tenantId);
  });
  return NextResponse.json({ ok: true });
}
