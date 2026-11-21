jest.mock("../../../lib/bulkStorage", () => ({ bulkGet: jest.fn(async () => null), bulkSet: jest.fn(async () => {}) }));

import { COLLAPSE_START, nextCollapse, type CollapseState } from "../collapse";
import { hideEmptyByDefault, kanbanColumnWidth, kanbanEndPadding, kanbanIndexAt, visibleKanbanColumns, KANBAN_GAP } from "../kanban";
import { dueUndo, statusMessage, statusUndo } from "../taskUndo";
import { aumLabel, clientSubLine, kycNeedsAttention, panLabel } from "../clientRow";
import { parseSeenHints } from "../swipeHintStore";
import { toast, useToastStore } from "../../../lib/toast";

describe("nextCollapse — the list header hides on scroll down, returns on scroll up", () => {
  const opts = { headerHeight: 150, maxY: 5000 };
  const run = (ys: number[], s: CollapseState = COLLAPSE_START) => ys.reduce((acc, y) => nextCollapse(acc, y, opts), s);

  it("stays shown while the header is still in reach of the top", () => {
    expect(run([20, 80, 150]).hidden).toBe(false);
  });
  it("hides once scrolled down past the header and a little more", () => {
    expect(run([100, 160, 180]).hidden).toBe(false); // 20 past the turning point
    expect(run([100, 160, 200]).hidden).toBe(true); // 40 past it
  });
  it("comes back after a short scroll up, from wherever you are", () => {
    const hidden = run([300, 900, 1400]);
    expect(hidden.hidden).toBe(true);
    expect(nextCollapse(hidden, 1390, opts).hidden).toBe(true); // a jiggle is not a scroll up
    expect(nextCollapse(hidden, 1380, opts).hidden).toBe(false);
  });
  it("hides again after scrolling down from a new low point", () => {
    const shown = run([300, 900, 1400, 1300]);
    expect(shown.hidden).toBe(false);
    expect(nextCollapse(shown, 1320, opts).hidden).toBe(false);
    expect(nextCollapse(nextCollapse(shown, 1320, opts), 1340, opts).hidden).toBe(true);
  });
  it("always shows at the top, including the iOS pull-to-refresh overscroll", () => {
    const hidden = run([300, 900]);
    expect(nextCollapse(hidden, 0, opts).hidden).toBe(false);
    expect(nextCollapse(hidden, -80, opts).hidden).toBe(false);
  });
  it("ignores the bounce past the end of the list", () => {
    const atEnd = run([300, 4000, 5000]);
    expect(atEnd.hidden).toBe(true);
    // iOS reports 5060 then settles back to 5000: not a scroll up.
    expect(nextCollapse(nextCollapse(atEnd, 5060, opts), 5000, opts).hidden).toBe(true);
  });
  it("never hides a list too short to scroll past its header", () => {
    expect([200, 400].reduce((acc, y) => nextCollapse(acc, y, { headerHeight: 150, maxY: 120 }), COLLAPSE_START).hidden).toBe(false);
  });
});

describe("Kanban on a phone", () => {
  it("one column is the board less a peek of the next", () => {
    expect(kanbanColumnWidth(375)).toBe(375 - 32 - 40);
    expect(kanbanColumnWidth(0)).toBe(260); // before the first layout
    expect(kanbanColumnWidth(1024)).toBe(380); // a tablet shows several
  });
  it("the last column can snap to the left edge too", () => {
    const w = kanbanColumnWidth(375);
    expect(kanbanEndPadding(375, w)).toBe(375 - 16 - w);
  });
  it("a resting offset maps to the column it shows", () => {
    const interval = kanbanColumnWidth(375) + KANBAN_GAP;
    expect(kanbanIndexAt(0, interval, 5)).toBe(0);
    expect(kanbanIndexAt(interval * 2 + 10, interval, 5)).toBe(2);
    expect(kanbanIndexAt(interval * 9, interval, 5)).toBe(4);
    expect(kanbanIndexAt(-30, interval, 5)).toBe(0);
  });
  it("hides empty columns by default only on a long board", () => {
    expect(hideEmptyByDefault(5)).toBe(false); // tasks
    expect(hideEmptyByDefault(25)).toBe(true); // client stages
  });
  it("hiding empties never leaves a blank board", () => {
    const cols = [{ key: "a" }, { key: "b" }, { key: "c" }];
    expect(visibleKanbanColumns(cols, { a: 2, b: 0, c: 1 }, true).map((c) => c.key)).toEqual(["a", "c"]);
    expect(visibleKanbanColumns(cols, { a: 2, b: 0, c: 1 }, false)).toHaveLength(3);
    expect(visibleKanbanColumns(cols, {}, true)).toHaveLength(3);
  });
});

