/**
 * Every lead field as a Leads list column. The list used to offer only nine;
 * the firm asked for all of them. These are the columns AFTER the original
 * ones (score … created), grouped the way "Manage columns" lists them, plus
 * one column per custom lead field the firm has defined.
 *
 * Cells are formatted here, on the server, as plain strings (null = blank), so
 * the table component only lays them out. Internal columns (normalised
 * phone/email, the legacy text score, raw KYC capture) are not offered, nor
 * the multiple-pipelines pipeline / pipeline_stage: only the Pipeline Board
 * set them, and it was removed (2026-10-02).
 *
 * Plain module: safe for the server page and the client table alike.
 */

import { MASTER_SEEDS } from "@/lib/masters/seeds";
import { displayPan } from "@/lib/investors/pan-display";
import { formatDate, humanise } from "@/lib/format";
import { formatINR } from "@/lib/utils";

export type LeadExtraColumn = {
  key: string;
  label: string;
  group: string;
  /** Free text that can run long — truncated in the cell, full text on hover. */
  long?: boolean;
};

export type LeadCustomFieldDef = { key: string; label: string; type: string };

const CONTACT = "Contact";
const PROFILE = "Profile";
const PIPELINE = "Stage & score";
const FOLLOW_UP = "Follow-up";
const SOURCE = "Source & campaign";
const OUTCOME = "Outcome";
const RECORD = "Record";

const BASE_COLUMNS: LeadExtraColumn[] = [
  { key: "phone", label: "Mobile", group: CONTACT },
  { key: "altPhone", label: "Alternate mobile", group: CONTACT },
  { key: "email", label: "Email", group: CONTACT },
  { key: "altEmail", label: "Alternate email", group: CONTACT },
  { key: "city", label: "City", group: CONTACT },
  { key: "pincode", label: "Pincode", group: CONTACT },
  { key: "pan", label: "PAN", group: CONTACT },
  { key: "leadType", label: "Lead type", group: PROFILE },
  { key: "aumPotential", label: "AUM potential", group: PROFILE },
  { key: "interestProducts", label: "Interested in", group: PROFILE, long: true },
  { key: "occupation", label: "Occupation", group: PROFILE },
  { key: "currentInvestments", label: "Current investments", group: PROFILE, long: true },
  { key: "stageChangedAt", label: "In stage since", group: PIPELINE },
  { key: "scoreBand", label: "Score band", group: PIPELINE },
  { key: "lastFollowUpAt", label: "Last follow-up", group: FOLLOW_UP },
  { key: "followUpNotes", label: "Follow-up notes", group: FOLLOW_UP, long: true },
  { key: "referredBy", label: "Referred by", group: SOURCE },
  { key: "subDistributor", label: "Sub-distributor", group: SOURCE },
  { key: "sourceCampaign", label: "Campaign", group: SOURCE },
  { key: "utmSource", label: "UTM source", group: SOURCE },
  { key: "utmMedium", label: "UTM medium", group: SOURCE },
  { key: "utmCampaign", label: "UTM campaign", group: SOURCE },
  { key: "convertedAt", label: "Converted on", group: OUTCOME },
  { key: "lostReason", label: "Lost reason", group: OUTCOME, long: true },
  { key: "lostAt", label: "Lost on", group: OUTCOME },
  { key: "branch", label: "Branch", group: RECORD },
  { key: "tags", label: "Tags", group: RECORD, long: true },
  { key: "notes", label: "Notes", group: RECORD, long: true },
  { key: "updatedAt", label: "Last updated", group: RECORD },
];

const LEAD_TYPES: Record<string, string> = { individual: "Individual", hni: "HNI", nri: "NRI", huf: "HUF", corporate: "Corporate", minor: "Minor" };
const AUM_BANDS: Record<string, string> = {
  under_10l: "< ₹10 L",
  "10l_50l": "₹10 – 50 L",
  "50l_2cr": "₹50 L – 2 Cr",
  hni_2cr_plus: "HNI · ₹2 Cr+",
};
const INTERESTS = new Map((MASTER_SEEDS.interest_product ?? []).map((r) => [r.key, r.label]));

const customKey = (key: string) => `cf_${key}`;

/** The extra columns, then one per custom lead field. */
export function leadExtraColumns(defs: LeadCustomFieldDef[]): LeadExtraColumn[] {
  return [
    ...BASE_COLUMNS,
    ...defs.map((d) => ({ key: customKey(d.key), label: d.label, group: "Custom fields", long: d.type === "textarea" })),
  ];
}

const text = (v: unknown): string | null => {
  const s = v == null ? "" : String(v).trim();
  return s ? s : null;
};
const day = (v: unknown): string | null => (v ? formatDate(v as any) : null);
const list = (v: unknown, label: (s: string) => string = (s) => s): string | null =>
  Array.isArray(v) && v.length ? v.map((x) => label(String(x))).join(", ") : null;

function customValue(type: string, v: unknown): string | null {
  if (v == null || v === "") return null;
  switch (type) {
    case "checkbox": return v === true || v === "true" ? "Yes" : "No";
    case "multiselect": return list(v);
    case "date": return day(v);
    case "currency": return formatINR(v as any);
    case "number": return Number.isFinite(Number(v)) ? Number(v).toLocaleString("en-IN") : text(v);
    default: return Array.isArray(v) ? list(v) : text(v);
  }
}

/**
 * One lead's cells for the extra columns. `joined` carries the names the list
 * query looked up (branch, sub-distributor, the referring client).
 */
export function leadExtraCells(
  l: Record<string, any>,
  joined: { branch: string | null; subDistributor: string | null; referredClient: string | null },
  defs: LeadCustomFieldDef[],
): Record<string, string | null> {
  const utm = (l.utmParams ?? {}) as Record<string, unknown>;
  const profile = (l.profile ?? {}) as Record<string, unknown>;
  const lost = text(l.lostReason);
  const cells: Record<string, string | null> = {
    phone: text(l.phone),
    altPhone: text(l.altPhone),
    email: text(l.email),
    altEmail: text(l.altEmail),
    city: text(l.city),
    pincode: text(l.pincode),
    pan: displayPan(l.pan),
    leadType: l.leadType ? LEAD_TYPES[l.leadType] ?? humanise(l.leadType) : null,
    aumPotential: l.aumPotential ? AUM_BANDS[l.aumPotential] ?? humanise(l.aumPotential) : null,
    interestProducts: list(l.interestProducts, (k) => INTERESTS.get(k) ?? humanise(k)),
    occupation: text(profile.occupation),
    currentInvestments: list(profile.currentInvestments, humanise),
    stageChangedAt: day(l.stageChangedAt),
    scoreBand: l.scoreBand ? humanise(l.scoreBand) : null,
    lastFollowUpAt: day(l.lastFollowUpAt),
    followUpNotes: text(l.followUpNotes),
    referredBy: text(l.referredByName) ?? joined.referredClient,
    subDistributor: joined.subDistributor,
    sourceCampaign: text(l.sourceCampaign),
    utmSource: text(utm.source),
    utmMedium: text(utm.medium),
    utmCampaign: text(utm.campaign),
    convertedAt: day(l.convertedAt),
    // "__deleted__" and the like are internal markers, not reasons.
    lostReason: lost && !lost.startsWith("__") ? lost : null,
    lostAt: day(l.lostAt),
    branch: joined.branch,
    tags: list(l.tags),
    notes: text(l.notes),
    updatedAt: day(l.updatedAt),
  };
  const custom = (l.customFields ?? {}) as Record<string, unknown>;
  for (const d of defs) cells[customKey(d.key)] = customValue(d.type, custom[d.key]);
  return cells;
}
