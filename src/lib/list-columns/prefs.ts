/**
 * Per-user column choices for a list page: the ORDER the columns stand in and
 * the EXTRA fields the user added from the module's field list.
 *
 * Kept in a cookie (not localStorage) so the SERVER renders the table already
 * in the person's order, with the extra values selected — no flash, and no
 * reshuffling of DOM that React owns. Show / hide of the built-in columns stays
 * in ColumnManager's localStorage CSS, as before.
 *
 * Pure functions only: safe to import from server and client code alike.
 */

export type ColumnPrefs = { order: string[]; extra: string[] };

/** An added field's column key is `x:<field key>`, so it never clashes with a built-in column. */
export const EXTRA_PREFIX = "x:";
export const MAX_EXTRA_COLUMNS = 12;

export const EMPTY_PREFS: ColumnPrefs = { order: [], extra: [] };

export function prefsCookieName(moduleKey: string): string {
  return `aina_cols_${moduleKey.replace(/[^a-z0-9_-]/gi, "_")}`;
}

const KEY_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

export function parsePrefs(raw: string | null | undefined): ColumnPrefs {
  if (!raw) return EMPTY_PREFS;
  try {
    const j = JSON.parse(decodeURIComponent(raw)) as Partial<ColumnPrefs>;
    const clean = (a: unknown) =>
      Array.isArray(a) ? [...new Set(a.filter((k): k is string => typeof k === "string" && KEY_RE.test(k)))] : [];
    return { order: clean(j.order).slice(0, 80), extra: clean(j.extra).slice(0, MAX_EXTRA_COLUMNS) };
  } catch {
    return EMPTY_PREFS;
  }
}

export function serializePrefs(p: ColumnPrefs): string {
  return encodeURIComponent(JSON.stringify({ order: p.order, extra: p.extra }));
}

/**
 * The columns in the order to draw them.
 *
 * `available` is every key that can be drawn right now, in its DEFAULT order
 * (built-in columns, then the extras the user added). `order` is the person's
 * saved sequence; keys it does not mention keep their default place after the
 * ones it does. `pinFirst` / `pinLast` (the name, the row actions) never move.
 */
export function orderKeys(
  available: string[],
  order: string[],
  pinFirst: string[] = [],
  pinLast: string[] = [],
): string[] {
  const has = new Set(available);
  const first = pinFirst.filter((k) => has.has(k));
  const last = pinLast.filter((k) => has.has(k) && !first.includes(k));
  const pinned = new Set([...first, ...last]);
  const middle: string[] = [];
  for (const k of order) if (has.has(k) && !pinned.has(k) && !middle.includes(k)) middle.push(k);
  for (const k of available) if (!pinned.has(k) && !middle.includes(k)) middle.push(k);
  return [...first, ...middle, ...last];
}

/** Move `key` one step up (-1) or down (+1) among the movable keys; pinned ones stay put. */
export function moveKey(keys: string[], key: string, dir: -1 | 1, pinFirst: string[] = [], pinLast: string[] = []): string[] {
  const movable = keys.filter((k) => !pinFirst.includes(k) && !pinLast.includes(k));
  const i = movable.indexOf(key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= movable.length) return keys;
  [movable[i], movable[j]] = [movable[j], movable[i]];
  return [...keys.filter((k) => pinFirst.includes(k)), ...movable, ...keys.filter((k) => pinLast.includes(k))];
}
