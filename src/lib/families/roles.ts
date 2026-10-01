/**
 * Family relationship ("family_role") labels and the head-of-family rule —
 * one copy, safe for server and client.
 *
 * The family page, the wealth map and the add-member dialog each kept their
 * own label table, and none of them knew the keys other paths wrote: family
 * create wrote `head`, the RTA importer `head` and `minor`, the pickers
 * `self`. So "head" and "minor" printed as raw keys, and the client page's
 * family card sorted the head first only when the role was `primary`, which
 * nothing writes. `self` is the canonical head key (it is the shipped
 * relationship type); `head` and `primary` are read as the same thing.
 */

export const HEAD_ROLE = "self";

const LABELS: Record<string, string> = {
  self: "Self / Head",
  head: "Self / Head",
  primary: "Self / Head",
  spouse: "Spouse",
  son: "Son",
  daughter: "Daughter",
  father: "Father",
  mother: "Mother",
  sibling: "Sibling",
  huf_karta: "HUF Karta",
  huf_coparcener: "HUF Co-parcener",
  huf: "HUF Member",
  minor: "Minor",
  other: "Other",
};

export type RoleOption = { key: string; label: string };

/** Is this family_role the head of the household? */
export function isHeadRole(role: string | null | undefined): boolean {
  return role === "self" || role === "head" || role === "primary";
}

/**
 * Display label for a stored family_role. The firm's own relationship list
 * (Family settings) wins when given, so a renamed or custom type shows as the
 * firm named it.
 */
export function roleLabel(role: string | null | undefined, options?: RoleOption[] | null): string {
  if (!role) return "—";
  const key = isHeadRole(role) ? HEAD_ROLE : role;
  const firm = options?.find((o) => o.key === key);
  if (firm) return firm.label;
  if (LABELS[role]) return LABELS[role];
  return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
