/**
 * Couriers: the fields, the picklists and the rules — pure, shared by the form,
 * the API, the pages, the import and the export. Nothing here reads the database.
 */

import { z } from "zod";
import { isRealDate, isUuid } from "@/lib/visitors/entry";

export { isRealDate, isUuid };

export type Option = { value: string; label: string };

export type CourierType = "inward" | "outward";

export const COURIER_TYPES: Option[] = [
  { value: "inward", label: "Inward" },
  { value: "outward", label: "Outward" },
];

/** What a courier's status can be depends on which way it is going. */
export const COURIER_STATUSES: Record<CourierType, Option[]> = {
  inward: [
    { value: "in_transit", label: "In Transit" },
    { value: "received", label: "Received" },
    { value: "handed_over", label: "Handed Over" },
    { value: "returned", label: "Returned" },
  ],
  outward: [
    { value: "pending", label: "Pending" },
    { value: "dispatched", label: "Dispatched" },
    { value: "in_transit", label: "In Transit" },
    { value: "delivered", label: "Delivered" },
    { value: "returned", label: "Returned" },
    { value: "lost", label: "Lost" },
  ],
};

/** Every status once, for the filter, the import's dropdown and the export. */
export const ALL_COURIER_STATUSES: Option[] = [...COURIER_STATUSES.inward, ...COURIER_STATUSES.outward]
  .filter((s, i, all) => all.findIndex((x) => x.value === s.value) === i);

/** What a new courier of each type starts as. */
export const DEFAULT_STATUS: Record<CourierType, string> = { inward: "received", outward: "pending" };

export const COURIER_CATEGORIES: Option[] = [
  { value: "documents", label: "Documents" },
  { value: "parcel", label: "Parcel" },
  { value: "cheque", label: "Cheque" },
  { value: "agreement", label: "Agreement" },
  { value: "kyc_documents", label: "KYC Documents" },
  { value: "office_supplies", label: "Office Supplies" },
  { value: "other", label: "Other" },
];

export const PAYMENT_MODES: Option[] = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "cheque", label: "Cheque" },
  { value: "courier_account", label: "Courier Account" },
  { value: "other", label: "Other" },
];

export const optionLabel = (options: Option[], value: string | null | undefined): string | null =>
  value ? (options.find((o) => o.value === value)?.label ?? value) : null;

export const COURIER_LABELS = {
  courierType: "Courier Type",
  courierCompany: "Courier Company",
  trackingNumber: "Tracking Number",
  courierDate: "Courier Date",
  status: "Courier Status",
  category: "Courier Category",
  categoryOther: "Other Category",
  description: "Courier Description",
  remarks: "Remarks",
  senderName: "Sender Name",
  senderCompany: "Sender Company",
  senderMobile: "Sender Mobile",
  senderEmail: "Sender Email",
  senderAddress: "Sender Address",
  receivedDate: "Received Date",
  recipientName: "Recipient Name",
  recipientCompany: "Recipient Company",
  recipientMobile: "Recipient Mobile",
  recipientEmail: "Recipient Email",
  recipientAddress: "Recipient Address",
  dispatchDate: "Dispatch Date",
  courierCharges: "Courier Charges",
  paymentMode: "Payment Mode",
  deliveredDate: "Delivered Date",
} as const;

export type CourierField = keyof typeof COURIER_LABELS;

export const INWARD_FIELDS = [
  "senderName", "senderCompany", "senderMobile", "senderEmail", "senderAddress", "receivedDate",
] as const satisfies readonly CourierField[];

export const OUTWARD_FIELDS = [
  "recipientName", "recipientCompany", "recipientMobile", "recipientEmail", "recipientAddress",
  "dispatchDate", "courierCharges", "paymentMode", "deliveredDate",
] as const satisfies readonly CourierField[];

/** The details that belong to the other type, which a courier of this type never holds. */
export const otherSideFields = (type: CourierType): readonly CourierField[] =>
  type === "inward" ? OUTWARD_FIELDS : INWARD_FIELDS;

