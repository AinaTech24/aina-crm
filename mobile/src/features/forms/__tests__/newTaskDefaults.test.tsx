/**
 * New task starts on the last type and priority used on this phone (never
 * over a prefilled follow-up's type), shows the client it was opened for, and
 * sends a date-only due exactly as before.
 */
import React from "react";
import { create, act, type ReactTestRenderer } from "react-test-renderer";

const mockPost = jest.fn();
const mockSave = jest.fn();
let mockSaved: any = null;
jest.mock("expo-router", () => ({ useRouter: () => ({ back: jest.fn(), replace: jest.fn(), push: jest.fn() }) }));
jest.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: [] }), useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));
jest.mock("@expo/vector-icons", () => ({ Feather: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@react-native-community/datetimepicker", () => () => null);
jest.mock("../../../components/ui/ScreenHeader", () => ({ ScreenHeader: () => null }));
jest.mock("../../../components/ui/BottomSheet", () => ({ BottomSheet: () => null }));
jest.mock("../../../components/ui/SearchBar", () => ({ SearchBar: () => null }));
jest.mock("../../../components/ui/Chip", () => {
  const React = require("react");
  return { Chip: (p: any) => React.createElement("Chip", p) };
});
jest.mock("../../../components/ui/Text", () => {
  const React = require("react");
  return { Text: (p: any) => React.createElement("Text", p, p.children) };
});
jest.mock("../../../components/ui/Button", () => {
  const React = require("react");
  return { Button: (p: any) => React.createElement("Button", p, p.children) };
});
jest.mock("../../../components/ui/TextField", () => {
  const React = require("react");
  return { TextField: (p: any) => React.createElement("TextField", p, p.children) };
});
jest.mock("../../../components/ui/SelectField", () => {
  const React = require("react");
  return { SelectField: (p: any) => React.createElement("SelectField", p, p.children) };
});
jest.mock("../../../components/ui/Segmented", () => {
  const React = require("react");
  return { Segmented: (p: any) => React.createElement("Segmented", p, p.children) };
});
jest.mock("../../../api/me", () => ({ useMe: () => ({ data: { user: { id: "u1" }, license: { featureFlags: {} } }, isFetched: true }) }));
jest.mock("../../team/api", () => ({ useTeam: () => ({ data: { rows: [] } }) }));
jest.mock("../../meetings/api", () => ({ useMeetings: () => ({ data: { meetings: [] } }) }));
jest.mock("../../search/api", () => ({ useSearch: () => ({ data: null }) }));
jest.mock("../../proposals/api", () => ({ useSchemeSearch: () => ({ data: null }) }));
jest.mock("../../../lib/toast", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../../../api/client", () => ({ api: { get: jest.fn(() => new Promise(() => {})), post: (...a: any[]) => mockPost(...a) } }));
jest.mock("../../../lib/bulkStorage", () => ({ bulkGet: async () => null, bulkSet: async () => {}, bulkDelete: async () => {} }));
jest.mock("../task-prefs", () => {
  const real = jest.requireActual("../task-prefs");
  return { ...real, loadTaskPrefs: async () => mockSaved, saveTaskPrefs: (p: any) => mockSave(p) };
});

import { NewTaskScreen } from "../../tasks/NewTaskScreen";

(global as any).IS_REACT_ACT_ENVIRONMENT = true;
jest.setTimeout(30_000);

/** "When & who" is folded: its one-line summary carries the priority. */
const whenLine = (r: ReactTestRenderer) => r.root.find((n) => typeof n.props.accessibilityLabel === "string" && n.props.accessibilityLabel.startsWith("When & who") && typeof n.props.onPress === "function").props.accessibilityLabel as string;
const find = (r: ReactTestRenderer, type: string, label: string) => r.root.find((n) => (n.type as any) === type && n.props.label === label);
const render = async (params: Record<string, string> = {}) => {
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<NewTaskScreen params={params} />); });
  await act(async () => {});
  return r;
};

describe("New task defaults", () => {
  beforeEach(() => { mockPost.mockReset(); mockSave.mockReset(); });

  it("starts on the last request and priority used", async () => {
    mockSaved = { type: "redemption", priority: "high" };
    const r = await render();
    expect(find(r, "SelectField", "Financial request").props.value).toBe("redemption");
    expect(whenLine(r)).toMatch(/· Me · High$/);
  });

  it("keeps a prefilled follow-up a follow-up — only the priority comes back", async () => {
    mockSaved = { type: "redemption", priority: "urgent" };
    const r = await render({ title: "Follow up with Asha", relatedInvestorId: "i1", name: "Asha Patel" });
    expect(r.root.findAll((n) => (n.type as any) === "SelectField" && n.props.label === "Financial request")).toHaveLength(0);
    expect(whenLine(r)).toMatch(/· Urgent$/);
    // The client it was opened for, by name, without a lookup.
    expect(r.root.findAll((n) => (n.type as any) === "Text" && n.props.children === "Asha Patel").length).toBeGreaterThan(0);
  });

  it("sends a date-only due as before and remembers the type used", async () => {
    mockSaved = null;
    mockPost.mockResolvedValueOnce({ id: "t1" });
    const r = await render();
    await act(async () => { find(r, "TextField", "What needs doing").props.onChangeText("Call the client"); });
    await act(async () => { await find(r, "Button", "Create task").props.onPress(); });
    const [, body] = mockPost.mock.calls[0];
    expect(body.type).toBe("follow_up");
    expect(body.dueAt).toMatch(/T00:00:00\.000Z$/);
    expect(mockSave).toHaveBeenCalledWith({ type: "follow_up", priority: "normal" });
  });
});
