/**
 * Several saved filters per dashboard (2026-11-24): the list, overwrite or new, rename, delete, the one a dashboard
 * opens with — and the old single saved filter still reading as one that opens by default.
 */
import { describe, expect, it } from "vitest";
import {
  activeSavedId, applySavedFilterOp, cleanName, readBook, savedBase,
  MAX_SAVED_FILTERS, type SavedFilterBook, type SavedFilterOp,
} from "@/lib/dashboards/system/saved-filters";
import type { FilterState } from "@/lib/dashboards/system/filters";

const fy: FilterState = { period: "fy", values: {} };
const rmA: FilterState = { period: "month", values: { rm: ["a"] } };
let n = 0;
const id = () => `id${++n}`;
const empty: SavedFilterBook = { items: [], defaultId: null };

function must(book: SavedFilterBook, op: SavedFilterOp) {
  const r = applySavedFilterOp(book, op, id);
  if (!r.ok) throw new Error(r.error);
  return r;
}

describe("readBook", () => {
  it("reads nothing as an empty list", () => {
    expect(readBook(null)).toEqual(empty);
    expect(readBook(undefined)).toEqual(empty);
    expect(readBook("x")).toEqual(empty);
    expect(readBook({})).toEqual(empty);
  });

  it("reads the old single saved filter as one that opens by default", () => {
    const b = readBook({ period: "month", values: { rm: ["a"] } });
    expect(b.items).toHaveLength(1);
    expect(b.items[0]).toMatchObject({ id: "legacy", name: "My saved filter" });
    expect(b.items[0].state).toMatchObject({ period: "month", values: { rm: ["a"] } });
    expect(b.defaultId).toBe("legacy");
  });

  it("keeps a good list and drops broken entries and a default that points nowhere", () => {
    const b = readBook({
      items: [
        { id: "a", name: "  Month   end ", state: { period: "month", values: {} } },
        { id: "a", name: "duplicate id", state: { period: "fy", values: {} } },
        { id: "", name: "no id", state: { period: "fy", values: {} } },
        { id: "c", name: "", state: { period: "fy", values: {} } },
        { id: "d", name: "no state" },
        "junk",
      ],
      defaultId: "gone",
    });
    expect(b.items.map((i) => [i.id, i.name])).toEqual([["a", "Month end"]]);
    expect(b.defaultId).toBeNull();
  });
});

describe("create", () => {
  it("saves a named filter, and the first one opens by default (as the single saved filter always did)", () => {
    const r = must(empty, { op: "create", name: "  My book  ", state: rmA });
    expect(r.book.items).toHaveLength(1);
    expect(r.book.items[0].name).toBe("My book");
    expect(r.book.defaultId).toBe(r.id);
  });

  it("a later one does not take over, unless asked", () => {
    const one = must(empty, { op: "create", name: "One", state: fy });
    const two = must(one.book, { op: "create", name: "Two", state: rmA });
    expect(two.book.defaultId).toBe(one.id);
    const three = must(two.book, { op: "create", name: "Three", state: rmA, setDefault: true });
    expect(three.book.defaultId).toBe(three.id);
  });

  it("refuses a blank name and a name already used (any case)", () => {
    const one = must(empty, { op: "create", name: "Month end", state: fy });
    expect(applySavedFilterOp(one.book, { op: "create", name: "   ", state: fy }, id)).toMatchObject({ ok: false, status: 400 });
    expect(applySavedFilterOp(one.book, { op: "create", name: "month END", state: fy }, id)).toMatchObject({ ok: false, status: 409 });
  });

  it("stops at the limit", () => {
    let book = empty;
    for (let i = 0; i < MAX_SAVED_FILTERS; i++) book = must(book, { op: "create", name: `F${i}`, state: fy }).book;
    expect(applySavedFilterOp(book, { op: "create", name: "One too many", state: fy }, id)).toMatchObject({ ok: false, status: 400 });
  });

  it("does not change the list it was given", () => {
    const before: SavedFilterBook = { items: [], defaultId: null };
    must(before, { op: "create", name: "x", state: fy });
    expect(before.items).toHaveLength(0);
  });
});

