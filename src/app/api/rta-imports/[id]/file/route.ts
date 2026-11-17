/**
 * GET /api/rta-imports/:id/file — download the stored registrar file as received.
 *
 * Kept for a refused ZIP above all: the person can open the very same bytes on their
 * own computer (7-Zip / WinZip) with the password they hold. Opens there → the CRM has a
 * fault to find; refuses there → the archive was locked with another password. Nothing
 * else settles that, and it needs no developer. The file is the firm's own (tenant scope
 * through withTenant + the row's tenant), the action is audited, the password never is.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { getObjectBytes } from "@/lib/storage/s3";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  requireCap(session.roles, "transactions.execute", session.permissions);

  const row = await withTenant(session.tenantId, async (tx) => {
    const r = await tx.execute(sql`
      SELECT id, file_name, file_key, status
        FROM rta_file_imports
       WHERE id = ${id}::uuid AND tenant_id = ${session.tenantId}::uuid AND deleted_at IS NULL
       LIMIT 1`);
    return (r.rows[0] as { id: string; file_name: string; file_key: string | null; status: string } | undefined) ?? null;
  });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!row.file_key) {
    return NextResponse.json(
      { error: "The file is no longer stored (a completed import removes its source file). Ask the registrar to send it again." },
      { status: 409 },
    );
  }

  let bytes: Buffer;
  try {
    bytes = await getObjectBytes(row.file_key);
  } catch {
    return NextResponse.json({ error: "The stored file could not be read." }, { status: 404 });
  }

  await withTenant(session.tenantId, async (tx) => {
    await recordAudit(tx, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "rta_import.file_downloaded",
      entityType: "rta_file_import",
      entityId: row.id,
      after: { status: row.status, bytes: bytes.length },
      ...clientMetaFromHeaders(req.headers),
    });
  });

  const name = (row.file_name || "rta-file").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  const isZip = bytes.length > 1 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": isZip ? "application/zip" : "application/octet-stream",
      "content-disposition": `attachment; filename="${isZip && !/\.zip$/i.test(name) ? name + ".zip" : name}"`,
      "content-length": String(bytes.length),
      "cache-control": "no-store",
    },
  });
}
