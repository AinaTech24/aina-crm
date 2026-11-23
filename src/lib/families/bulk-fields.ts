/**
 * The family fields "Update a field" can set on many families at once — one
 * registry read by the Families table's dialog AND by POST /api/families/bulk,
 * so the choices on screen are exactly the ones the server accepts (the same
 * shape as lib/investors/bulk-fields for Clients).
 *
 * Deliberately NOT here:
 *   - identity: family name, code, head — one value copied onto many
 *     households is always wrong (the head is chosen from a family's own
 *     members);
 *   - derived figures: AUM, SIP, health, member count;
 *   - last review date: it records a meeting that happened, one household at a
 *     time.
 *
 * Plain module (no DB, no React).
 */

export type FamilyBulkFieldKind = "enum" | "text" | "date" | "branch" | "rm" | "tag";

export type FamilyBulkField = {
  key: string;
  label: string;
  group: "Relationship" | "Classification" | "Review" | "Notes" | "Tags";
  kind: FamilyBulkFieldKind;
  /** enum only: value → label. */
  options?: Array<{ value: string; label: string }>;
  /** May be cleared (set to empty) for every selected family. */
  nullable: boolean;
  /** One line shown under the field in the dialog. */
  hint?: string;
  /** text / tag only: the longest value accepted. */
  maxLength?: number;
};

const o = (pairs: Array<[string, string]>) => pairs.map(([value, label]) => ({ value, label }));

export const FAMILY_BULK_TAG_MAX = 60;
export const FAMILY_BULK_NOTES_MAX = 2000;

export const FAMILY_BULK_FIELDS: FamilyBulkField[] = [
  {
    key: "rm",
    label: "Family RM",
    group: "Relationship",
    kind: "rm",
    nullable: true,
    hint: "A family has one RM: the head and every member move to this person's book, as when you change it on the family. Clearing it removes only the family's RM.",
  },
  { key: "branch", label: "Branch", group: "Relationship", kind: "branch", nullable: true },
  {
    key: "category",
    label: "Family category",
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
    key: "reviewFrequency",
    label: "Review frequency",
    group: "Review",
    kind: "enum",
    nullable: true,
    options: o([
      ["monthly", "Monthly"],
      ["quarterly", "Quarterly"],
      ["half_yearly", "Half-yearly"],
      ["annual", "Annual"],
    ]),
    hint: "The next review is worked out again (from the first meeting, else the last review, else when the family was created) and every member follows the family's frequency.",
  },
  {
    key: "nextReview",
    label: "Next review date",
    group: "Review",
    kind: "date",
    nullable: true,
  },
  {
    key: "firstMeeting",
    label: "First meeting date",
    group: "Review",
    kind: "date",
    nullable: true,
    hint: "Anchors the review schedule. Where a review frequency is set, the next review is worked out from it again.",
  },
  {
    key: "notes",
    label: "Notes",
    group: "Notes",
    kind: "text",
    nullable: true,
    maxLength: FAMILY_BULK_NOTES_MAX,
    hint: "Replaces the notes on every selected family. Each family's previous notes stay in the audit log.",
  },
  { key: "tagAdd", label: "Add a tag", group: "Tags", kind: "tag", nullable: false, maxLength: FAMILY_BULK_TAG_MAX },
  { key: "tagRemove", label: "Remove a tag", group: "Tags", kind: "tag", nullable: false, maxLength: FAMILY_BULK_TAG_MAX },
];

export const FAMILY_BULK_FIELD_BY_KEY = new Map(FAMILY_BULK_FIELDS.map((f) => [f.key, f]));

export const FAMILY_BULK_GROUPS = ["Relationship", "Classification", "Review", "Notes", "Tags"] as const;

/** Most families one request changes — the caller repeats for more. */
export const FAMILY_BULK_MAX = 2000;