export const COURIER_LIMITS = { line: 200, mobile: 20, text: 2000 } as const;

export const DELIVERED_BEFORE_DISPATCH = "Delivered Date cannot be earlier than Dispatch Date.";

/* ── One value at a time ───────────────────────────────────────────────────── */

/** Blank → null; a value that is not text is left for the schema to refuse. */
const blankToNull = (tidy: (s: string) => string) => (v: unknown) =>
  v === undefined ? null : typeof v === "string" ? tidy(v) || null : v;

const oneLine = blankToNull((s) => s.replace(/\s+/g, " ").trim());
const manyLines = blankToNull((s) => s.replace(/\r\n?/g, "\n").trim());
const trimmed = blankToNull((s) => s.trim());

const line = (label: string) =>
  z.preprocess(oneLine, z.string().max(COURIER_LIMITS.line, `${label} is too long.`).nullable());

const long = (label: string) =>
  z.preprocess(manyLines, z.string().max(COURIER_LIMITS.text, `${label} is too long (${COURIER_LIMITS.text} characters at most).`).nullable());

const day = (label: string) =>
  z.preprocess(trimmed, z.string().refine(isRealDate, `${label} is not a valid date.`).nullable());

const email = z.preprocess(oneLine, z.string().max(COURIER_LIMITS.line, "Email is too long.").email("Enter a valid email address.").nullable());

const mobile = z.preprocess(
  oneLine,
  z
    .string()
    .max(COURIER_LIMITS.mobile, "Mobile number is too long.")
    .refine((s) => /^\+?[0-9 ()-]+$/.test(s) && /^\d{7,15}$/.test(s.replace(/\D/g, "")), "Enter a valid mobile number (7 to 15 digits).")
    .nullable(),
);

const choice = (options: Option[], message: string) =>
  z.preprocess(trimmed, z.string().refine((v) => options.some((o) => o.value === v), message).nullable());

/** "₹1,250.50" → "1250.50". Kept as text, as the database's numeric is. */
const money = z.preprocess(
  (v) => {
    if (v === undefined || v === null) return null;
    if (typeof v === "number") return String(v);
    return typeof v === "string" ? v.replace(/₹|rs\.?|inr|,|\s/gi, "") || null : v;
  },
  z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, "Courier Charges must be an amount such as 120 or 120.50.").nullable(),
);

const shape = {
  courierType: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : (v ?? "")),
    z.enum(["inward", "outward"], { errorMap: () => ({ message: "Choose the Courier Type." }) }),
  ),
  courierCompany: line("Courier Company"),
  trackingNumber: line("Tracking Number"),
  courierDate: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : (v ?? "")),
    z.string().refine(isRealDate, "Choose the Courier Date."),
  ),
  status: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : (v ?? "")),
    z.string().min(1, "Choose the Courier Status."),
  ),
  category: choice(COURIER_CATEGORIES, "Choose a Courier Category from the list."),
  categoryOther: line("Other Category"),
  description: long("Courier Description"),
  remarks: long("Remarks"),
  senderName: line("Sender Name"),
  senderCompany: line("Sender Company"),
  senderMobile: mobile,
  senderEmail: email,
  senderAddress: long("Sender Address"),
  receivedDate: day("Received Date"),
  recipientName: line("Recipient Name"),
  recipientCompany: line("Recipient Company"),
  recipientMobile: mobile,
  recipientEmail: email,
  recipientAddress: long("Recipient Address"),
  dispatchDate: day("Dispatch Date"),
  courierCharges: money,
  paymentMode: choice(PAYMENT_MODES, "Choose a Payment Mode from the list."),
  deliveredDate: day("Delivered Date"),
};

/* ── A whole courier ───────────────────────────────────────────────────────── */

/**
 * A courier as it will be saved: only the type, date and status are required.
 * The other type's details are dropped before they are checked, so a value left
 * over from before the type was changed neither blocks the save nor is stored.
 */
