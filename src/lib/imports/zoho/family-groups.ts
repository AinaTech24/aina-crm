/**
 * A Zoho family sheet (Record Id · Contact Name · Family Owner.id · Family
 * Owner) → the households to build. Pure; tested in tests/zoho-import.test.ts.
 *
 * Decisions (We Care Freedom Wealth, 2026-11-17):
 *  - A head who is also listed as a member of another family joins that family:
 *    the chain is followed to its top, and every member of the nested family
 *    joins the top one. A loop (A → B → A) stops where it closes.
 *  - A Family Owner with nobody else (a family of one) gets no family.
 *  - A Family Owner who is not in the sheet is reported, not created.
 */

import { cell, zohoId } from "./values";

export const FAMILY_SIGNATURE = ["Record Id", "Family Owner.id"];

export type FamilyGroup = {
  headZohoId: string;
  headName: string;
  /** Zoho ids of the members (never the head), nested families' people included. */
  memberZohoIds: string[];
  /** Heads of nested families folded into this one. */
  nestedHeads: number;
};

export type FamilyPlan = {
  groups: FamilyGroup[];
  /** Family Owners not in the sheet: their rows can't be placed. */
  headMissing: Array<{ headZohoId: string; headName: string; rows: number }>;
  /** Family Owners with nobody else. */
  aloneSkipped: number;
  /** Rows with no Family Owner. */
  noFamily: number;
  duplicateIds: number;
};

export function planFamilies(rows: Record<string, unknown>[]): FamilyPlan {
  const name = new Map<string, string>();
  const ownerOf = new Map<string, string>();
  let duplicateIds = 0;
  let noFamily = 0;
  const ownerText = new Map<string, string>();
  for (const r of rows) {
    const id = zohoId(r["Record Id"]);
    if (!id) continue;
    if (name.has(id)) {
      duplicateIds++;
      continue;
    }
    name.set(id, cell(r["Contact Name"]));
    const o = zohoId(r["Family Owner.id"]);
    if (o) {
      ownerOf.set(id, o);
      if (!ownerText.has(o)) ownerText.set(o, cell(r["Family Owner"]));
    } else noFamily++;
  }

  // The top of a chain: follow Family Owner until it points at itself, at
  // someone with no owner, at someone not in the sheet, or back into the chain.
  const topCache = new Map<string, string>();
  const top = (start: string): string => {
    const seen: string[] = [];
    let cur = start;
    for (;;) {
      const cached = topCache.get(cur);
      if (cached) {
        cur = cached;
        break;
      }
      seen.push(cur);
      const next = ownerOf.get(cur);
      if (!next || next === cur || !name.has(next) || seen.includes(next)) break;
      cur = next;
    }
    for (const s of seen) topCache.set(s, cur);
    return cur;
  };

  const members = new Map<string, Set<string>>();
  const nested = new Map<string, Set<string>>();
  for (const [id, owner] of ownerOf) {
    const t = name.has(owner) ? top(owner) : owner;
    if (!members.has(t)) members.set(t, new Set());
    if (id !== t) members.get(t)!.add(id);
    if (owner !== t && name.has(owner)) {
      if (!nested.has(t)) nested.set(t, new Set());
      nested.get(t)!.add(owner);
    }
  }

  const plan: FamilyPlan = { groups: [], headMissing: [], aloneSkipped: 0, noFamily, duplicateIds };
  for (const [head, set] of members) {
    if (!name.has(head)) {
      plan.headMissing.push({ headZohoId: head, headName: ownerText.get(head) ?? "", rows: set.size });
      continue;
    }
    if (!set.size) {
      plan.aloneSkipped++;
      continue;
    }
    plan.groups.push({ headZohoId: head, headName: name.get(head) ?? "", memberZohoIds: [...set], nestedHeads: nested.get(head)?.size ?? 0 });
  }
  plan.groups.sort((a, b) => b.memberZohoIds.length - a.memberZohoIds.length);
  return plan;
}
