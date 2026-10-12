/**
 * Report-type scope at INTAKE — the first of several checks, never the only one.
 *
 * A firm activated for validate-first names the registrars AND the report
 * types it may import (migration 0243; the KFintech pilot is MFSD211 +
 * MFSD201). This module answers, before a file is queued, whether its
 * declared registrar / kind / file name can possibly be one of those reports.
 * It is an early filter: the authoritative decision is made from the file's
 * CONTENT (staging/layouts.ts identifies the report by its header) in the
 * worker and again inside the posting transaction (gate.ts). A file name is
 * never trusted to ADMIT a report — only to refuse one it plainly names.
 *
 * A refused file is not thrown away: the caller records an rta_file_imports
 * row with status `blocked` and the reason, so the audit trail shows what
 * arrived and why nothing was imported.
 */
import { sql } from "drizzle-orm";
import { currentActivation, REPORT_CODES, type Activation } from "./controls";

type Tx = any;

/** The import kind each validate-first report arrives under (upload dialog and mail classifier). */
export const KINDS_BY_REPORT: Record<string, readonly string[]> = {
  MFSD211: ["folio_master_dump"],
  MFSD201: ["daily_transaction_feed"],
  MFSD203: ["cas_holdings", "folio_master_dump"],
  MFSD243: ["monthly_sip_book"],
  MFSD230: ["monthly_sip_book"],
  R9: ["folio_master_dump"],
  WBR4: ["folio_master_dump"],
  R2: ["daily_transaction_feed"],
  WBR10: ["daily_transaction_feed"],
  WBR49: ["monthly_sip_book"],
};

const KNOWN = new Set(Object.values(REPORT_CODES).flat());

/** Registrar report codes a file name states outright (MFSD203, WBR49, R9 …). Only known codes; an unrelated number is ignored. */
export function reportCodesNamedIn(fileName: string): string[] {
  const out = new Set<string>();
  for (const m of fileName.matchAll(/mfsd\s*_?(\d{3})/gi)) out.add(`MFSD${m[1]}`);
  for (const m of fileName.matchAll(/wbr\s*_?(\d{1,3})/gi)) out.add(`WBR${m[1]}`);
  for (const m of fileName.matchAll(/(?:^|[^a-z0-9])r(\d{1,2})(?=[._\-\s]|$)/gi)) out.add(`R${m[1]}`);
  return [...out].filter((c) => KNOWN.has(c));
}

/**
 * Why this file may not be queued for the firm, or null when it may. Only a
 * firm whose current activation names report types is restricted; a firm on
 * the legacy importer (no activation, or a pre-0243 row) is unaffected.
 */
export function intakeRefusalFor(a: Pick<Activation, "registrars" | "reportCodes"> | null, f: { source: string; kind: string; fileName: string }): string | null {
  if (!a || !a.reportCodes) return null;
  const allowed = a.reportCodes;
  const label = allowed.join(" + ");
  if (a.registrars && !(a.registrars as readonly string[]).includes(f.source)) {
    return `blocked: this firm's activation covers ${a.registrars.join(" + ")} report types ${label} only; a ${f.source} file is refused — nothing is staged or posted`;
  }
  const named = reportCodesNamedIn(f.fileName);
  const outside = named.filter((c) => !allowed.includes(c));
  if (outside.length) {
    return `blocked: this firm's activation covers report types ${label} only; a ${outside.join(" / ")} file is refused — nothing is staged or posted`;
  }
  const kinds = new Set(allowed.flatMap((c) => KINDS_BY_REPORT[c] ?? []));
  if (!kinds.has(f.kind)) {
    return `blocked: this firm's activation covers report types ${label} only; a "${f.kind.replace(/_/g, " ")}" file cannot be one of them — nothing is staged or posted`;
  }
  return null;
}

/** intakeRefusalFor against the firm's current activation, read in the caller's transaction. */
export async function intakeRefusal(tx: Tx, tenantId: string, f: { source: string; kind: string; fileName: string }): Promise<string | null> {
  return intakeRefusalFor(await currentActivation(tx, tenantId), f);
}

/** Record a refused file as a `blocked` import (the audit record) — never queued. Returns its id. */
export async function recordBlockedImport(tx: Tx, f: {
  tenantId: string; source: string; kind: string; fileName: string; fileKey: string; reason: string;
  uploadedBy?: string | null; sizeBytes?: number | null; checksum?: string | null; origin: string;
}): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const r = await tx.execute(sql`
    INSERT INTO rta_file_imports (
      tenant_id, source, kind, period_start, period_end, file_name, file_key,
      file_size_bytes, file_checksum, status, remarks, uploaded_by
    ) VALUES (
      ${f.tenantId}::uuid, ${f.source}, ${f.kind}, ${today}::date, ${today}::date, ${f.fileName}, ${f.fileKey},
      ${f.sizeBytes ?? null}, ${f.checksum ?? null}, 'blocked',
      ${`Blocked at ${f.origin} — ${f.reason.replace(/^blocked:\s*/, "")}`}, ${f.uploadedBy ?? null}
    )
    RETURNING id::text
  `);
  return (r.rows[0] as { id: string }).id;
}
