/**
 * Module export — the shape every module's export definition takes.
 *
 * One engine (run.ts) serves the Export button on every list. A module
 * declares WHAT may be exported (a fixed column list — the user can only pick
 * from it, never name a column), FROM where, and WHO may see which rows (its
 * `where`, which must apply the same access scope as the module's own list).
 */

import type { SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";

/** How a value is written to the sheet. */
export type ExportKind = "text" | "number" | "money" | "date" | "datetime" | "bool";

/**
 * A personal-data class. A column carrying one is left out when the firm's
 * licence hides that field (lib/auth/field-gate.ts), and its export is
 * recorded in the audit trail as personal data read.
 */
export type PiiClass = "pan" | "phone" | "email" | "dob" | "address" | "bank";

export type ExportColumn = {
  /** Stable id the dialog sends back. */
  key: string;
  /** Column heading in the file and label in the dialog. */
  label: string;
  /** Dialog grouping ("Contact", "Investment", …). */
  group?: string;
  /** The value — a developer-written SQL expression over the module's FROM. */
  sql: SQL;
  kind?: ExportKind;
  /** Ticked when the user has no saved choice for this module. */
  default?: boolean;
  pii?: PiiClass;
};

export type ExportModule = {
  key: string;
  /** "Leads" — dialog title and audit wording. */
  label: string;
  /** File name stem: leads → leads-2026-10-02.xlsx */
  fileName: string;
  /** Licence subject for PII field gating ("investor", "lead", …). */
  piiSubject?: string;
  /**
   * May this person export this module at all? Checked in addition to the
   * export permission — normally the module's own view permission.
   */
  canView: (session: SessionUser) => boolean;
  /** Clients use `investor.bulk_export` instead of `data.export`. */
  exportCapability?: "data.export" | "investor.bulk_export";
  /** FROM (and JOINs) — aliases the columns and `where` refer to. A function
   *  when a JOIN itself depends on the viewer (the risk export's guardian, G-1). */
  from: SQL | ((tx: Tx, session: SessionUser) => Promise<SQL>);
  /**
   * Every condition: the tenant, the viewer's access scope, and the list
   * page's own filters read from its URL (`params`). Return the list; the
   * engine ANDs them.
   */
  where: (tx: Tx, session: SessionUser, params: URLSearchParams) => Promise<SQL[]>;
  orderBy?: SQL;
  columns: ExportColumn[];
};
