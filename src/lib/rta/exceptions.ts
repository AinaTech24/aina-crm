/**
 * RTA row exceptions, grouped by reason — what the "Row exceptions" tile on
 * /dashboard/rta-imports counts, broken down so someone can act on it.
 *
 * Scope is the tile's, exactly: the last 30 uploads (not in Trash), leaving
 * out "not ours" (rejected) files. Exceptions = rows_failed + rows_skipped.
 *
 * Each import stores its row-level reasons in rta_file_imports.errors. Those
 * are free text written by lib/rta/process.ts, so they are grouped here by
 * pattern. Two things keep the groups honest:
 *   - Some skips record no reason (a rejection already imported, a master-file
 *     row with no PAN / folio / AMC), and one folio-master reason stands for
 *     every row of that folio. The difference between the tile's total and the
 *     reasons counted is its own group, "No reason recorded", never spread
 *     across the others.
 *   - "N folios were first seen in this report and created from it" is written
 *     to the same list but is information, not an exception; it is left out.
 *
 * Reasons can carry a PAN ("PAN ABCDE1234F not in client master"); every text
 * that leaves here has it masked.
 */
import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { maskPan } from "@/lib/investors/pan-display";

export type ExceptionReasonKey =
  | "unknown_client"
  | "identity_review"
  | "txn_conflict"
  | "unsupported_txn"
  | "invalid_value"
  | "folio_missing"
  | "missing_field"
  | "amount_unread"
  | "revaluation"
  | "technical"
  | "unrecorded";

type Category = { key: ExceptionReasonKey; label: string; action: string; pattern?: string };

/** First match wins. Patterns are Postgres case-insensitive regexes. */
const CATEGORIES: Category[] = [
  {
    key: "unknown_client",
    label: "Unknown PAN / client not in the CRM",
    action: "The row's PAN or folio matches no client. Import the client master (or add the client), then re-upload the file.",
    pattern: "not in client master|could not be attached to a client|not linked to a client",
  },
  {
    key: "identity_review",
    label: "Held back: client or folio needs review",
    action:
      "The row points at a client in Trash, a merged client whose survivor is gone, more than one possible client, or a folio the CRM files under someone else. Nothing was reassigned. Restore or fix the client (or the folio's client), then re-upload the file.",
    pattern:
      "held back for review|in Trash|matches [0-9]+ different clients|different client in the CRM|filed under a different client|merge history|merged into a record|under [0-9]+ different clients",
  },
  {
    key: "txn_conflict",
    label: "Transaction number already used by a different transaction",
    action:
      "The registrar's transaction number on these rows already belongs to a different transaction in the CRM (folio, scheme, date, type or amount differ). The existing record was left unchanged. Check both against the registrar statement.",
    pattern: "already in the CRM for a different transaction",
  },
  {
    key: "unsupported_txn",
    label: "Transaction not applied: type, status or direction not verified",
    action:
      "Reversals, cancellations, unrecognised transaction codes or statuses, switch/STP rows without an IN/OUT leg, and negative money-in rows are held back rather than guessed. Send an example to support so the code can be mapped from the registrar's documentation.",
    pattern:
      "reversal|not one this importer recognises|not guessed|not assumed|IN or the OUT leg|not one this importer reads",
  },
  {
    key: "missing_field",
    label: "Row is missing a folio, scheme, PAN or reference",
    action: "The registrar left a key field blank on these rows. Nothing to fix in the CRM; ask the registrar if they matter.",
    pattern: "row carries no",
  },
  {
    key: "invalid_value",
    label: "Unreadable or missing value (date, amount, units)",
    action:
      "A date or number on these rows could not be read with certainty (blank, impossible date, two-digit year, unknown number format) and was not guessed. Check the file is the report it was uploaded as; if it is, send it to support.",
    pattern:
      "is blank|calendar date|not a number|thousands separator|two signs|two-digit year|bare number|not a date|date order|is ambiguous|truncated or mis-delimited|neither a value nor a NAV|negative units|month name",
  },
  {
    key: "folio_missing",
    label: "Folio not in the CRM yet",
    action: "Import the folio master / holdings file first, then re-upload this file.",
    pattern: "import the folio master first|could not be created",
  },
  {
    key: "amount_unread",
    label: "Amount column not recognised",
    action: "Check the file is the report it was uploaded as. If it is, send it to support.",
    pattern: "parsed to amount 0|column in this file was not recognised",
  },
  {
    key: "revaluation",
    label: "Imported, but AUM totals not refreshed",
    action: "The values were saved; client AUM totals refresh on the next import or nightly run.",
    pattern: "revaluation failed",
  },
  {
    key: "technical",
    label: "Could not be saved",
    action: "Upload the file again. If the same rows fail, send the file to support.",
  },
];

const UNRECORDED: Category = {
  key: "unrecorded",
  label: "No reason recorded",
  action:
    "Usually rows already imported from an earlier file, master-file rows without a PAN, folio or AMC, and the further rows of a folio already counted above. Usually no action.",
};

