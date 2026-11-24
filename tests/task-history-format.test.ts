/**
 * The task Timeline's wording (2026-11-24): the trigger stores `{ column: { from, to } }` and these turn it into
 * what the popup shows — India-time dates, names for ids, and one sentence per action point that changed.
 */
import { describe, expect, it } from "vitest";
import { describeAttachment, describeChanges, describeChecklist, describeComment, formatBytes, formatDue, formatInstant, formatDay, type TimelineLookups } from "@/lib/tasks/history-format";

const lookups: TimelineLookups = {
  users: new Map([["u1", "Hardip Saha"], ["u2", "Urmi Finserve"]]),
  records: new Map([["c1", "Aditya Panchal"]]),
};

describe("dates are read in India time", () => {
  it("a due date at midnight IST shows as a day, whatever the UTC date is", () => {
    // 8 Oct 2026 00:00 IST is 7 Oct 18:30 UTC.
    expect(formatInstant("2026-10-07T18:30:00+00:00")).toBe("8 Oct 2026");
  });
  it("a date with a time shows the time (am / pm, India)", () => {
    expect(formatInstant("2026-12-10T10:00:00+00:00")).toBe("10 Dec 2026, 3:30 pm");
  });
  it("a calendar day is not shifted", () => {
    expect(formatDay("2026-06-17")).toBe("17 Jun 2026");
  });
  it("garbage reads as nothing, not as a crash", () => {
    expect(formatInstant("not a date")).toBeNull();
    expect(formatInstant(42)).toBeNull();
  });
});

describe("a due date is a day, not 5:30 am", () => {
  it("midnight UTC (how the task screen stores a picked day) shows as that day", () => {
    expect(formatDue("2026-06-16T00:00:00+00:00")).toBe("16 Jun 2026");
    expect(formatDue("2026-11-30T00:00:00.000Z")).toBe("30 Nov 2026");
  });
  it("midnight India time still shows as its day", () => {
    expect(formatDue("2026-10-07T18:30:00+00:00")).toBe("8 Oct 2026");
  });
  it("a real time of day keeps its time", () => {
    expect(formatDue("2026-12-10T10:00:00+00:00")).toBe("10 Dec 2026, 3:30 pm");
  });
  it("is what the Due Date and SLA lines use", () => {
    const out = describeChanges({
      due_at: { from: "2026-06-16T00:00:00+00:00", to: "2026-11-30T00:00:00+00:00" },
      sla_due_at: { from: null, to: "2026-06-16T00:00:00+00:00" },
    }, lookups);
    expect(out.map((c) => [c.label, c.from, c.to])).toEqual([
      ["Due Date", "16 Jun 2026", "30 Nov 2026"],
      ["SLA Due Date", null, "16 Jun 2026"],
    ]);
  });
});

describe("describeComment", () => {
  it("an added comment carries its text", () => {
    expect(describeComment("comment_added", { comment: { from: null, to: "test" } })).toEqual([
      { field: "comment", label: "Comment", from: null, to: "test", kind: "comment", action: "added" },
    ]);
  });
  it("an edited comment carries the old and the new text", () => {
    const [c] = describeComment("comment_edited", { comment: { from: "teh client", to: "the client" } });
    expect([c.action, c.from, c.to]).toEqual(["edited", "teh client", "the client"]);
  });
  it("a deleted comment keeps the text that was removed", () => {
    const [c] = describeComment("comment_deleted", { comment: { from: "call back", to: null } });
    expect([c.action, c.from, c.to]).toEqual(["deleted", "call back", null]);
  });
  it("clips a very long comment and survives a missing payload", () => {
    const [c] = describeComment("comment_added", { comment: { from: null, to: "y".repeat(900) } });
    expect(c.to!.length).toBeLessThanOrEqual(400);
    expect(describeComment("comment_added", null)[0]).toMatchObject({ from: null, to: null, action: "added" });
  });
});

describe("describeAttachment", () => {
  const file = { name: "mandate-form.pdf", size: 245760, type: "application/pdf" };
  it("an added file reads name and size", () => {
    expect(describeAttachment("attachment_added", { attachment: { from: null, to: file } })).toEqual([
      { field: "attachment", label: "Attachment", from: null, to: "mandate-form.pdf (240 KB)", kind: "attachment", action: "added" },
    ]);
  });
  it("a removed file keeps the name that was removed", () => {
    const [c] = describeAttachment("attachment_removed", { attachment: { from: file, to: null } });
    expect([c.action, c.from, c.to]).toEqual(["removed", "mandate-form.pdf (240 KB)", null]);
  });
  it("copes with no size, no name and no payload", () => {
    expect(describeAttachment("attachment_added", { attachment: { from: null, to: { name: "a.png" } } })[0].to).toBe("a.png");
    expect(describeAttachment("attachment_added", { attachment: { from: null, to: { size: 10 } } })[0].to).toBe("a file (10 B)");
    expect(describeAttachment("attachment_removed", null)[0]).toMatchObject({ from: null, to: null, action: "removed" });
  });
  it("sizes read in B, KB and MB", () => {
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1048576)).toBe("1 MB");
    expect(formatBytes(1572864)).toBe("1.5 MB");
    expect(formatBytes(null)).toBeNull();
    expect(formatBytes(-5)).toBeNull();
  });
});

