/**
 * The firm's own introduction for client emails — company intro, services,
 * office timing, mission and the founder — plus any fields the firm adds
 * itself. Stored once per firm (`tenants.email_intro`, migration 0246) at
 * Settings → Email introduction, and filled into every email as `{{firm.*}}`.
 *
 * Pure (no DB): the settings API, the send pipeline and the designer preview
 * all go through `firmIntroTokens`, so a value reads the same everywhere.
 */

import { z } from "zod";

export type FirmIntroFieldKey =
  | "company_intro"
  | "services"
  | "office_timing"
  | "mission"
  | "founder_name"
  | "founder_designation"
  | "founder_photo_url"
  | "founder_intro";

export type FirmIntroField = {
  key: FirmIntroFieldKey;
  label: string;
  example: string;
  kind: "line" | "paragraph" | "list" | "photo";
};

const PHOTO_PLACEHOLDER =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><rect width="160" height="160" fill="#e5e7eb"/><circle cx="80" cy="62" r="28" fill="#9ca3af"/><path d="M28 150c6-30 28-46 52-46s46 16 52 46z" fill="#9ca3af"/></svg>'
  );

/** The standard fields, in the order the settings page and the picker show them. */
export const FIRM_INTRO_FIELDS: FirmIntroField[] = [
  {
    key: "company_intro",
    label: "Company introduction",
    kind: "paragraph",
    example:
      "Demo Wealth is an AMFI-registered mutual fund distributor serving families across Mumbai since 2009. We help you invest with a plan, not on a hunch.",
  },
  {
    key: "services",
    label: "Services we provide",
    kind: "list",
    example: "Mutual funds — SIP and lumpsum\nGoal-based planning\nLife and health insurance\nFixed deposits and bonds",
  },
  { key: "office_timing", label: "Office timing", kind: "line", example: "Monday to Saturday, 10:00 am – 6:30 pm" },
  {
    key: "mission",
    label: "Our mission",
    kind: "paragraph",
    example: "To help every family we serve reach its goals with honest, disciplined investing.",
  },
  { key: "founder_name", label: "Founder name", kind: "line", example: "Rakesh Mehta" },
  { key: "founder_designation", label: "Founder designation", kind: "line", example: "Founder & Principal Distributor" },
  // A grey silhouette, so the designer preview shows where the photo sits
  // before one is uploaded. Real sends only ever use the firm's own photo.
  { key: "founder_photo_url", label: "Founder photo", kind: "photo", example: PHOTO_PLACEHOLDER },
  {
    key: "founder_intro",
    label: "Founder introduction",
    kind: "paragraph",
    example:
      "Rakesh has 20 years in financial services and personally reviews every client's plan. He believes good investing is mostly patience.",
  },
];

const STANDARD_KEYS = new Set<string>(FIRM_INTRO_FIELDS.map((f) => f.key));
export const MAX_CUSTOM_FIELDS = 20;
const MAX_TEXT = 2000;

/** A field the firm added itself: shown in emails as `{{firm.<key>}}`. */
export type FirmCustomField = { key: string; label: string; value: string };

export type FirmEmailIntro = Partial<Record<FirmIntroFieldKey, string>> & {
  custom?: FirmCustomField[];
};

/** "Awards & recognition" → "awards_recognition". Empty when nothing usable is left. */
export function customFieldKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

const text = z.string().max(MAX_TEXT).transform((s) => s.trim());

export const FirmEmailIntroSchema = z
  .object({
    company_intro: text.optional(),
    services: text.optional(),
    office_timing: z.string().max(200).transform((s) => s.trim()).optional(),
    mission: text.optional(),
    founder_name: z.string().max(120).transform((s) => s.trim()).optional(),
    founder_designation: z.string().max(120).transform((s) => s.trim()).optional(),
    // An uploaded file (/api/upload-local/…) or a full https:// address.
    founder_photo_url: z
      .string()
      .max(500)
      .transform((s) => s.trim())
      .refine((s) => s === "" || s.startsWith("/api/upload-local/") || /^https:\/\//i.test(s), "Photo must be an uploaded image or an https:// address")
      .optional(),
    founder_intro: text.optional(),
    custom: z
      .array(z.object({ label: z.string().max(60).transform((s) => s.trim()), value: text }))
      .max(MAX_CUSTOM_FIELDS)
      .optional(),
  })
  .transform((v, ctx) => {
    const out: FirmEmailIntro = {};
    for (const f of FIRM_INTRO_FIELDS) {
      const val = v[f.key];
      if (val) out[f.key] = val;
    }
    const seen = new Set<string>();
    const custom: FirmCustomField[] = [];
    for (const [i, c] of (v.custom ?? []).entries()) {
      if (!c.label && !c.value) continue; // an empty row the form left behind
      const key = customFieldKey(c.label);
      if (!key) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["custom", i, "label"], message: "Give the field a name with letters or numbers" });
        continue;
      }
      if (STANDARD_KEYS.has(key) || seen.has(key)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["custom", i, "label"], message: `"${c.label}" is already a field — pick another name` });
        continue;
      }
      seen.add(key);
      custom.push({ key, label: c.label, value: c.value });
    }
    if (custom.length) out.custom = custom;
    return out;
  });

/** Read whatever is stored (older rows, hand edits) without throwing. */
export function readFirmEmailIntro(raw: unknown): FirmEmailIntro {
  if (!raw || typeof raw !== "object") return {};
  const parsed = FirmEmailIntroSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  // Keep every valid standard field even if one custom row is bad.
  const r = raw as Record<string, unknown>;
  const out: FirmEmailIntro = {};
  for (const f of FIRM_INTRO_FIELDS) {
    if (typeof r[f.key] === "string" && (r[f.key] as string).trim()) out[f.key] = (r[f.key] as string).trim();
  }
  return out;
}

/** One service per line; any bullet the firm typed is replaced by a single "• ". */
export function formatServices(raw: string): string {
  return raw
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•·]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .map((l) => `• ${l}`)
    .join("\n");
}

/**
 * The merge values, keyed as the templates write them ("firm.mission").
 * A field the firm has not filled is simply absent, so a block shown only
 * when it has a value (`showIf`) disappears instead of printing a blank.
 * `absolute` turns an uploaded photo path into a URL a mail client can load.
 */
export function firmIntroTokens(intro: FirmEmailIntro, absolute: (url: string) => string = (u) => u): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of FIRM_INTRO_FIELDS) {
    const v = intro[f.key];
    if (!v) continue;
    out[`firm.${f.key}`] = f.key === "services" ? formatServices(v) : f.key === "founder_photo_url" ? absolute(v) : v;
  }
  for (const c of intro.custom ?? []) {
    if (c.value) out[`firm.${c.key}`] = c.value;
  }
  return out;
}
