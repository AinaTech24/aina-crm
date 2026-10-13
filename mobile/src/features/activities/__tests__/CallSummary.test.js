import React from "react";
import { create, act } from "react-test-renderer";
import { Switch } from "react-native";
const mockDisk = new Map(), mockPick = jest.fn(), mockGenerate = jest.fn(), mockGet = jest.fn(), mockPatch = jest.fn();
const mockInvalidate = jest.fn(async () => {}), mockPush = jest.fn();
let mockReadiness = { ready: true, safeNotesSave: true, message: "Configured" };
jest.mock("expo-document-picker", () => ({ getDocumentAsync: (...args) => mockPick(...args) }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: mockReadiness }), useQueryClient: () => ({ invalidateQueries: mockInvalidate }) }));
jest.mock("../../../components/ui", () => {
  const React = require("react");
  return Object.fromEntries(["Card", "Text", "Button", "TextField", "SelectField"].map(name => [name, props => React.createElement(name, props, props.children)]));
});
jest.mock("../../../api/client", () => ({
  api: { get: (...args) => mockGet(...args), patch: (...args) => mockPatch(...args) }, apiRequest: (...args) => mockGenerate(...args),
  ApiError: class extends Error { constructor(status, message, body, kind = "http") { super(message); this.status = status; this.body = body; this.kind = kind; } },
}));
jest.mock("../../../lib/bulkStorage", () => ({ bulkGet: async key => mockDisk.get(key) ?? null, bulkSet: async (key, value) => { mockDisk.set(key, value); }, bulkDelete: async key => { mockDisk.delete(key); } }));
jest.mock("../../../lib/toast", () => ({ toast: { success: jest.fn(), info: jest.fn() } }));
import { ApiError } from "../../../api/client";
import { setAccountScope } from "../../../lib/accountScope";
import { CallSummary } from "../CallSummary";

global.IS_REACT_ACT_ENVIRONMENT = true;
// Network transport is mocked in this controller test. Avoid loading Expo's
// native multipart transport just to construct a payload for the mock.
const formDataDescriptor = Object.getOwnPropertyDescriptor(global, "FormData");
beforeAll(() => Object.defineProperty(global, "FormData", { configurable: true, writable: true, value: class { constructor() { this.entries = []; } append(key, value) { this.entries.push([key, value]); } } }));
afterAll(() => { if (formDataDescriptor) Object.defineProperty(global, "FormData", formDataDescriptor); });
let renderer;
const id = "call-a", draftKey = `form_draft_v1.tenant.user.call_summary.${id}`;
const props = { activityId: id, existingNotes: "Old note", subjectType: "lead", subjectId: "lead-a", name: "Client" };
const button = label => renderer.root.findAllByType("Button").find(node => node.props.label === label);
const field = () => renderer.root.findByType("TextField");
const mount = async () => { await act(async () => { renderer = create(<CallSummary {...props} />); }); };
beforeEach(() => {
  jest.clearAllMocks(); mockDisk.clear(); setAccountScope(null); setAccountScope("tenant.user");
  mockReadiness = { ready: true, safeNotesSave: true, message: "Configured" };
  mockPick.mockResolvedValue({ canceled: false, assets: [{ uri: "file://call.m4a", name: "client-call.m4a", mimeType: "audio/mp4", size: 500 }] });
  mockGenerate.mockResolvedValue({ summary: { discussion: "Review SIP ₹5,000", requirements: "Not discussed", products: "Mutual funds", objections: "Not discussed", nextSteps: "Arrange review" } });
  mockGet.mockResolvedValue({ notes: "Latest colleague note" }); mockPatch.mockResolvedValue({});
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; });

test("choosing a recording does not upload it until participant agreement is confirmed", async () => {
  await mount();
  await act(async () => button("Choose call recording").props.onPress());
  expect(button("Generate English summary").props.disabled).toBe(true);
  await act(async () => button("Generate English summary").props.onPress());
  expect(mockGenerate).not.toHaveBeenCalled();
  await act(async () => renderer.root.findByType(Switch).props.onValueChange(true));
  await act(async () => button("Generate English summary").props.onPress());
  expect(mockGenerate).toHaveBeenCalledTimes(1); expect(field().props.value).toContain("₹5,000");
  expect(mockGenerate.mock.calls[0][1].form.entries).toContainEqual(["participantConsent", "confirmed"]);
  expect(JSON.parse(mockDisk.get(draftKey)).text).toContain("₹5,000");
}, 30000); // Cold native-component initialization can exceed Jest's 5s default on Windows.
test("restores a review draft and keeps a failed save without enabling a follow-up action", async () => {
  mockDisk.set(draftKey, JSON.stringify({ text: "Reviewed discussion", recordingName: "client-call.m4a", speechLanguage: "gu" }));
  mockPatch.mockRejectedValueOnce(new ApiError(409, "Notes changed"));
  await mount(); await act(async () => button("Save reviewed summary").props.onPress());
  expect(field().props.value).toBe("Reviewed discussion");
  expect(button("Create follow-up from saved summary")).toBeUndefined();
  expect(mockDisk.has(draftKey)).toBe(true);
});
test("merges with fresh notes and passes their snapshot before clearing a confirmed draft", async () => {
  mockDisk.set(draftKey, JSON.stringify({ text: "Reviewed discussion" }));
  await mount(); await act(async () => button("Save reviewed summary").props.onPress());
  expect(mockPatch.mock.calls[0][1]).toEqual({ notes: "Latest colleague note\n\nReviewed English call summary:\nReviewed discussion", expectedNotes: "Latest colleague note" });
  expect(button("Create follow-up from saved summary")).toBeDefined();
  expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ["activity", id] });
});
test("retries an uncertain save with the same identity and locks the pending text", async () => {
  mockDisk.set(draftKey, JSON.stringify({ text: "Reviewed discussion" }));
  mockPatch.mockRejectedValueOnce(new ApiError(0, "Timed out", null, "timeout"));
  await mount(); await act(async () => button("Save reviewed summary").props.onPress());
  expect(field().props.disabled).toBe(true);
  await act(async () => button("Retry saving reviewed summary").props.onPress());
  expect(mockGet).toHaveBeenCalledTimes(1);
  expect(mockPatch.mock.calls[0]).toEqual(mockPatch.mock.calls[1]);
});
test("an older server cannot silently ignore the notes conflict guard", async () => {
  mockReadiness = { ready: true, message: "Older service" };
  mockDisk.set(draftKey, JSON.stringify({ text: "Reviewed discussion" }));
  await mount(); await act(async () => button("Save reviewed summary").props.onPress());
  expect(mockPatch).not.toHaveBeenCalled(); expect(mockGet).not.toHaveBeenCalled();
  expect(field().props.value).toBe("Reviewed discussion");
});
