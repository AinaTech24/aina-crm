/**
 * What an Excel import accepts, as DATA: the columns of a module's sample sheet,
 * how each one is read, and an example row. Pure — the sample workbook, the
 * instructions in it, the page that lists the columns and the importer's header
 * matching all come from this one description, so they cannot drift apart.
 */

import { type Option } from "./values";

export type ColumnKind =
  | "text"
  | "longtext"
  | "date"          // a day
  | "datetime"      // a day and an optional time
  | "time"
  | "integer"
  | "bool"
  | "enum"          // one of `options`
  | "list"          // several, separated by ; or a new line
  | "user"          // a team member: email or name
  | "client"        // a client: PAN or name
  | "lead";         // a lead: mobile or name

export type ColumnDef = {
  key: string;
  /** The heading in the sheet. Required ones show "Title *". */
  header: string;
  required?: boolean;
  kind: ColumnKind;
  /** What to enter, one sentence, for the Instructions sheet and the page. */
  help: string;
  /** Allowed values for an enum column. */
  options?: Option[];
  /** Other headings the importer also recognises (a Zoho export, a shorter name). */
  aliases?: string[];
};

export type SheetSpec = {
  entity: "tasks" | "meetings" | "service-requests";
  /** "Tasks", "Meetings", "Service requests" — page titles and file names. */
  label: string;
  /** "task", "meeting", "service request" — "Imported 12 tasks". */
  singular: string;
  /** Most rows one import takes. */
  maxRows: number;
  columns: ColumnDef[];
  /** Example rows for the "Example" sheet — keyed by column key, as the person would type them. */
  examples: Array<Record<string, string>>;
  /** Rules that are not about one column. */
  notes: string[];
};

export const MAX_IMPORT_ROWS = 2000;

/** "Duration (minutes)" and "duration" read the same; so do "Due date" and "due_date". */
export const headerKey = (s: string) =>
  s.toLowerCase().replace(/\*/g, "").replace(/\(.*?\)/g, "").replace(/[^a-z0-9]+/g, "");
const fullKey = (s: string) => s.toLowerCase().replace(/\*/g, "").replace(/[^a-z0-9]+/g, "");

/** The heading as written in the sample sheet. */
export const sheetHeader = (c: ColumnDef) => (c.required ? `${c.header} *` : c.header);

export type HeaderMatch = {
  /** sheet heading → column key */
  map: Record<string, string>;
  /** Required columns the sheet has no heading for. */
  missing: ColumnDef[];
  /** Headings that match no column — ignored, and said so. */
  ignored: string[];
};

export function matchHeaders(headers: string[], spec: Pick<SheetSpec, "columns">): HeaderMatch {
  const byName = new Map<string, ColumnDef>();
  for (const c of spec.columns) {
    for (const name of [c.header, ...(c.aliases ?? [])]) {
      byName.set(headerKey(name), c);
      byName.set(fullKey(name), c);
    }
  }
  const map: Record<string, string> = {};
  const taken = new Set<string>();
  const ignored: string[] = [];
  for (const h of headers) {
    if (!h.trim()) continue;
    const col = byName.get(fullKey(h)) ?? byName.get(headerKey(h));
    if (col && !taken.has(col.key)) { map[h] = col.key; taken.add(col.key); } else ignored.push(h);
  }
  return { map, missing: spec.columns.filter((c) => c.required && !taken.has(c.key)), ignored };
}

/** What a column accepts, in words — the allowed values of a choice column, else the format. Shown on the import page. */
export function allowedText(c: ColumnDef): string {
  if (c.options?.length) return c.options.map((o) => o.label).join(" / ");
  switch (c.kind) {
    case "date": return "A date, e.g. 24-11-2026 or 24 Nov 2026";
    case "datetime": return "A date, optionally with a time, e.g. 24-11-2026 14:30";
    case "time": return "A time, e.g. 14:30 or 2:30 pm";
    case "integer": return "A whole number";
    case "bool": return "Yes / No";
    case "list": return "Several, separated by ; or one per line";
    case "user": return "A team member's email (best) or full name";
    case "client": return "The client's PAN (best) or full name";
    case "lead": return "The lead's mobile number (best) or full name";
    default: return "Free text";
  }
}

/** The values of each choice column, for the dropdowns' source (a hidden Lists sheet in the sample workbook). */
export function listColumns(spec: SheetSpec): Array<{ title: string; values: string[] }> {
  return spec.columns.filter((c) => c.options?.length).map((c) => ({ title: c.header, values: c.options!.map((o) => o.label) }));
}