describe("describeChanges", () => {
  it("shows from → to with labels the task screen uses", () => {
    const out = describeChanges({
      due_at: { from: "2026-10-07T18:30:00+00:00", to: "2026-12-09T18:30:00+00:00" },
      assignee_id: { from: null, to: "u1" },
    }, lookups);
    expect(out).toEqual([
      { field: "assignee_id", label: "Assigned To", from: null, to: "Hardip Saha", kind: "set" },
      { field: "due_at", label: "Due Date", from: "8 Oct 2026", to: "10 Dec 2026", kind: "set" },
    ]);
  });

  it("puts a status into the words the screen shows", () => {
    const [c] = describeChanges({ status: { from: "in_progress", to: "completed" } }, lookups);
    expect([c.from, c.to]).toEqual(["In Progress", "Completed"]);
  });

  it("names the client and an id that no longer resolves", () => {
    const out = describeChanges({
      related_investor_id: { from: "gone", to: "c1" },
      approved_by: { from: "nobody", to: "u2" },
    }, lookups);
    expect(out.find((c) => c.field === "related_investor_id")).toMatchObject({ label: "Client", from: "a record that is no longer available", to: "Aditya Panchal" });
    expect(out.find((c) => c.field === "approved_by")).toMatchObject({ from: "a removed user", to: "Urmi Finserve" });
  });

  it("a cleared field reads as blank (null), a Yes / No flag as words", () => {
    const out = describeChanges({ sla_due_at: { from: "2026-06-15T18:30:00+00:00", to: null }, requires_approval: { from: false, to: true } }, lookups);
    expect(out.find((c) => c.field === "sla_due_at")).toMatchObject({ from: "16 Jun 2026", to: null });
    expect(out.find((c) => c.field === "requires_approval")).toMatchObject({ from: "No", to: "Yes" });
  });

  it("moving to the Trash and back are events on the whole task", () => {
    const [a] = describeChanges({ deleted_at: { from: null, to: "2026-11-24T06:00:00+00:00" } }, lookups);
    const [b] = describeChanges({ deleted_at: { from: "2026-11-24T06:00:00+00:00", to: null } }, lookups);
    expect(a).toMatchObject({ kind: "event", to: "Moved to Trash" });
    expect(b).toMatchObject({ kind: "event", to: "Restored from Trash" });
  });

  it("drops a change that reads the same on both sides", () => {
    expect(describeChanges({ completed_at: { from: "2026-11-24T06:00:00+00:00", to: "2026-11-24T06:00:20+00:00" } }, lookups)).toEqual([]);
  });

  it("clips a long description instead of filling the popup", () => {
    const [c] = describeChanges({ description: { from: null, to: "x".repeat(600) } }, lookups);
    expect(c.to!.length).toBeLessThanOrEqual(240);
    expect(c.to!.endsWith("…")).toBe(true);
  });

  it("handles no changes at all", () => {
    expect(describeChanges(null, lookups)).toEqual([]);
    expect(describeChanges({}, lookups)).toEqual([]);
  });
});

describe("describeChecklist (action points)", () => {
  const item = (id: string, text: string, extra: Record<string, unknown> = {}) => ({ id, text, done: false, ...extra });

  it("says what was added, removed, finished, reassigned and renamed", () => {
    const from = [item("a", "Call client"), item("b", "Send form"), item("c", "Collect PAN")];
    const to = [
      item("a", "Call the client", { status: "completed", done: true }),
      item("b", "Send form", { assigneeId: "u1" }),
      item("d", "File mandate"),
    ];
    expect(describeChecklist(from, to, lookups)).toEqual([
      "Renamed “Call client” to “Call the client”",
      "“Call the client” marked Completed",
      "“Send form” assigned to Hardip Saha",
      "Added “File mandate”",
      "Removed “Collect PAN”",
    ]);
  });

  it("is empty when nothing about the items changed", () => {
    const same = [item("a", "Call client")];
    expect(describeChecklist(same, same, lookups)).toEqual([]);
    expect(describeChecklist(null, undefined, lookups)).toEqual([]);
  });
});
