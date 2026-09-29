/**
 * The client fields "Update a field" can set on many clients at once — one
 * registry read by the Clients table's dialog AND by POST /api/investors/bulk,
 * so the choices on screen are exactly the ones the server accepts.
 *
 * Deliberately NOT here, whatever "any field" suggests:
 *   - identity: name, PAN, date of birth, email, mobile, address line —
 *     one value copied onto many clients is always wrong;
 *   - compliance evidence: KYC / FATCA status, risk profile, consents — these
 *     record what a CLIENT did or declared, and must be set one client at a
 *     time from that evidence, never in bulk;
 *   - derived figures: AUM, SIP book, health, completeness.
 *
 * Plain module (no DB, no React).
 */

export type BulkFieldKind = "enum" | "text" | "date" | "branch" | "tag";

export type BulkField = {
  key: string;
  label: string;
  group: "Relationship" | "Classification" | "Service" | "Profile" | "Address" | "Tags";
  kind: BulkFieldKind;
  /** enum only: value → label. */
  options?: Array<{ value: string; label: string }>;
  /** May be cleared (set to empty) for every selected client. */
  nullable: boolean;
  /** One line shown under the field in the dialog. */
  hint?: string;
  /** text only: suggestions come from this master list (Settings → Masters). */
  master?: "occupation" | "income_range";
};

const o = (pairs: Array<[string, string]>) => pairs.map(([value, label]) => ({ value, label }));

export const BULK_FIELDS: BulkField[] = [
  { key: "branch", label: "Branch", group: "Relationship", kind: "branch", nullable: true },
  {
    key: "status",
    label: "Status",
    group: "Relationship",
    kind: "enum",
    nullable: false,
    options: o([
      ["active", "Active"],
      ["dormant", "Dormant"],
      ["inactive", "Inactive"],
      ["redemption_risk", "Redemption risk"],
      ["closed", "Closed"],
    ]),
  },
  {
    key: "segment",
    label: "Segment",
    group: "Classification",
    kind: "enum",
    nullable: true,
    options: o([
      ["HNI", "HNI"],
      ["Affluent", "Affluent"],
      ["Retail", "Retail"],
      ["NRI", "NRI"],
      ["Corporate", "Corporate"],
    ]),
  },
  {
    key: "category",
    label: "Client category",
    group: "Classification",
    kind: "enum",
    nullable: true,
    options: o([
      ["A", "Category A"],
      ["B", "Category B"],
      ["C", "Category C"],
      ["D", "Category D"],
    ]),
  },
  {
    key: "investorType",
    label: "Investor type",
    group: "Classification",
    kind: "enum",
    nullable: false,
    options: o([
      ["individual", "Individual"],
      ["huf", "HUF"],
      ["company", "Company"],
      ["trust", "Trust"],
      ["nri", "NRI"],
      ["minor", "Minor"],
      ["other", "Other"],
    ]),
  },
  {
    key: "residency",
    label: "Residency",
    group: "Classification",
    kind: "enum",
    nullable: true,
    options: o([
      ["indian_resident", "Resident Indian"],
      ["nri", "NRI"],
      ["oci", "OCI"],
      ["pio", "PIO"],
      ["foreign_national", "Foreign national"],
    ]),
  },
  {
    key: "tier",
    label: "Service tier",
    group: "Service",
    kind: "enum",
    nullable: true,
    options: o([
      ["A", "A — Quarterly"],
      ["B", "B — Half-yearly"],
      ["C", "C — Annual"],
    ]),
  },
  {
    key: "reviewFrequency",
    label: "Review frequency",
    group: "Service",
    kind: "enum",
    nullable: true,
    hint: "Each client's next review is recalculated from their own last review (or onboarding) date.",
    options: o([
      ["monthly", "Monthly"],
      ["quarterly", "Quarterly"],
      ["half_yearly", "Half-yearly"],
      ["annual", "Annual"],
    ]),
  },
  { key: "nextReview", label: "Next review date", group: "Service", kind: "date", nullable: true },
  {
    key: "statementCadence",
    label: "Statement emails",
    group: "Service",
    kind: "enum",
    nullable: false,
    options: o([
      ["off", "Off"],
      ["monthly", "Monthly"],
      ["quarterly", "Quarterly"],
    ]),
  },
  {
    key: "language",
    label: "Language",
    group: "Service",
    kind: "enum",
    nullable: false,
    options: o([
      ["en", "English"],
      ["hi", "Hindi"],
      ["gu", "Gujarati"],
      ["mr", "Marathi"],
      ["ta", "Tamil"],
      ["te", "Telugu"],
      ["kn", "Kannada"],
      ["bn", "Bengali"],
      ["ml", "Malayalam"],
      ["pa", "Punjabi"],
    ]),
  },
  { key: "onboardedAt", label: "Onboarded on", group: "Service", kind: "date", nullable: true },
  { key: "occupation", label: "Occupation", group: "Profile", kind: "text", nullable: true, master: "occupation" },
  { key: "incomeRange", label: "Income range", group: "Profile", kind: "text", nullable: true, master: "income_range" },
  { key: "taxStatus", label: "Tax status", group: "Profile", kind: "text", nullable: true },
  { key: "city", label: "City", group: "Address", kind: "text", nullable: true, hint: "Only the city changes; the rest of each address stays as it is." },
  { key: "state", label: "State", group: "Address", kind: "text", nullable: true, hint: "Only the state changes; the rest of each address stays as it is." },
  { key: "country", label: "Country", group: "Address", kind: "text", nullable: true, hint: "Only the country changes; the rest of each address stays as it is." },
  { key: "tagAdd", label: "Add a tag", group: "Tags", kind: "tag", nullable: false, hint: "Clients that already have the tag are left as they are." },
  { key: "tagRemove", label: "Remove a tag", group: "Tags", kind: "tag", nullable: false },
];

export const BULK_FIELD_BY_KEY = new Map(BULK_FIELDS.map((f) => [f.key, f]));

/** Longest free-text value accepted for a text or tag field. */
export const BULK_TEXT_MAX = 120;
