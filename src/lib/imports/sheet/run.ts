/**
 * The Excel import of a module (Tasks, Meetings, Service requests), end to end:
 * read the uploaded sheet, match its headings to the module's columns, check EVERY
 * row, and — only when asked to import — save the rows that passed. One flow for
 * all three, so each module supplies only what is its own (`ImportModule`).
 *
 *   POST ?mode=check    read and check; nothing is saved (the page's preview)
 *   POST ?mode=import   the same, then save the rows that passed; the rest are listed
 *
 * The page sends the same file for both, so nothing is held on the server between
 * the preview and the import. A row that fails is reported with its sheet row
 * number and the column, and never stops the others.
 */
import type { Tx } from "@/db/client";
import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { matchHeaders, type SheetSpec } from "./spec";
import { readSheetRows, type SheetRow } from "./read";

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export type Problem = { row: number; column: string; message: string };

/** A row as a module sees it: its key → text, and a place to report what is wrong. */
export class RowView {
  constructor(
    public readonly n: number,
    private readonly values: Record<string, string>,
    private readonly headerOf: (key: string) => string,
    private readonly sink: Problem[],
  ) {}
  /** The cell's text, "" when blank. */
  get(key: string): string { return this.values[key] ?? ""; }
  /** Report a problem against a column. */
  fail(key: string, message: string): void { this.sink.push({ row: this.n, column: this.headerOf(key), message }); }
  /** Has this row reported anything yet? */
  get failed(): boolean { return this.sink.some((p) => p.row === this.n); }
}

export type ImportModule<Prep, Item> = {
  spec: SheetSpec;
  /** Throws the module's own permission error. */
  authorize(session: SessionUser): void;
  /** Look up, once, everything the rows refer to. */
  prepare(tx: Tx, session: SessionUser, rows: RowView[]): Promise<Prep>;
  /** Check one row. Report problems on `row.fail`; return the parsed row, or null when it cannot be imported. */
  parse(row: RowView, prep: Prep, session: SessionUser): Item | null;
  /** Save the rows that passed, inside the transaction. Rows that fail here are returned, not thrown. */
  commit(tx: Tx, session: SessionUser, items: Array<{ n: number; item: Item }>, prep: Prep): Promise<{ saved: number; failed: Problem[] }>;
};

export type ImportReport = {
  mode: "check" | "import";
  sheetName: string | null;
  total: number;
  valid: number;
  invalid: number;
  /** Headings the file has that the importer reads. */
  recognised: string[];
  /** Headings it has that match nothing — ignored. */
  ignored: string[];
  /** Required columns the file lacks: nothing can be imported until they are added. */
  missing: string[];
  problems: Problem[];
  /** True when more problems exist than `problems` lists. */
  moreProblems: boolean;
  imported?: number;
};

const MAX_PROBLEMS = 200;

function failure(error: string, status = 400) {
  return Object.assign(new Error(error), { status });
}

export async function runSheetImport<Prep, Item>(
  req: Request,
  session: SessionUser,
  mod: ImportModule<Prep, Item>,
  mode: "check" | "import",
): Promise<ImportReport> {
  mod.authorize(session);
  if (mode === "import") await assertActiveLicense(session.tenantId, session.roles);

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw failure("Choose a file to import.");
  if (file.size > MAX_IMPORT_BYTES) throw failure("The file is too large (5 MB at most).", 413);

  const sheet = readSheetRows(Buffer.from(await file.arrayBuffer()));
  if ("error" in sheet) throw failure(sheet.error);

  const { spec } = mod;
  const match = matchHeaders(sheet.headers, spec);
  const headerByKey = new Map(spec.columns.map((c) => [c.key, c.header]));
  const report: ImportReport = {
    mode,
    sheetName: sheet.sheetName,
    total: sheet.rows.length,
    valid: 0,
    invalid: 0,
    recognised: Object.keys(match.map),
    ignored: match.ignored,
    missing: match.missing.map((c) => c.header),
    problems: [],
    moreProblems: false,
  };
  if (match.missing.length) return report; // nothing to check against
  if (sheet.rows.length === 0) throw failure("The sheet has headings but no rows to import.");
  if (sheet.rows.length > spec.maxRows) {
    throw failure(`This file has ${sheet.rows.length} rows; import up to ${spec.maxRows} at a time.`, 413);
  }

  const problems: Problem[] = [];
  const view = (r: SheetRow) => {
    const values: Record<string, string> = {};
    for (const [heading, key] of Object.entries(match.map)) values[key] = r.cells[heading] ?? "";
    return new RowView(r.n, values, (k) => headerByKey.get(k) ?? k, problems);
  };

  // app.user_id credits what the import writes (a task's history) to the person importing.
  const result = await withTenant(session.tenantId, async (tx) => {
    const views = sheet.rows.map(view);
    const prep = await mod.prepare(tx, session, views);
    const good: Array<{ n: number; item: Item }> = [];
    for (const v of views) {
      const item = mod.parse(v, prep, session);
      if (item !== null && !v.failed) good.push({ n: v.n, item });
    }
    if (mode === "check") return { valid: good.length, saved: 0, failed: [] as Problem[] };
    const out = await mod.commit(tx, session, good, prep);
    await recordAudit(tx, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: `${spec.entity.replace(/-/g, "_")}.bulk_import`,
      entityType: spec.entity.replace(/-/g, "_"),
      entityId: null,
      meta: { totalRows: sheet.rows.length, imported: out.saved, rejected: sheet.rows.length - out.saved, file: file.name.slice(0, 120) },
      ...clientMetaFromHeaders(req.headers),
    });
    return { valid: good.length, saved: out.saved, failed: out.failed };
  }, { userId: session.userId });

  const all = [...problems, ...result.failed].sort((a, b) => a.row - b.row);
  const badRows = new Set(all.map((p) => p.row));
  report.problems = all.slice(0, MAX_PROBLEMS);
  report.moreProblems = all.length > MAX_PROBLEMS;
  report.invalid = badRows.size;
  report.valid = sheet.rows.length - badRows.size;
  if (mode === "import") report.imported = result.saved;
  return report;
}
