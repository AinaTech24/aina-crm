/**
 * POST /api/rta-imports/:id/diagnose { password? } — why will this refused ZIP not open?
 *
 * The page-side twin of scripts/diagnose-rta-zip.ts, for people who have no server
 * shell. Reads the stored file and the firm's saved passwords, adds the one typed
 * now (if any), and reports what the archive is and whether any candidate — in the
 * forms a writer may have used — passes its exact password check. Read-only: nothing
 * is imported, saved or changed, and no password is ever returned (a candidate is
 * named "typed now", "typed password #K" or "saved password #N"). Several typed
 * candidates may be given, separated by "|"..
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { getObjectBytes } from "@/lib/storage/s3";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { getMailbackPasswords, passwordCandidates, passwordsToTry } from "@/lib/rta/mailback-config";
import { cleanTypedPassword } from "@/lib/rta/password-variants";
import { diagnoseZip, fingerprint } from "@/lib/rta/zip-diagnose";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  requireCap(session.roles, "transactions.execute", session.permissions);

  const body = (await req.json().catch(() => ({}))) as { password?: unknown };
  // Several candidates may be typed at once, separated by "|" (a registrar's default password is
  // often a guess: ARN, PAN, an old password). Each is kept exactly as typed; at most 20.
  const typedList = (typeof body.password === "string" ? body.password.slice(0, 2000).split("|") : [])
    .map((p) => cleanTypedPassword(p).slice(0, 200))
    .filter((p) => p.trim())
    .filter((p, i, a) => a.indexOf(p) === i)
    .slice(0, 20);

  const loaded = await withTenant(session.tenantId, async (tx) => {
    const r = await tx.execute(sql`
      SELECT id, source, file_name, file_key, status
        FROM rta_file_imports
       WHERE id = ${id}::uuid AND tenant_id = ${session.tenantId}::uuid AND deleted_at IS NULL
       LIMIT 1`);
    const row = r.rows[0] as { id: string; source: string; file_name: string; file_key: string | null; status: string } | undefined;
    if (!row) return null;
    const cfg = await getMailbackPasswords(tx, session.tenantId);
    // The label each saved password carries in Settings, so the answer can say WHICH entry opened a file.
    const other = row.source === "cams" ? "kfintech" : "cams";
    const labels = new Map<string, string>();
    for (const src of [row.source, other]) {
      for (const e of passwordCandidates(cfg, src)) {
        if (!labels.has(e.password)) labels.set(e.password, `saved password "${e.label}" (under ${src === "cams" ? "CAMS" : "KFintech"})`);
      }
    }
    return { row, saved: passwordsToTry(cfg, row.source), labels };
  });
  if (!loaded) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!loaded.row.file_key) {
    return NextResponse.json({ error: "The file is no longer stored, so it cannot be checked." }, { status: 409 });
  }

  let bytes: Buffer;
  try {
    bytes = await getObjectBytes(loaded.row.file_key);
  } catch {
    return NextResponse.json({ error: "The stored file could not be read." }, { status: 404 });
  }

  const candidates = [...typedList, ...loaded.saved];
  const report = await diagnoseZip(new Uint8Array(bytes), candidates);

  // Name each candidate by who supplied it, never by its text.
  const names = new Map<string, string>();
  candidates.forEach((c, i) => {
    const fp = fingerprint(c);
    if (!names.has(fp)) {
      names.set(
        fp,
        i < typedList.length
          ? typedList.length === 1
            ? "the password you typed now"
            : `typed password #${i + 1}`
          : (loaded.labels.get(c) ?? `saved password #${i - typedList.length + 1}`)
      );
    }
  });

  await withTenant(session.tenantId, async (tx) => {
    await recordAudit(tx, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "rta_import.diagnosed",
      entityType: "rta_file_import",
      entityId: loaded.row.id,
      after: { typedPassword: typedList.length > 0, typedCount: typedList.length, savedTried: loaded.saved.length, verdict: report.verdict.slice(0, 120) },
      ...clientMetaFromHeaders(req.headers),
    });
  });

  return NextResponse.json({
    file: loaded.row.file_name,
    sizeBytes: report.bytes,
    startsWithPK: report.startsWithPK,
    savedTried: loaded.saved.length,
    typedTried: typedList.length > 0,
    typedCount: typedList.length,
    entries: report.entries.map((e) => ({
      name: e.name,
      kind: e.kind,
      method: e.method,
      matches: e.matches.map((m) => ({ who: names.get(m.candidate) ?? "a candidate", form: m.form })),
    })),
    verdict: report.verdict,
  });
}
