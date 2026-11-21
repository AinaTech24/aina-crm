/**
 * New task remembers, on this phone and per account, the last task type and
 * priority used — so an RM who books redemptions all day starts on
 * Financial → Redemption at High. Stored as the POSTed `type` (a request key,
 * "follow_up" or a custom kind) and `priority`.
 *
 * Restoring never overrides what the screen was opened with or what a
 * template sets (NewTaskScreen applies them after, and stops restoring once
 * the person has touched the fields). A task opened prefilled — a client
 * card's "Follow up with …", a call summary — is a follow-up, so only its
 * priority is restored. A request no longer in the list, or the Insurance
 * category on a firm without it, is dropped.
 */

import { bulkGet, bulkSet } from "../../lib/bulkStorage";
import { getAccountScope } from "../../lib/accountScope";

export type TaskCategoryKey = "general" | "financial" | "non_financial" | "insurance";

export interface TaskPrefs {
  type?: string;
  priority?: string;
}

export interface RestoredTaskPrefs {
  priority?: string;
  category?: TaskCategoryKey;
  requestKey?: string;
  kind?: "follow_up" | "custom";
  customType?: string;
}

const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
/** Bare category values older tasks carry — not a type to start a new task on. */
const NOT_A_TYPE = new Set(["financial", "non_financial", "insurance", "general"]);
const keyFor = (owner: string) => `task_prefs_v1.${owner}`;

/** A stored value → prefs, or null when it is not ours. */
export function parseTaskPrefs(raw: string | null | undefined): TaskPrefs | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const out: TaskPrefs = {};
    if (typeof v.type === "string" && v.type.trim() && v.type.length <= 80) out.type = v.type.trim();
    if (typeof v.priority === "string" && PRIORITIES.has(v.priority)) out.priority = v.priority;
    return out.type || out.priority ? out : null;
  } catch {
    return null;
  }
}

/** What New task should start on, from the saved prefs (see the header for the rules). */
export function restoreTaskPrefs(
  saved: TaskPrefs | null,
  ctx: { prefilled: boolean; insuranceAllowed: boolean; requestCategory: (key: string) => TaskCategoryKey | null }
): RestoredTaskPrefs {
  if (!saved) return {};
  const out: RestoredTaskPrefs = {};
  if (saved.priority && PRIORITIES.has(saved.priority)) out.priority = saved.priority;
  const type = saved.type;
  if (ctx.prefilled || !type || NOT_A_TYPE.has(type)) return out;
  const cat = ctx.requestCategory(type);
  if (cat && cat !== "general") {
    if (cat === "insurance" && !ctx.insuranceAllowed) return out;
    return { ...out, category: cat, requestKey: type };
  }
  if (type === "follow_up") return { ...out, category: "general", kind: "follow_up" };
  return { ...out, category: "general", kind: "custom", customType: type };
}

export async function loadTaskPrefs(): Promise<TaskPrefs | null> {
  const { owner } = getAccountScope();
  if (!owner) return null;
  try {
    return parseTaskPrefs(await bulkGet(keyFor(owner)));
  } catch {
    return null;
  }
}

export async function saveTaskPrefs(prefs: TaskPrefs): Promise<void> {
  const { owner } = getAccountScope();
  if (!owner) return;
  const clean = parseTaskPrefs(JSON.stringify(prefs));
  if (!clean) return;
  try {
    await bulkSet(keyFor(owner), JSON.stringify(clean));
  } catch {
    /* a convenience only — never block the save */
  }
}
