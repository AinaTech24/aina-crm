/**
 * GET /api/compliance/documents/folder?folder=<clientId|firm>&q=&category=&page=
 *
 * One page of the documents in one Documents-vault folder, read when the folder is opened.
 * Same gate and same scope as the vault itself: a folder outside the caller's reach is empty.
 *
 *   200 { docs: VaultDoc[], total, page }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { canOpenVault } from "@/lib/compliance/document-access";
import { loadFolderDocs } from "@/lib/compliance/vault-folders";
import { FIRM_FOLDER, parsePage, parseVaultFilter } from "@/lib/compliance/vault-view";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!canOpenVault(session)) throw Object.assign(new Error("forbidden: missing document.view"), { status: 403 });
    const sp = req.nextUrl.searchParams;
    const folder = sp.get("folder") ?? "";
    if (folder !== FIRM_FOLDER && !z.string().uuid().safeParse(folder).success) {
      return NextResponse.json({ error: "folder required" }, { status: 400 });
    }
    const filter = parseVaultFilter(sp.get("q"), sp.get("category"));
    const result = await withTenant(
      session.tenantId,
      (tx) => loadFolderDocs(tx, session, folder, filter, parsePage(sp.get("page"))),
      { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles },
    );
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