export const CourierBody = z.preprocess(
  (raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const r = { ...(raw as Record<string, unknown>) };
    const type = typeof r.courierType === "string" ? r.courierType.trim() : "";
    if (type === "inward" || type === "outward") for (const f of otherSideFields(type)) r[f] = null;
    if (typeof r.category !== "string" || r.category.trim() !== "other") r.categoryOther = null;
    return r;
  },
  z.object(shape).superRefine((c, ctx) => {
    const bad = (path: CourierField, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (!COURIER_STATUSES[c.courierType].some((s) => s.value === c.status)) {
      const allowed = COURIER_STATUSES[c.courierType].map((s) => s.label).join(", ");
      bad("status", `Courier Status for an ${optionLabel(COURIER_TYPES, c.courierType)} courier is one of: ${allowed}.`);
    }
    if (c.category === "other" && !c.categoryOther) bad("categoryOther", "Type the category.");
    if (c.dispatchDate && c.deliveredDate && c.deliveredDate < c.dispatchDate) bad("deliveredDate", DELIVERED_BEFORE_DISPATCH);
  }),
);

export type CourierInput = z.infer<typeof CourierBody>;

const sentValue = z.union([z.string(), z.number(), z.null()]).optional();

/**
 * An edit: only the fields sent are changed; null or "" clears an optional one.
 * Values are only shape-checked here. The rules run across fields (the status
 * and the details follow the type), so the service merges the edit into the
 * courier and checks the whole of it with CourierBody.
 */
export const CourierPatchBody = z.object(
  Object.fromEntries(Object.keys(COURIER_LABELS).map((k) => [k, sentValue])) as Record<CourierField, typeof sentValue>,
);

export type CourierPatch = z.infer<typeof CourierPatchBody>;

/** `₹1,250.5`, or "—". */
export function formatCharges(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(v));
}

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info";

export function statusTone(status: string): StatusTone {
  if (status === "received" || status === "handed_over" || status === "delivered") return "success";
  if (status === "in_transit" || status === "dispatched") return "info";
  if (status === "pending") return "warning";
  if (status === "returned" || status === "lost") return "danger";
  return "neutral";
}

/** The category as it reads: the typed one when "Other" was chosen. */
export function categoryText(category: string | null, categoryOther: string | null): string | null {
  if (category === "other" && categoryOther) return `Other — ${categoryOther}`;
  return optionLabel(COURIER_CATEGORIES, category);
}

/* ── The list's search and filters ─────────────────────────────────────────── */

export const COURIER_PAGE_SIZE = 25;

export type CourierFilter = {
  q: string;
  type: CourierType | "";
  statuses: string[];
  categories: string[];
  /** Courier Date range, both ends included. */
  from: string;
  to: string;
  /** Courier Company contains this. */
  company: string;
  page: number;
};

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? "").trim();
const many = (v: string, options: Option[]) => v.split(",").filter((x) => options.some((o) => o.value === x));

/**
 * URL params → filter: `q`, `type`, `status` and `category` (comma-separated),
 * `courier_from`, `courier_to`, `company`, `page`. A value that is not one of the
 * choices, or not a date, is ignored; dates picked backwards are swapped.
 */
export function parseCourierFilter(params: Params): CourierFilter {
  const date = (v: string) => (isRealDate(v) ? v : "");
  let from = date(one(params.courier_from));
  let to = date(one(params.courier_to));
  if (from && to && from > to) [from, to] = [to, from];
  const type = one(params.type);
  const page = Number.parseInt(one(params.page), 10);
  return {
    q: one(params.q).slice(0, 100),
    type: type === "inward" || type === "outward" ? type : "",
    statuses: many(one(params.status), ALL_COURIER_STATUSES),
    categories: many(one(params.category), COURIER_CATEGORIES),
    from,
    to,
    company: one(params.company).slice(0, 100),
    page: Number.isFinite(page) && page > 1 ? page : 1,
  };
}

/** Whether the list is narrowed at all (the page number is not a narrowing). */
export function isCourierFiltered(f: CourierFilter): boolean {
  return !!(f.q || f.type || f.statuses.length || f.categories.length || f.from || f.to || f.company);
}
