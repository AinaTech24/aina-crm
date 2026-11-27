/**
 * When a task is due (2026-11-27): overdue only once its due DATE has ended in India, and reminders
 * worked out from a date with no time go at 10:00 am.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isPastDue, reminderInstant, startOfTodayIst, workingDayStarted } from "@/lib/tasks/due";

const due30 = "2026-11-30T00:00:00.000Z"; // a date picked with no time
const ist = (s: string) => new Date(`${s}+05:30`);

describe("overdue only after the due date has ended", () => {
  it("is not overdue at any time on the due date", () => {
    for (const at of ["2026-11-30T00:00:00", "2026-11-30T05:31:00", "2026-11-30T23:59:59"]) {
      expect(isPastDue(due30, ist(at))).toBe(false);
    }
  });

  it("is overdue from midnight India time", () => {
    expect(isPastDue(due30, ist("2026-12-01T00:00:00"))).toBe(true);
    expect(isPastDue(null, ist("2026-12-01T00:00:00"))).toBe(false);
  });

  it("treats a due with its own time the same way: the date decides", () => {
    expect(isPastDue("2026-11-30T05:00:00.000Z", ist("2026-11-30T18:00:00"))).toBe(false);
    expect(startOfTodayIst(ist("2026-11-30T03:00:00")).toISOString()).toBe("2026-11-29T18:30:00.000Z");
  });
});

describe("reminders at the working hour", () => {
  const at = (mins: number) => reminderInstant(due30, mins).toISOString();

  it("counts a date-only due from 10:00 am India", () => {
    expect(at(0)).toBe(ist("2026-11-30T10:00:00").toISOString());
    expect(at(60)).toBe(ist("2026-11-30T09:00:00").toISOString());
    expect(at(1440)).toBe(ist("2026-11-29T10:00:00").toISOString());
    expect(at(10080)).toBe(ist("2026-11-23T10:00:00").toISOString());
  });

  it("keeps a due that has its own time", () => {
    expect(reminderInstant("2026-11-30T09:00:00.000Z", 60).toISOString()).toBe("2026-11-30T08:00:00.000Z");
  });

  it("holds alerts about lateness until 10:00 am", () => {
    expect(workingDayStarted(ist("2026-12-01T09:59:00"))).toBe(false);
    expect(workingDayStarted(ist("2026-12-01T10:00:00"))).toBe(true);
  });
});

describe("the one rule is the one used", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("in the shared overdue definition, the Today tab and the scanner", () => {
    expect(read("src/lib/metrics/tasks.ts")).toContain("< ${TASK_TODAY_START}");
    expect(read("src/app/dashboard/tasks/page.tsx")).toContain("today: and(isOpen, sql`${DUE_DAY} = ${IST_TODAY}`),");
    const scanner = read("src/workers/task-reminder-scanner.ts");
    expect(scanner).toContain("${TASK_OVERDUE_ALERT_BEFORE}");
    expect(scanner).toContain("if (workingDayStarted()) escalations +=");
  });

  it("on the web forms", () => {
    for (const p of ["src/app/dashboard/tasks/new/page.tsx", "src/app/dashboard/tasks/TaskDetailDrawer.tsx"]) {
      expect(read(p)).toContain("reminderInstant(");
      expect(read(p)).toContain("On the due date, 10:00 am");
    }
  });
});
