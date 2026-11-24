/**
 * The Excel imports of Tasks, Meetings and Service requests (2026-11-24) — everything that needs no database:
 * how each kind of cell is read, how a spreadsheet cell becomes text, how headings are matched, and that the
 * sample sheet's own example rows are rows the importer accepts.
 */
import { describe, expect, it } from "vitest";
import { cellText, isDateFormat, serialToIso } from "@/lib/imports/sheet/cell";
import { allowedText, headerKey, matchHeaders, sheetHeader, type SheetSpec } from "@/lib/imports/sheet/spec";
import {
  parseBool, parseDay, parseDayTime, parseEnum, parseInteger, parseList, parseTime, phoneKey, dayToUtcMidnight, istInstant,
} from "@/lib/imports/sheet/values";
import { tasksSpec } from "@/lib/imports/sheet/specs/tasks";
import { meetingsSpec } from "@/lib/imports/sheet/specs/meetings";
import { serviceRequestsSpec } from "@/lib/imports/sheet/specs/service-requests";

const val = <T,>(p: { ok: true; value: T } | { ok: false; error: string }): T | string => (p.ok ? p.value : `ERROR: ${p.error}`);

describe("parseDay — day first, as in India", () => {
  it("reads the ways a date is typed", () => {
    expect(val(parseDay("24-11-2026"))).toBe("2026-11-24");
    expect(val(parseDay("24/11/2026"))).toBe("2026-11-24");
    expect(val(parseDay("24.11.2026"))).toBe("2026-11-24");
    expect(val(parseDay("5/1/2027"))).toBe("2027-01-05"); // 5 January, never 1 May
    expect(val(parseDay("24 Nov 2026"))).toBe("2026-11-24");
    expect(val(parseDay("24-Nov-2026"))).toBe("2026-11-24");
    expect(val(parseDay("3 September 2026"))).toBe("2026-09-03");
    expect(val(parseDay("2026-11-24"))).toBe("2026-11-24");
    expect(val(parseDay("2026-11-24T14:30"))).toBe("2026-11-24");
    expect(val(parseDay("24/11/26"))).toBe("2026-11-24");
  });
  it("reads an Excel serial that arrived as a number", () => {
    expect(val(parseDay("46350"))).toBe("2026-11-24");
  });
  it("refuses what is not a date", () => {
    expect(parseDay("31-02-2026").ok).toBe(false);
    expect(parseDay("13/13/2026").ok).toBe(false);
    expect(parseDay("tomorrow").ok).toBe(false);
    expect(parseDay("").ok).toBe(false);
  });
});

describe("parseTime / parseDayTime", () => {
  it("reads 24-hour and am / pm", () => {
    expect(val(parseTime("14:30"))).toBe("14:30");
    expect(val(parseTime("2:30 pm"))).toBe("14:30");
    expect(val(parseTime("2.30PM"))).toBe("14:30");
    expect(val(parseTime("12:05 am"))).toBe("00:05");
    expect(val(parseTime("12:00 pm"))).toBe("12:00");
    expect(val(parseTime("9:00"))).toBe("09:00");
  });
  it("refuses a time that does not exist", () => {
    expect(parseTime("25:00").ok).toBe(false);
    expect(parseTime("10:75").ok).toBe(false);
    expect(parseTime("13:00 pm").ok).toBe(false);
    expect(parseTime("noon").ok).toBe(false);
  });
  it("splits a date and its optional time", () => {
    expect(val(parseDayTime("24-11-2026 14:30"))).toEqual({ day: "2026-11-24", time: "14:30" });
    expect(val(parseDayTime("2026-11-24T09:05"))).toEqual({ day: "2026-11-24", time: "09:05" });
    expect(val(parseDayTime("24 Nov 2026 3:30 pm"))).toEqual({ day: "2026-11-24", time: "15:30" });
    expect(val(parseDayTime("24 Nov 2026"))).toEqual({ day: "2026-11-24", time: null });
    expect(val(parseDayTime("24-11-2026"))).toEqual({ day: "2026-11-24", time: null });
    expect(parseDayTime("24-11-2026 99:99").ok).toBe(false);
  });
});

describe("the instants a date and time become", () => {
  it("a bare date is stored as the task screen stores it: midnight UTC", () => {
    expect(dayToUtcMidnight("2026-11-24").toISOString()).toBe("2026-11-24T00:00:00.000Z");
  });
  it("a date with a time is India time", () => {
    expect(istInstant("2026-11-24", "14:30").toISOString()).toBe("2026-11-24T09:00:00.000Z");
    expect(istInstant("2026-11-24", "00:00").toISOString()).toBe("2026-11-23T18:30:00.000Z");
  });
});