describe("task Undo — the previous state, through the same API", () => {
  it("completing undoes to the previous status and trashes the spawned next occurrence", () => {
    expect(statusUndo("in_progress", "completed", { status: "completed", spawnedNextId: "t2" })).toEqual({ body: { status: "in_progress" }, trashId: "t2" });
    expect(statusUndo(null, "completed", { status: "completed" })).toEqual({ body: { status: "open" }, trashId: null });
  });
  it("no Undo when the change only queued offline, or the server sent it for approval instead", () => {
    expect(statusUndo("open", "completed", null)).toBeNull();
    expect(statusUndo("open", "completed", { status: "open" })).toBeNull();
    expect(statusMessage("completed", { status: "open", approvalStatus: "pending" }, "Completed")).toBe("Sent for approval");
  });
  it("a board move undoes to the old column", () => {
    expect(statusUndo("open", "blocked", { status: "blocked", spawnedNextId: "x" })).toEqual({ body: { status: "open" }, trashId: null });
    expect(statusMessage("blocked", { status: "blocked" }, "Blocked")).toBe("Moved to Blocked");
    expect(statusMessage("completed", { status: "completed" }, "Completed")).toBe("Task completed");
  });
  it("snooze undoes to the old due date; a task with none cannot be cleared again", () => {
    expect(dueUndo("2026-11-18T06:00:00Z", { status: "open" })).toEqual({ body: { dueAt: "2026-11-18T06:00:00Z" }, trashId: null });
    expect(dueUndo(null, { status: "open" })).toBeNull();
    expect(dueUndo("2026-11-18T06:00:00Z", null)).toBeNull();
  });
});

describe("client row words", () => {
  it("AUM: a null is not a zero", () => {
    expect(aumLabel(null)).toBe("—");
    expect(aumLabel(undefined)).toBe("—");
    expect(aumLabel("")).toBe("—");
    expect(aumLabel("abc")).toBe("—");
    expect(aumLabel("0")).toBe("₹0");
    expect(aumLabel("12500000")).toBe("₹1.25Cr");
    expect(aumLabel(450000)).toBe("₹4.5L");
  });
  it("PAN: own PAN masked, a server-masked one as sent, else missing", () => {
    expect(panLabel("ABCDE1234F")).toBe("••••••234F");
    expect(panLabel("MINOR:ABCDE1234F")).toBe("••••••234F");
    expect(panLabel("XXXXX••••F")).toBe("XXXXX••••F");
    expect(panLabel(null)).toBe("PAN missing");
    expect(panLabel("NOPAN:1234")).toBe("PAN missing");
  });
  it("KYC flag only when someone has to act", () => {
    for (const s of ["pending", "hold", "rejected", "expired", "re_kyc_required"]) expect(kycNeedsAttention(s)).toBe(true);
    for (const s of ["verified", "registered", null, undefined, "", "unknown"]) expect(kycNeedsAttention(s as any)).toBe(false);
  });
  it("second line: PAN · RM", () => {
    expect(clientSubLine("ABCDE1234F", "Priya Shah")).toBe("••••••234F · RM Priya Shah");
    expect(clientSubLine(null, null)).toBe("PAN missing");
  });
});

describe("swipe hints are remembered per phone", () => {
  it("reads only the flags it knows", () => {
    expect(parseSeenHints(null)).toEqual({});
    expect(parseSeenHints("not json")).toEqual({});
    expect(parseSeenHints(JSON.stringify({ tasks: true, clients: "yes", other: true }))).toEqual({ tasks: true });
  });
});

describe("toast.undo — an action toast, without breaking the plain ones", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    useToastStore.setState({ items: [], action: null });
  });
  afterEach(() => jest.useRealTimers());

  it("plain toasts work as before and never carry an action", () => {
    toast.success("Saved");
    toast.error("Nope");
    expect(useToastStore.getState().items.map((t) => [t.message, t.tone])).toEqual([["Saved", "success"], ["Nope", "danger"]]);
    expect(useToastStore.getState().action).toBeNull();
  });
  it("shows Undo for ~5 s, then goes by itself", () => {
    const undo = jest.fn();
    toast.undo("Task completed", undo);
    expect(useToastStore.getState().action).toMatchObject({ message: "Task completed", actionLabel: "Undo" });
    jest.advanceTimersByTime(4900);
    expect(useToastStore.getState().action).not.toBeNull();
    jest.advanceTimersByTime(200);
    expect(useToastStore.getState().action).toBeNull();
    expect(undo).not.toHaveBeenCalled();
  });
  it("Undo runs once and closes the toast", () => {
    const undo = jest.fn();
    const id = toast.undo("Moved to Blocked", undo);
    useToastStore.getState().runAction(id);
    useToastStore.getState().runAction(id);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(useToastStore.getState().action).toBeNull();
  });
  it("a newer one replaces the old, whose Undo can no longer run", () => {
    const first = jest.fn();
    const second = jest.fn();
    const a = toast.undo("Task completed", first);
    toast.undo("Snoozed to tomorrow", second);
    useToastStore.getState().runAction(a);
    expect(first).not.toHaveBeenCalled();
    // The first one's timer must not close the second early.
    jest.advanceTimersByTime(4900);
    expect(useToastStore.getState().action?.message).toBe("Snoozed to tomorrow");
  });
});
