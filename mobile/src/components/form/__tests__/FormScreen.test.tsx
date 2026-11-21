/**
 * FormScreen on a long form: it folds to the sections that need something,
 * a folded section says what it holds and opens on a tap, and a server error
 * on a folded field opens that section.
 */
import React from "react";
import { create, act, type ReactTestRenderer } from "react-test-renderer";

const mockPost = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ back: mockBack, replace: jest.fn(), push: jest.fn() }), useLocalSearchParams: () => ({}) }));
jest.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: undefined, isError: false }), useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));
jest.mock("expo-haptics", () => ({
  selectionAsync: () => Promise.resolve(), impactAsync: () => Promise.resolve(), notificationAsync: () => Promise.resolve(),
  ImpactFeedbackStyle: { Medium: "medium" }, NotificationFeedbackType: { Success: "s", Warning: "w", Error: "e" },
}));
jest.mock("@expo/vector-icons", () => ({ Feather: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@react-native-community/datetimepicker", () => () => null);
jest.mock("../../ui/ScreenHeader", () => ({ ScreenHeader: () => null }));
jest.mock("../../ui/BottomSheet", () => ({ BottomSheet: () => null }));
jest.mock("../../ui/Text", () => {
  const React = require("react");
  return { Text: (p: any) => React.createElement("Text", p, p.children) };
});
jest.mock("../../ui/Button", () => {
  const React = require("react");
  return { Button: (p: any) => React.createElement("Button", p) };
});
jest.mock("../../ui/TextField", () => {
  const React = require("react");
  return { TextField: (p: any) => React.createElement("TextField", p) };
});
jest.mock("../../states", () => ({ LoadingState: () => null, ErrorState: () => null }));
jest.mock("../../../lib/bulkStorage", () => ({ bulkGet: async () => null, bulkSet: async () => {}, bulkDelete: async () => {} }));
jest.mock("../../../lib/offlineQueue", () => ({ queuedPost: jest.fn() }));
jest.mock("../../../state/connectivity", () => ({ useConnectivity: (sel: any) => sel({ online: true }) }));
jest.mock("../../../api/client", () => {
  class ApiError extends Error {
    status: number;
    body: any;
    constructor(code: number, message: string, payload?: any) { super(message); this.status = code; this.body = payload; }
  }
  return { api: { post: (...a: any[]) => mockPost(...a), get: jest.fn(), patch: jest.fn() }, ApiError };
});

import { FormScreen } from "../FormScreen";
import { ApiError } from "../../../api/client";
import type { FormSpec } from "../../../features/forms/types";

(global as any).IS_REACT_ACT_ENVIRONMENT = true;
jest.setTimeout(30_000); // the first render loads React Native's modules

const four = (p: string) => [1, 2, 3, 4].map((n) => ({ key: `${p}${n}`, label: `${p.toUpperCase()} field ${n}` }));
const spec: FormSpec = {
  title: "New thing",
  endpoint: "/api/things",
  submitLabel: "Create",
  initial: { name: "", a1: "x", a2: "", a3: "", a4: "", c1: "", c2: "", c3: "", c4: "", n1: "", n2: "", n3: "", n4: "" },
  validate: (v) => (v.name ? null : { name: "Name is required" }),
  sections: [
    { title: "Identity", fields: [{ key: "name", label: "Name", required: true }, ...four("a")] },
    { title: "Contact", fields: four("c") },
    { title: "Notes", fields: four("n") },
  ],
  buildBody: (v) => ({ name: v.name, c1: v.c1 }),
};

const labels = (r: ReactTestRenderer) => r.root.findAll((n) => (n.type as any) === "TextField").map((n) => n.props.label);
const header = (r: ReactTestRenderer, title: string) => r.root.find((n) => typeof n.props.accessibilityLabel === "string" && n.props.accessibilityLabel.startsWith(title) && typeof n.props.onPress === "function");

describe("FormScreen folding", () => {
  beforeEach(() => mockPost.mockReset());
  afterEach(() => jest.useRealTimers());

  it("opens only what needs filling and summarises the rest", async () => {
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<FormScreen spec={spec} />); });
    expect(labels(r)).toContain("Name");
    expect(labels(r)).not.toContain("C field 1");
    expect(header(r, "Contact").props.accessibilityLabel).toBe("Contact, 0 of 4 filled");
    await act(async () => { header(r, "Contact").props.onPress(); });
    expect(labels(r)).toContain("C field 1");
  });

  it("a server error on a folded field opens its section and marks it", async () => {
    jest.useFakeTimers();
    mockPost.mockRejectedValueOnce(new ApiError(400, "invalid body", { issues: [{ path: ["c1"], message: "Not a valid code" }] }));
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<FormScreen spec={spec} />); });
    const name = r.root.find((n) => (n.type as any) === "TextField" && n.props.label === "Name");
    await act(async () => { name.props.onChangeText("Asha"); });
    const create_ = r.root.find((n) => (n.type as any) === "Button" && n.props.label === "Create");
    await act(async () => { await create_.props.onPress(); });
    await act(async () => { jest.runAllTimers(); });
    expect(mockPost).toHaveBeenCalledWith("/api/things", { name: "Asha", c1: "" });
    const c1 = r.root.find((n) => (n.type as any) === "TextField" && n.props.label === "C field 1");
    expect(c1.props.error).toBe("Not a valid code");
    expect(labels(r)).not.toContain("N field 1");
  });

  it("a short form stays flat", async () => {
    const short: FormSpec = { ...spec, sections: spec.sections!.slice(0, 2) };
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<FormScreen spec={short} />); });
    expect(labels(r)).toEqual(expect.arrayContaining(["Name", "A field 1", "C field 4"]));
  });
});
