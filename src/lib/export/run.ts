/**
 * The export engine behind every module's Export button.
 *
 *   1. Permission — `data.export` (clients: `investor.bulk_export`) AND the
 *      module's own view permission. Owner always.
 *   2. Columns — only the module's declared list; a personal-data column the
 *      firm's licence hides is never offered and never exported.
 *   3. Rows — the module's `where`: tenant, the viewer's access scope, and the
 *      list page's current filters, so the file matches the screen.
 *   4. A file too big to be complete is refused, never cut short.
 *   5. Every export is written to the audit trail (DPDP: who took which
 *      fields of how many records, under what filter).
 */

import * as XLSX from "xlsx";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { loadTenantLicense } from "@/lib/auth/license";
import { isFieldAllowed } from "@/lib/auth/field-gate";
import { recordAudit } from "@/lib/audit";
import type { ExportColumn, ExportModule, PiiClass } from "./types";

export const MAX_EXPORT_ROWS = 50_000;

export class ExportError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function canExportModule(session: SessionUser, mod: ExportModule): boolean {
  return can(session.roles, mod.exportCapability ?? "data.export", session.permissions) && mod.canView(session);
}

/** Licence keys checked for each personal-data class. */
const PII_FIELDS: Record<PiiClass, string[]> = {
  pan: ["pan"],
  phone: ["phone"],
  email: ["email"],
  dob: ["pan", "dob"],
  address: ["address"],
  bank: ["bank", "bank_details"],
};

/** The columns this person may export from this module. */
export async function exportableColumns(session: SessionUser, mod: ExportModule): Promise<ExportColumn[]> {
  if (!mod.columns.some((c) => c.pii)) return mod.columns;
  const license = await loadTenantLicense(session.tenantId, session.roles);
  const subject = mod.piiSubject ?? "investor";
  return mod.columns.filter((c) => !c.pii || PII_FIELDS[c.pii].every((f) => isFieldAllowed(license, subject, f)));
}

function cell(v: unknown, kind: ExportColumn["kind"]): unknown {
  if (v == null) return "";
  if (kind === "money" || kind === "number") {
    const n = Number(v);
    return Number.isFinite(n) ? n : "";
  }
  if (kind === "bool") return v === true || v === "t" || v === "true" ? "Yes" : "No";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}

export type ExportFile = { body: Buffer; fileName: string; contentType: string; rows: number };

export async function runExport(
  session: SessionUser,
  mod: ExportModule,
  fields: string[],
  format: "xlsx" | "csv",
  params: URLSearchParams,
  clientMeta: Record<string, unknown> = {},
): Promise<ExportFile> {
  if (!canExportModule(session, mod)) throw new ExportError("You don't have permission to export this.", 403);
  const allowed = await exportableColumns(session, mod);
  const byKey = new Map(allowed.map((c) => [c.key, c]));
  // Keep the module's column order, whatever order the keys arrived in.
  const picked = allowed.filter((c) => fields.includes(c.key));
  if (!picked.length) throw new ExportError("Choose at least one field to export.");
  if (fields.some((f) => !byKey.has(f))) throw new ExportError("One of the chosen fields can't be exported.", 403);

  const rows = await withTenant(session.tenantId, async (tx) => {
    const conds = await mod.where(tx, session, params);
    const from = typeof mod.from === "function" ? await mod.from(tx, session) : mod.from;
    const select = sql.join(picked.map((c, i) => sql`${c.sql} AS ${sql.raw(`"c${i}"`)}`), sql`, `);
    const r = await tx.execute(sql`
      SELECT ${select}
        FROM ${from}
       WHERE ${conds.length ? sql.join(conds, sql` AND `) : sql`TRUE`}
       ${mod.orderBy ? sql`ORDER BY ${mod.orderBy}` : sql``}
       LIMIT ${MAX_EXPORT_ROWS + 1}
    `);
    if (r.rows.length > MAX_EXPORT_ROWS) {
      throw new ExportError(
        `This list has more than ${MAX_EXPORT_ROWS.toLocaleString("en-IN")} rows — too many for one file. Narrow it with the filters and export in parts.`,
      );
    }
    const pii = [...new Set(picked.map((c) => c.pii).filter(Boolean))];
    await recordAudit(tx, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: `${mod.key}.export`,
      entityType: "export",
      entityId: session.tenantId,
      ...(pii.length ? { piiAccessed: Object.fromEntries(pii.map((p) => [p as string, true])) } : {}),
      after: { module: mod.key, count: r.rows.length, fields: picked.map((c) => c.key), filters: Object.fromEntries(params), format },
      ...clientMeta,
    } as any);
    return r.rows as Array<Record<string, unknown>>;
  }, { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles });

  const data = rows.map((row) => Object.fromEntries(picked.map((c, i) => [c.label, cell(row[`c${i}`], c.kind)])));
  const sheet = XLSX.utils.json_to_sheet(data, { header: picked.map((c) => c.label) });
  // Sensible column widths: the heading or the longest of the first 200 values.
  sheet["!cols"] = picked.map((c) => ({
    wch: Math.min(48, Math.max(c.label.length, ...data.slice(0, 200).map((r) => String(r[c.label] ?? "").length)) + 2),
  }));
  const stamp = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

  if (format === "csv") {
    // BOM so Excel opens ₹ and names in UTF-8.
    const csv = "﻿" + XLSX.utils.sheet_to_csv(sheet);
    return { body: Buffer.from(csv, "utf8"), fileName: `${mod.fileName}-${stamp}.csv`, contentType: "text/csv; charset=utf-8", rows: rows.length };
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, mod.label.slice(0, 31));
  const body = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return {
    body,
    fileName: `${mod.fileName}-${stamp}.xlsx`,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    rows: rows.length,
  };
}
