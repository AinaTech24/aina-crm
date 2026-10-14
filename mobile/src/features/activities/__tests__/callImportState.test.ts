import { advanceCallImport, callIdentity, callReadFrom, parseCallImportState, CALL_RECHECK_MS } from "../callImportState";

test("rechecks late-written calls without crossing the consent boundary", () => {
  const now = 1800000000000;
  expect(callReadFrom({ cursor: now, seen: {} }, now - 3600000)).toBe(now - 3600000);
  expect(callReadFrom({ cursor: now, seen: {} }, now - 2 * CALL_RECHECK_MS)).toBe(now - CALL_RECHECK_MS);
});
test("uses start timestamp plus Android ID to distinguish calls and ID reuse", () => {
  expect(callIdentity({ id: "1", date: 1000, duration: 0, type: 2, number: "123" })).not.toBe(callIdentity({ id: "1", date: 2000, duration: 0, type: 2, number: "123" }));
});
test("prunes only IDs outside the recheck window", () => {
  const now = 1800000000000;
  const state = advanceCallImport({ cursor: now - 60_000, seen: { "1_1000": now - 2 * CALL_RECHECK_MS, "2_2000": now - 10_000 } }, now, []);
  expect(state.cursor).toBe(now); expect(Object.keys(state.seen)).toEqual(["2_2000"]);
});
test("resumes a full Android page without restarting the recheck window", () => {
  const call = { id: "5000", date: 2000, duration: 0, type: 2, number: "123" };
  const state = advanceCallImport({ cursor: 1000, seen: {} }, 9000, Array(5000).fill(call));
  expect(callReadFrom(state, 1000)).toBe(2000);
  const finished = advanceCallImport(state, 9000, []);
  expect(finished.scanFrom).toBeUndefined(); expect(finished.cursor).toBe(9000);
});
test("preserves unreadable state instead of silently resetting and duplicating imports", () => {
  expect(() => parseCallImportState("corrupt", 1000)).toThrow();
  expect(() => parseCallImportState(JSON.stringify({ cursor: 1000, seen: [], scanFrom: -1 }), 1000)).toThrow();
  expect(parseCallImportState(null, 1000)).toEqual({ cursor: 1000, seen: {} });
});