describe("update (overwrite / rename)", () => {
  const base = must(must(empty, { op: "create", name: "One", state: fy }).book, { op: "create", name: "Two", state: rmA }).book;
  const one = base.items[0].id;
  const two = base.items[1].id;

  it("overwrites the filter and keeps its name", () => {
    const r = must(base, { op: "update", id: one, state: rmA });
    expect(r.book.items[0]).toMatchObject({ name: "One", state: rmA });
    expect(r.book.items[1].state).toEqual(rmA);
    expect(r.id).toBe(one);
  });

  it("renames without touching the filter", () => {
    const r = must(base, { op: "update", id: two, name: "Two (RM)" });
    expect(r.book.items[1]).toMatchObject({ name: "Two (RM)", state: rmA });
  });

  it("refuses a rename onto another filter's name, but a filter may keep its own name", () => {
    expect(applySavedFilterOp(base, { op: "update", id: two, name: "one" }, id)).toMatchObject({ ok: false, status: 409 });
    expect(applySavedFilterOp(base, { op: "update", id: two, name: "TWO" }, id)).toMatchObject({ ok: true });
  });

  it("says so when the filter is gone", () => {
    expect(applySavedFilterOp(base, { op: "update", id: "nope", state: fy }, id)).toMatchObject({ ok: false, status: 404 });
  });
});

describe("delete and default", () => {
  const base = must(must(empty, { op: "create", name: "One", state: fy }).book, { op: "create", name: "Two", state: rmA }).book;

  it("deleting the default leaves no default", () => {
    const r = must(base, { op: "delete", id: base.defaultId! });
    expect(r.book.items.map((i) => i.name)).toEqual(["Two"]);
    expect(r.book.defaultId).toBeNull();
  });

  it("deleting another keeps the default", () => {
    const r = must(base, { op: "delete", id: base.items[1].id });
    expect(r.book.defaultId).toBe(base.defaultId);
  });

  it("deleting what is not there is a 404", () => {
    expect(applySavedFilterOp(base, { op: "delete", id: "nope" }, id)).toMatchObject({ ok: false, status: 404 });
  });

  it("moves the default, clears it, and refuses an unknown one", () => {
    expect(must(base, { op: "default", id: base.items[1].id }).book.defaultId).toBe(base.items[1].id);
    expect(must(base, { op: "default", id: null }).book.defaultId).toBeNull();
    expect(applySavedFilterOp(base, { op: "default", id: "nope" }, id)).toMatchObject({ ok: false, status: 404 });
  });
});

describe("which filter a page starts from", () => {
  const base = must(must(empty, { op: "create", name: "One", state: fy }).book, { op: "create", name: "Two", state: rmA }).book;
  const one = base.items[0].id;
  const two = base.items[1].id;

  it("a URL that sets filters wins: nothing is applied under it", () => {
    expect(savedBase(base, two, true)).toBeNull();
  });
  it("with no filters in the URL, sf picks one; else the default opens", () => {
    expect(savedBase(base, two, false)?.id).toBe(two);
    expect(savedBase(base, undefined, false)?.id).toBe(one);
    expect(savedBase(base, "gone", false)?.id).toBe(one);
    expect(savedBase(empty, undefined, false)).toBeNull();
  });
  it("the bar says which is showing — the named one even when the URL sets filters", () => {
    expect(activeSavedId(base, two, true)).toBe(two);
    expect(activeSavedId(base, undefined, true)).toBeNull();
    expect(activeSavedId(base, undefined, false)).toBe(one);
    expect(activeSavedId(base, "gone", true)).toBeNull();
  });
});

describe("cleanName", () => {
  it("trims, collapses spaces, cuts to 60 and ignores non-strings", () => {
    expect(cleanName("  a   b  ")).toBe("a b");
    expect(cleanName("x".repeat(100))).toHaveLength(60);
    expect(cleanName(5)).toBe("");
  });
});
