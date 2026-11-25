/**
 * Client master PDF — the shapes shared by the loader (./load.ts) and the renderer
 * (./render.ts). Pure types and constants: nothing here touches the database.
 */

/* ───────────────────────────── shapes ───────────────────────────── */

/** One cell of a table: plain text, or text with a status colour. */
export type PdfCell = string | { t: string; tone?: "good" | "warn" | "bad" | "muted" };
export type PdfKv = { label: string; value: string; span?: 2 | 3 };
export type PdfTable = { heads: string[]; rows: PdfCell[][]; widths: number[]; align?: Array<"l" | "r">; empty?: string };

export type OptionalKey = "meetings" | "serviceRequests" | "tasks" | "emails" | "gifts";
export const OPTIONAL_KEYS: OptionalKey[] = ["meetings", "serviceRequests", "tasks", "emails", "gifts"];
export const OPTIONAL_LABEL: Record<OptionalKey, string> = {
  meetings: "Meetings", serviceRequests: "Service requests", tasks: "Tasks", emails: "Emails", gifts: "Gifts",
};

export type ClientMasterData = {
  generatedAt: string;
  refId: string;
  brand: {
    displayName: string | null; legalName: string | null; arn: string | null;
    primaryColor: string | null; secondaryColor: string | null; logoUrl: string | null;
  };
  client: { name: string; pan: string | null; status: string; typeLabel: string; since: string | null; rm: string | null; branch: string | null; family: string | null; aum: number | null; sipBook: number | null };
  master: {
    identity: PdfKv[]; contact: PdfKv[]; profile: PdfKv[]; compliance: PdfKv[];
    bank: PdfTable | null; secondHolder: PdfKv[] | null; lifetime: PdfKv[];
  };
  nominees: { note: string; table: PdfTable } | null;
  referrals: { referredBy: PdfKv[]; typed: PdfTable | null; leads: PdfTable };
  risk: { summary: PdfKv[]; answers: PdfTable | null } | null;
  portfolio: {
    tiles: Array<{ label: string; value: string; tone?: "good" | "bad" }>;
    holdings: PdfTable; allocation: Array<{ label: string; pct: number; value: number }>; sips: PdfTable; sipNote: string; note: string | null;
  } | null;
  fds: { tiles: Array<{ label: string; value: string }>; table: PdfTable };
  crossSell: { holdings: PdfTable; open: PdfTable; closed: PdfTable };
  review: { schedule: PdfKv[]; last: { facts: PdfKv[]; points: string | null; actions: PdfTable } | null; history: PdfTable };
  optional: Partial<Record<OptionalKey, { title: string; table: PdfTable }>>;
  notes: Array<{ by: string; at: string; title: string; text: string }>;
  /** What the viewer's role may include — drives the popup. */
  available: Record<OptionalKey, boolean>;
};