/** Written to the errors list, but not an exception. */
const INFO_PATTERN = "were first seen in this report and created|has no frequency column|moved from an import placeholder";

export const EXCEPTION_REASONS: Category[] = [...CATEGORIES, UNRECORDED];

export function isExceptionReason(v: string | undefined): v is ExceptionReasonKey {
  return EXCEPTION_REASONS.some((c) => c.key === v);
}

const PAN_IN_TEXT = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g;
export const maskPansIn = (text: string) => text.replace(PAN_IN_TEXT, (p) => maskPan(p));

function categorySql(reason: SQL): SQL {
  const whens = CATEGORIES.filter((c) => c.pattern).map((c) => sql`WHEN ${reason} ~* ${c.pattern}::text THEN ${c.key}::text`);
  return sql`CASE ${sql.join(whens, sql` `)} ELSE 'technical' END`;
}

/** The tile's window: last 30 uploads not in Trash, minus "not ours" files. */
const SCOPED = sql`
  scoped AS (
    SELECT * FROM (
      SELECT id, file_name, kind, source, created_at, status, rows_total, rows_failed, rows_skipped, errors
        FROM rta_file_imports
       WHERE deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT 30
    ) recent
    WHERE status <> 'rejected'
  ),
  e AS (
    SELECT s.id AS import_id, s.file_name, s.kind, s.source, s.created_at,
           x->>'row' AS row_no, x->>'reason' AS reason
      FROM scoped s,
           jsonb_array_elements(CASE WHEN jsonb_typeof(s.errors) = 'array' THEN s.errors ELSE '[]'::jsonb END) x
     WHERE COALESCE(x->>'reason', '') !~* ${INFO_PATTERN}::text
  ),
  c AS (SELECT e.*, ${categorySql(sql`e.reason`)} AS cat FROM e)
`;

export type ExceptionGroup = Category & { rows: number; files: number; example: string | null };
export type ExceptionDetail = {
  importId: string;
  fileName: string;
  kind: string;
  source: string;
  createdAt: string;
  row: string | null;
  reason: string;
};

export async function loadRowExceptions(
  tx: Tx,
  opts: { reason?: ExceptionReasonKey; detailLimit?: number } = {}
): Promise<{
  processedRows: number;
  exceptionRows: number;
  groups: ExceptionGroup[];
  detail: { rows: ExceptionDetail[]; total: number } | null;
}> {
  const totals = (await tx.execute(sql`
    WITH ${SCOPED}
    SELECT COALESCE(SUM(rows_total), 0)::bigint AS processed,
           COALESCE(SUM(COALESCE(rows_failed, 0) + COALESCE(rows_skipped, 0)), 0)::bigint AS exceptions
      FROM scoped
  `)).rows[0] as { processed?: string | number; exceptions?: string | number } | undefined;
  const processedRows = Number(totals?.processed ?? 0);
  const exceptionRows = Number(totals?.exceptions ?? 0);

  const byCat = (await tx.execute(sql`
    WITH ${SCOPED}
    SELECT cat, COUNT(*)::int AS rows, COUNT(DISTINCT import_id)::int AS files, MIN(reason) AS example
      FROM c GROUP BY cat
  `)).rows as Array<{ cat: string; rows: number; files: number; example: string | null }>;

  const counted = byCat.reduce((n, r) => n + Number(r.rows), 0);
  const groups: ExceptionGroup[] = CATEGORIES.map((cat) => {
    const r = byCat.find((x) => x.cat === cat.key);
    return { ...cat, rows: Number(r?.rows ?? 0), files: Number(r?.files ?? 0), example: r?.example ? maskPansIn(r.example) : null };
  });
  groups.push({ ...UNRECORDED, rows: Math.max(0, exceptionRows - counted), files: 0, example: null });

  let detail: { rows: ExceptionDetail[]; total: number } | null = null;
  if (opts.reason && opts.reason !== "unrecorded") {
    const limit = opts.detailLimit ?? 200;
    const rows = (await tx.execute(sql`
      WITH ${SCOPED}
      SELECT import_id, file_name, kind, source, created_at, row_no, reason
        FROM c WHERE cat = ${opts.reason}::text
       ORDER BY created_at DESC, CASE WHEN row_no ~ '^[0-9]+$' THEN row_no::bigint END NULLS LAST
       LIMIT ${limit}
    `)).rows as Array<{ import_id: string; file_name: string; kind: string; source: string; created_at: string; row_no: string | null; reason: string | null }>;
    detail = {
      total: groups.find((g) => g.key === opts.reason)?.rows ?? 0,
      rows: rows.map((r) => ({
        importId: String(r.import_id),
        fileName: r.file_name,
        kind: r.kind,
        source: r.source,
        createdAt: String(r.created_at),
        row: r.row_no,
        reason: maskPansIn(r.reason ?? ""),
      })),
    };
  }

  return { processedRows, exceptionRows, groups: groups.filter((g) => g.rows > 0), detail };
}