describe("other cells", () => {
  it("whole numbers", () => {
    expect(val(parseInteger("45", 1, 100))).toBe(45);
    expect(val(parseInteger("1,200", 0, 5000))).toBe(1200);
    expect(val(parseInteger("30.0", 0, 100))).toBe(30);
    expect(parseInteger("30.5", 0, 100).ok).toBe(false);
    expect(parseInteger("abc", 0, 100).ok).toBe(false);
    expect(parseInteger("101", 0, 100).ok).toBe(false);
  });
  it("yes / no", () => {
    for (const y of ["Yes", "y", "TRUE", "1"]) expect(val(parseBool(y))).toBe(true);
    for (const n of ["No", "n", "false", "0", ""]) expect(val(parseBool(n))).toBe(false);
    expect(parseBool("maybe").ok).toBe(false);
  });
  it("a choice by its key or its label, ignoring case, spaces and underscores", () => {
    const opts = [{ value: "in_progress", label: "In progress" }, { value: "open", label: "Open" }];
    expect(val(parseEnum("in_progress", opts))).toBe("in_progress");
    expect(val(parseEnum("In Progress", opts))).toBe("in_progress");
    expect(val(parseEnum("IN-PROGRESS", opts))).toBe("in_progress");
    expect(val(parseEnum(" open ", opts))).toBe("open");
    const bad = parseEnum("later", opts);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("In progress");
  });
  it("lists split on ; and new lines, de-duplicated and capped", () => {
    expect(parseList("a; b;a ;; c\nd")).toEqual(["a", "b", "c", "d"]);
    expect(parseList("one, two")).toEqual(["one, two"]); // a comma is part of a name, not a separator
    expect(parseList("a;b;c;d", 2)).toEqual(["a", "b"]);
    expect(parseList("")).toEqual([]);
  });
  it("a mobile number is matched on its last ten digits", () => {
    expect(phoneKey("+91 98765-43210")).toBe("9876543210");
    expect(phoneKey("09876543210")).toBe("9876543210");
  });
});

describe("a spreadsheet cell becomes text", () => {
  it("a number in a date format is a date, whatever the machine's time zone", () => {
    expect(cellText({ t: "n", v: 46350, z: "dd-mm-yyyy" })).toBe("2026-11-24");
    expect(cellText({ t: "n", v: 46350, z: "m/d/yy" })).toBe("2026-11-24");
    expect(cellText({ t: "n", v: 46350.604166667, z: "dd-mm-yyyy hh:mm" })).toBe("2026-11-24T14:30");
    expect(cellText({ t: "n", v: 0.4375, z: "hh:mm" })).toBe("10:30");
  });
  it("a plain number stays a number, even a mobile number", () => {
    expect(cellText({ t: "n", v: 9876543210, z: "General" })).toBe("9876543210");
    expect(cellText({ t: "n", v: 30, z: "0" })).toBe("30");
    expect(cellText({ t: "n", v: 12.5 })).toBe("12.5");
    expect(cellText({ t: "n", v: 1234567, z: "#,##0" })).toBe("1234567");
    expect(cellText({ t: "n", v: 45, z: '0 "days"' })).toBe("45");
    expect(cellText({ t: "n", v: 1500, z: "[$₹-4009] #,##0" })).toBe("1500");
  });
  it("text is trimmed, and blank, error and empty cells are blank", () => {
    expect(cellText({ t: "s", v: "  hello  " })).toBe("hello");
    expect(cellText({ t: "e", v: 15 })).toBe("");
    expect(cellText(undefined)).toBe("");
    expect(cellText({ t: "s", v: "" })).toBe("");
    expect(cellText({ t: "b", v: true })).toBe("TRUE");
  });
  it("tells a date format from the others", () => {
    for (const z of ["dd-mm-yyyy", "d/m/yy", "hh:mm", "yyyy-mm-dd hh:mm:ss", "[$-409]d-mmm-yy", "[h]:mm"]) expect(isDateFormat(z)).toBe(true);
    for (const z of ["General", "0", "0.00", "#,##0", "0.00%", "0.00E+00", '"Rs" 0', undefined, 14]) expect(isDateFormat(z)).toBe(false);
  });
  it("serial numbers", () => {
    expect(serialToIso(45658)).toBe("2025-01-01");
    expect(serialToIso(46023.999999)).toBe("2026-01-02");
  });
});

const specs: SheetSpec[] = [tasksSpec, meetingsSpec, serviceRequestsSpec];

