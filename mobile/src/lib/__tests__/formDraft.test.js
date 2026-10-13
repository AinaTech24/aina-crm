import React from "react";
import { create, act } from "react-test-renderer";
jest.mock("../bulkStorage", () => ({ bulkGet: jest.fn(), bulkSet: jest.fn(), bulkDelete: jest.fn() }));
import { bulkGet, bulkSet, bulkDelete } from "../bulkStorage";
import { setAccountScope } from "../accountScope";
import { useFormDraft } from "../useFormDraft";

global.IS_REACT_ACT_ENVIRONMENT = true;
const disk = new Map();
let current, renderer;
function Form() { current = useFormDraft("lead", () => ({ name: "" }), true); return null; }
beforeEach(() => {
  jest.clearAllMocks(); disk.clear(); setAccountScope(null); setAccountScope("tenant.a");
  bulkGet.mockImplementation(async key => disk.get(key) ?? null);
  bulkSet.mockImplementation(async (key, value) => { disk.set(key, value); });
  bulkDelete.mockImplementation(async key => { disk.delete(key); });
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; });
test("restores a draft after an interrupted form without sharing it with another account", async () => {
  await act(async () => { renderer = create(<Form />); });
  await act(async () => { current.setValue({ name: "Pending lead" }); });
  await act(async () => renderer.unmount());
  await act(async () => { renderer = create(<Form />); });
  expect(current.value.name).toBe("Pending lead");
  await act(async () => renderer.unmount());
  setAccountScope("tenant.b");
  await act(async () => { renderer = create(<Form />); });
  expect(current.value.name).toBe("");
});
test("clears after an outstanding save so a submitted draft cannot reappear", async () => {
  await act(async () => { renderer = create(<Form />); });
  let finish;
  bulkSet.mockImplementationOnce((key, value) => new Promise(resolve => { finish = () => { disk.set(key, value); resolve(); }; }));
  await act(async () => current.setValue({ name: "Submitted lead" }));
  let clear;
  await act(async () => { clear = current.clear(); finish(); await clear; });
  expect(disk.size).toBe(0);
});
test("does not overwrite an unreadable existing draft", async () => {
  disk.set("form_draft_v1.tenant.a.lead", "corrupt");
  await act(async () => { renderer = create(<Form />); });
  await act(async () => current.setValue({ name: "New text" }));
  expect(bulkSet).not.toHaveBeenCalled();
  expect(current.status).toContain("Existing draft preserved");
});

test("does not restore a submitted draft when removal fails after its tombstone is saved", async () => {
  await act(async () => { renderer = create(<Form />); });
  await act(async () => current.setValue({ name: "Already submitted" }));
  bulkDelete.mockRejectedValueOnce(new Error("Storage unavailable"));
  await act(async () => { await expect(current.clear()).rejects.toThrow(); });
  await act(async () => renderer.unmount());
  await act(async () => { renderer = create(<Form />); });
  expect(current.value.name).toBe("");
});
