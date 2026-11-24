/**
 * A viewer's SAVED FILTERS for one dashboard — several, each with a name
 * (2026-11-24: "the saved filter should stay there, in a dropdown, to be applied
 * by selecting it; changed and saved again with a choice to overwrite or make a
 * new one; and deleted").
 *
 * Pure and client-safe. They live in the one column the single saved filter always
 * used (dashboard_user_prefs.saved_filters, jsonb), so there is no migration:
 *
 *   new shape   { items: [{ id, name, state }], defaultId }
 *   old shape   a bare FilterState — read as ONE saved filter that opens by default,
 *               exactly what it did before; the first write converts it.
 *
 * `defaultId` is the filter a dashboard opens with when the URL names none (what
 * "Save filter" used to mean). Picking one from the list applies it for that visit
 * only. The URL carries `sf=<id>` so the bar can say which saved filter is showing.
 */

import { sanitizeFilterState, type FilterState } from "./filters";

export type SavedFilter = { id: string; name: string; state: FilterState };
export type SavedFilterBook = { items: SavedFilter[]; defaultId: string | null };

/** What the filter bar is given: the list, the one a visit opens with, and the one showing now. */
export type SavedFilterList = { items: SavedFilter[]; defaultId: string | null; activeId: string | null };

export const MAX_SAVED_FILTERS = 20;
export const MAX_SAVED_NAME = 60;
/** Name given to the one filter saved before there could be several. */
export const LEGACY_NAME = "My saved filter";
/** URL parameter naming the saved filter that is showing. */
export const SAVED_FILTER_PARAM = "sf";

export const emptyBook = (): SavedFilterBook => ({ items: [], defaultId: null });

/** "  Month   end " → "Month end", cut to the limit. */
export function cleanName(name: unknown): string {
  return typeof name === "string" ? name.replace(/\s+/g, " ").trim().slice(0, MAX_SAVED_NAME) : "";
}

/** Read whatever is stored: nothing, the old single filter, or the list. */
export function readBook(raw: unknown): SavedFilterBook {
  if (!raw || typeof raw !== "object") return emptyBook();
  const r = raw as Record<string, unknown>;
  if (Array.isArray(r.items)) {
    const items: SavedFilter[] = [];
    const seen = new Set<string>();
    for (const it of r.items) {
      if (!it || typeof it !== "object") continue;
      const o = it as Record<string, unknown>;
      const id = typeof o.id === "string" && o.id && o.id.length <= 64 ? o.id : null;
      const name = cleanName(o.name);
      const state = sanitizeFilterState(o.state);
      if (!id || !name || !state || seen.has(id)) continue;
      seen.add(id);
      items.push({ id, name, state });
      if (items.length >= MAX_SAVED_FILTERS) break;
    }
    const defaultId = typeof r.defaultId === "string" && seen.has(r.defaultId) ? r.defaultId : null;
    return { items, defaultId };
  }
  // The old shape: one bare filter state.
  const legacy = "period" in r || "values" in r ? sanitizeFilterState(raw) : null;
  return legacy ? { items: [{ id: "legacy", name: LEGACY_NAME, state: legacy }], defaultId: "legacy" } : emptyBook();
}

export type SavedFilterOp =
  | { op: "create"; name: string; state: FilterState; setDefault?: boolean }
  /** Overwrite: a new state, a new name, or both. */
  | { op: "update"; id: string; state?: FilterState; name?: string }
  | { op: "delete"; id: string }
  /** The filter a dashboard opens with (null: none). */
  | { op: "default"; id: string | null };

export type OpResult =
  | { ok: true; book: SavedFilterBook; id: string | null }
  | { ok: false; status: 400 | 404 | 409; error: string };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function applySavedFilterOp(book: SavedFilterBook, op: SavedFilterOp, newId: () => string): OpResult {
  const items = book.items.map((i) => ({ ...i }));
  const clash = (name: string, exceptId?: string) => items.find((i) => i.id !== exceptId && same(i.name, name));

  if (op.op === "create") {
    const name = cleanName(op.name);
    if (!name) return { ok: false, status: 400, error: "Give the filter a name." };
    if (clash(name)) return { ok: false, status: 409, error: `You already have a saved filter called “${name}”.` };
    if (items.length >= MAX_SAVED_FILTERS) {
      return { ok: false, status: 400, error: `You can keep up to ${MAX_SAVED_FILTERS} saved filters. Delete one first.` };
    }
    const id = newId();
    items.push({ id, name, state: op.state });
    // The first one a person saves opens by default, as the single saved filter always did.
    const defaultId = op.setDefault || book.items.length === 0 ? id : book.defaultId;
    return { ok: true, book: { items, defaultId }, id };
  }

  if (op.op === "update") {
    const at = items.findIndex((i) => i.id === op.id);
    if (at < 0) return { ok: false, status: 404, error: "That saved filter no longer exists." };
    if (op.name !== undefined) {
      const name = cleanName(op.name);
      if (!name) return { ok: false, status: 400, error: "Give the filter a name." };
      if (clash(name, op.id)) return { ok: false, status: 409, error: `You already have a saved filter called “${name}”.` };
      items[at].name = name;
    }
    if (op.state) items[at].state = op.state;
    return { ok: true, book: { items, defaultId: book.defaultId }, id: op.id };
  }

  if (op.op === "delete") {
    if (!items.some((i) => i.id === op.id)) return { ok: false, status: 404, error: "That saved filter no longer exists." };
    const rest = items.filter((i) => i.id !== op.id);
    return { ok: true, book: { items: rest, defaultId: book.defaultId === op.id ? null : book.defaultId }, id: null };
  }

  if (op.id !== null && !items.some((i) => i.id === op.id)) {
    return { ok: false, status: 404, error: "That saved filter no longer exists." };
  }
  return { ok: true, book: { items, defaultId: op.id }, id: op.id };
}

/**
 * The saved filter the page starts from. A URL that sets filters wins outright (the
 * base is then the dashboard's defaults); with none, `sf` names one, else the one
 * that opens by default.
 */
export function savedBase(book: SavedFilterBook, sf: string | undefined | null, explicit: boolean): SavedFilter | null {
  if (explicit) return null;
  return book.items.find((i) => i.id === sf) ?? book.items.find((i) => i.id === book.defaultId) ?? null;
}

/** Which saved filter the bar should call "showing": the one `sf` names, or the one the page opened with. */
export function activeSavedId(book: SavedFilterBook, sf: string | undefined | null, explicit: boolean): string | null {
  const named = book.items.find((i) => i.id === sf);
  if (explicit) return named?.id ?? null;
  return savedBase(book, sf, explicit)?.id ?? null;
}
