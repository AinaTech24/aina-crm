/**
 * POST /api/integrations/rta-mailback/regenerate
 *
 * Rotate the firm's forwarding address (e.g. the old one leaked). Deactivates
 * the old row and mints a fresh unguessable address. The MFD must repoint their
 * auto-forward rule afterwards. Gated on `transactions.execute` (owner + back-office/ops + RM).
 */
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { withTenant } from "@/db/client";
import { regenerateForwardAddress } from "@/lib/rta/mailback-config";
import { handleApiError } from "@/lib/api/error-handler";
import { assertRtaImportAccess } from "@/lib/rta/import-access";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const session = await requireSession();
    if (!can(session.roles, "transactions.execute", session.permissions)) {
      return NextResponse.json({ error: "You need RTA import access (owner or back-office) to configure this." }, { status: 403 });
    }
    // The alias is now the ONLY routing credential for inbound mailbacks
    // (lib/rta/mail-trust), so rotating it is an import-admin action.
    const minted = await withTenant(session.tenantId, async (tx) => {
      await assertRtaImportAccess(tx, session);
      return regenerateForwardAddress(tx, session.tenantId);
    });
    return NextResponse.json({ ok: true, address: minted.address });
  } catch (err) {
    return handleApiError(err);
  }
}