describe.each(specs.map((s) => [s.label, s] as const))("%s sample sheet", (_name, spec) => {
  it("has unique keys and headings, and at least one required column", () => {
    const keys = spec.columns.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    // No heading or alias may mean two different columns (one column may repeat its own name).
    const owner = new Map<string, string>();
    for (const c of spec.columns) {
      for (const name of [c.header, ...(c.aliases ?? [])]) {
        const k = headerKey(name);
        expect(owner.get(k) ?? c.key, `"${name}" means both ${owner.get(k)} and ${c.key}`).toBe(c.key);
        owner.set(k, c.key);
      }
    }
    expect(spec.columns.some((c) => c.required)).toBe(true);
  });

  it("every choice column lists its allowed values", () => {
    for (const c of spec.columns) if (c.kind === "enum") expect(c.options?.length).toBeGreaterThan(0);
  });

  it("its own headings are all recognised, and nothing required is missing", () => {
    const m = matchHeaders(spec.columns.map(sheetHeader), spec);
    expect(m.missing).toEqual([]);
    expect(m.ignored).toEqual([]);
    expect(Object.values(m.map).sort()).toEqual(spec.columns.map((c) => c.key).sort());
  });

  it("the example rows use only real columns, and fill every required one", () => {
    const keys = new Set(spec.columns.map((c) => c.key));
    for (const ex of spec.examples) {
      for (const k of Object.keys(ex)) expect(keys.has(k), `unknown example column "${k}"`).toBe(true);
      for (const c of spec.columns.filter((x) => x.required)) expect(ex[c.key], `${c.key} missing from an example`).toBeTruthy();
    }
  });

  it("every example cell is one the importer reads", () => {
    for (const ex of spec.examples) {
      for (const c of spec.columns) {
        const v = ex[c.key];
        if (!v) continue;
        let r: { ok: boolean; error?: string } = { ok: true };
        if (c.kind === "date") r = parseDay(v);
        else if (c.kind === "datetime") r = parseDayTime(v);
        else if (c.kind === "time") r = parseTime(v);
        else if (c.kind === "integer") r = parseInteger(v, 0, 100000);
        else if (c.kind === "bool") r = parseBool(v);
        else if (c.kind === "enum") r = parseEnum(v, c.options ?? []);
        expect(r.ok, `${c.header}: “${v}” → ${(r as { error?: string }).error}`).toBe(true);
      }
    }
  });

  it("says what every column takes, for the import page", () => {
    for (const c of spec.columns) {
      expect(allowedText(c).length, `${c.header} has no allowed-values text`).toBeGreaterThan(3);
      expect(c.help.length, `${c.header} has no help`).toBeGreaterThan(5);
      if (c.options?.length) for (const o of c.options) expect(allowedText(c)).toContain(o.label);
    }
  });

  it("requires a heading only for what the importer cannot do without", () => {
    const m = matchHeaders(["Some other column"], spec);
    expect(m.missing.map((c) => c.key)).toEqual(spec.columns.filter((c) => c.required).map((c) => c.key));
    expect(m.ignored).toEqual(["Some other column"]);
  });
});

describe("matching headings", () => {
  it("ignores case, punctuation, the asterisk and the bracketed hint", () => {
    const m = matchHeaders(["TITLE *", "assigned_to", "Due date", "task type", "Estimated Minutes (min)"], tasksSpec);
    expect(m.map).toEqual({ "TITLE *": "title", assigned_to: "assignee", "Due date": "dueAt", "task type": "type", "Estimated Minutes (min)": "estimateMinutes" });
    expect(m.missing).toEqual([]);
  });
  it("accepts a known alias, and reads a heading only once", () => {
    const m = matchHeaders(["Task Name", "Title", "Assignee"], tasksSpec);
    expect(m.map["Task Name"]).toBe("title");
    expect(m.ignored).toEqual(["Title"]); // the second heading for the same column is ignored, not merged
    expect(m.map["Assignee"]).toBe("assignee");
  });
  it("Duration (minutes) and Duration read the same", () => {
    expect(matchHeaders(["Duration"], meetingsSpec).map).toEqual({ Duration: "durationMinutes" });
    expect(matchHeaders(["Duration (minutes)"], meetingsSpec).map).toEqual({ "Duration (minutes)": "durationMinutes" });
  });
  it("Client PAN and Client Name stay two columns", () => {
    const m = matchHeaders(["Client PAN", "Client Name"], serviceRequestsSpec);
    expect(m.map).toEqual({ "Client PAN": "clientPan", "Client Name": "clientName" });
  });
});
