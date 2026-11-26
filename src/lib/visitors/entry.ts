/**
 * The Visitor Register's fields and rules — pure, shared by the form, the API
 * and the pages. Nothing here reads the database.
 */

import { z } from "zod";

export const VISITOR_LABELS = {
  visitorName: "Visitor Name",
  email: "Email",
  mobile: "Mobile Number",
  companyName: "Company Name",
  visitDate: "Visit Date",
  entryTime: "Entry Time",
  exitTime: "Exit Time",
  purpose: "Purpose of Visit",
  meetingWithUserId: "Meeting with",
  remarks: "Remarks",
} as const;

export type VisitorField = keyof typeof VISITOR_LABELS;

export const VISITOR_LIMITS = { line: 200, mobile: 20, text: 2000 } as const;

export const EXIT_BEFORE_ENTRY = "Exit Time cannot be earlier than Entry Time.";

/** Blank → null; a value that is not text is left for the schema to refuse. */
const blankToNull = (tidy: (s: string) => string) => (v: unknown) =>
  typeof v === "string" ? tidy(v) || null : v;

/** A single-line value: line breaks and runs of spaces become one space. */
const oneLine = blankToNull((s) => s.replace(/\s+/g, " ").trim());
/** A multi-line value keeps its line breaks. */
const manyLines = blankToNull((s) => s.replace(/\r\n?/g, "\n").trim());

/** `2026-02-30` is the right shape and not a date. */
export function isRealDate(s: string): boolean {
  if (!/^(19|20)\d{2}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** `10:30` from `10:30` or the database's `10:30:00`. */
export function toHhMm(v: string): string {
  return /^\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(v) ? v.slice(0, 5) : v;
}

const time = (label: string) =>
  z.preprocess(
    blankToNull((s) => toHhMm(s.trim())),
    z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, `${label} must be a time such as 14:30.`).nullable(),
  );

const optionalLine = (label: string) =>
  z.preprocess(oneLine, z.string().max(VISITOR_LIMITS.line, `${label} is too long.`).nullable());

const optionalText = (label: string) =>
  z.preprocess(manyLines, z.string().max(VISITOR_LIMITS.text, `${label} is too long (${VISITOR_LIMITS.text} characters at most).`).nullable());

const shape = {
  visitorName: z.preprocess(
    (v) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : (v ?? "")),
    z.string().min(1, "Enter the visitor's name.").max(VISITOR_LIMITS.line, "Visitor Name is too long."),
  ),
  email: z.preprocess(oneLine, z.string().max(VISITOR_LIMITS.line, "Email is too long.").email("Enter a valid email address.").nullable()),
  mobile: z.preprocess(
    oneLine,
    z
      .string()
      .max(VISITOR_LIMITS.mobile, "Mobile Number is too long.")
      .refine((s) => /^\+?[0-9 ()-]+$/.test(s) && /^\d{7,15}$/.test(s.replace(/\D/g, "")), "Enter a valid mobile number (7 to 15 digits).")
      .nullable(),
  ),
  companyName: optionalLine("Company Name"),
  visitDate: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : (v ?? "")),
    z.string().refine(isRealDate, "Choose the Visit Date."),
  ),
  entryTime: time("Entry Time"),
  exitTime: time("Exit Time"),
  purpose: optionalText("Purpose of Visit"),
  meetingWithUserId: z.preprocess(blankToNull((s) => s.trim()), z.string().uuid("Choose a team member from the list.").nullable()),
  remarks: optionalText("Remarks"),
};

/** A new visit: only the name and the date are required. */
export const VisitorCreateBody = z.object({
  visitorName: shape.visitorName,
  email: shape.email.optional(),
  mobile: shape.mobile.optional(),
  companyName: shape.companyName.optional(),
  visitDate: shape.visitDate,
  entryTime: shape.entryTime.optional(),
  exitTime: shape.exitTime.optional(),
  purpose: shape.purpose.optional(),
  meetingWithUserId: shape.meetingWithUserId.optional(),
  remarks: shape.remarks.optional(),
});

/** An edit: only the fields sent are changed; null or "" clears an optional one. */
export const VisitorPatchBody = z.object({
  visitorName: shape.visitorName.optional(),
  email: shape.email.optional(),
  mobile: shape.mobile.optional(),
  companyName: shape.companyName.optional(),
  visitDate: shape.visitDate.optional(),
  entryTime: shape.entryTime.optional(),
  exitTime: shape.exitTime.optional(),
  purpose: shape.purpose.optional(),
  meetingWithUserId: shape.meetingWithUserId.optional(),
  remarks: shape.remarks.optional(),
});

export type VisitorInput = z.infer<typeof VisitorCreateBody>;
export type VisitorPatch = z.infer<typeof VisitorPatchBody>;

/** Both are "HH:MM", so text order is time order. A missing one is never wrong. */
export function exitBeforeEntry(entry: string | null | undefined, exit: string | null | undefined): boolean {
  return !!entry && !!exit && toHhMm(exit) < toHhMm(entry);
}

/** `2:30 PM`, or "—". */
export function formatVisitTime(v: string | null | undefined): string {
  if (!v) return "—";
  const [h, m] = toHhMm(v).split(":");
  const hour = Number(h);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${m} ${hour < 12 ? "AM" : "PM"}`;
}

/* ── The list's search and date filter ─────────────────────────────────────── */

export const VISITOR_PAGE_SIZE = 25;

export type VisitorFilter = { q: string; from: string; to: string; page: number };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? "").trim();

/** URL params → filter. A date that is not a date is ignored; dates picked backwards are swapped. */
export function parseVisitorFilter(params: Params): VisitorFilter {
  const date = (v: string) => (isRealDate(v) ? v : "");
  let from = date(one(params.from));
  let to = date(one(params.to));
  if (from && to && from > to) [from, to] = [to, from];
  const page = Number.parseInt(one(params.page), 10);
  return { q: one(params.q).slice(0, 100), from, to, page: Number.isFinite(page) && page > 1 ? page : 1 };
}
