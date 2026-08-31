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
import {
  appendMailbackPassword,
  ensureForwardAddress,
  getMailbackPasswords,
  getSourceAddresses,
  listPasswordEntries,
  removeMailbackPasswordAt,
  saveMailbackPasswords,
  setSourceAddresses,
} from "@/lib/rta/mailback-config";
import { loadRtaInboxConfig } from "@/lib/rta/inbox-config";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireSession();
  if (!can(session.roles, "transactions.execute", session.permissions)) {
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
    const sourceAddresses = await getSourceAddresses(tx, session.tenantId);

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
      // The shared address every firm may use instead of their own alias — it
      // only routes for mailboxes registered in `sourceAddresses` below.
      sharedAddress: `rta@${inbox.domain}`,
      sourceAddresses,
      inboundDomain: inbox.domain,
      inboxReady: inbox.configured,
      // Labels only — the plaintext password never leaves saveMailbackPasswords.
      // Full list (not password-deduped) so every ARN/mailbox entry is shown.
      camsPasswords: listPasswordEntries(pw, "cams").map((e) => ({ label: e.label })),
      kfintechPasswords: listPasswordEntries(pw, "kfintech").map((e) => ({ label: e.label })),
      // Kept for older clients; equivalent to camsPasswords.length > 0.
      hasCamsPassword: !!pw.camsPassword || !!pw.camsPasswords?.length,
      hasKfintechPassword: !!pw.kfintechPassword || !!pw.kfintechPasswords?.length,
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

const PasswordEntry = z.object({ label: z.string().max(60).optional(), password: z.string().max(200) });

const Body = z.object({
  // Legacy simple form — replaces the source's list with this ONE entry.
  camsPassword: z.string().max(200).optional(),
  kfintechPassword: z.string().max(200).optional(),
  // Explicit list form — replaces the source's WHOLE list. Kept for bulk edits
  // (e.g. a future admin tool); the settings UI itself uses append/remove below
  // so the browser never has to round-trip a previously-saved plaintext.
  camsPasswords: z.array(PasswordEntry).max(8).optional(),
  kfintechPasswords: z.array(PasswordEntry).max(8).optional(),
  // Append ONE labelled password — a firm registering a second ARN's mailback
  // subscription adds its password here without touching what's already saved.
  camsPasswordsAppend: z.array(PasswordEntry).max(1).optional(),
  kfintechPasswordsAppend: z.array(PasswordEntry).max(1).optional(),
  // Remove one saved password by its 0-based position (the order the UI shows).
  camsPasswordsRemoveIndex: z.number().int().min(0).optional(),
  kfintechPasswordsRemoveIndex: z.number().int().min(0).optional(),
  /** Mailboxes this firm forwards FROM — enables the shared rta@ address. */
  sourceAddresses: z.array(z.string().max(200)).max(10).optional(),
});

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!can(session.roles, "transactions.execute", session.permissions)) {
    return NextResponse.json({ error: "You need RTA import access (owner or back-office) to configure this." }, { status: 403 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const d = parsed.data;
  const result = await withTenant(session.tenantId, async (tx) => {
    await saveMailbackPasswords(tx, session.tenantId, d);
    if (d.camsPasswordsAppend?.[0]) await appendMailbackPassword(tx, session.tenantId, "cams", d.camsPasswordsAppend[0]);
    if (d.kfintechPasswordsAppend?.[0]) await appendMailbackPassword(tx, session.tenantId, "kfintech", d.kfintechPasswordsAppend[0]);
    if (d.camsPasswordsRemoveIndex !== undefined) await removeMailbackPasswordAt(tx, session.tenantId, "cams", d.camsPasswordsRemoveIndex);
    if (d.kfintechPasswordsRemoveIndex !== undefined) await removeMailbackPasswordAt(tx, session.tenantId, "kfintech", d.kfintechPasswordsRemoveIndex);
    await ensureForwardAddress(tx, session.tenantId);
    if (d.sourceAddresses) {
      return setSourceAddresses(tx, session.tenantId, d.sourceAddresses);
    }
    return null;
  });

  // Surface collisions so the firm sees WHY an address didn't stick, rather than
  // it silently vanishing from the list on the next load.
  if (result?.rejected.length) {
    return NextResponse.json({
      ok: true,
      sourceAddresses: result.saved,
      rejected: result.rejected,
      warning: `Already registered by another firm: ${result.rejected.join(", ")}. Use your own rta-<token>@ address instead.`,
    });
  }
  return NextResponse.json({ ok: true, sourceAddresses: result?.saved });
}
