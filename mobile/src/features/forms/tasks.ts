/**
 * Edit a task — what the live CRM's task page saves (web TaskDetailDrawer →
 * PATCH /api/tasks/[id]): title, description, priority, assignee, entry date,
 * due date and SLA due. The PATCH has no type or recurrence, and it never
 * takes the old remarks (comments have their own endpoint), so neither is
 * offered here. Creating a task is NewTaskScreen (request types, scheme rows).
 *
 * Dates are India days. A due stored as 18:30Z is the NEXT day in India, so the
 * picker shows the IST day (slicing the ISO string showed the day before and a
 * save moved the task back a day). An unchanged day is not sent — the task
 * keeps its time (a follow-up due 10:00 IST stays at 10:00) — and a moved day
 * keeps the task's time of day.
 */

import type { FormSpec } from "./types";
import { istToIso, splitDue } from "../../components/form/due";

const IST_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** The India calendar day of a stored timestamp ("" when none). */
export function istDay(v: unknown): string {
  if (!v) return "";
  const t = new Date(String(v)).getTime();
  if (isNaN(t)) return /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : "";
  return new Date(t + IST_MS).toISOString().slice(0, 10);
}

/** `day` at the original timestamp's India time of day; with none, UTC midnight (the web's `new Date(day)`). */
export function onIstDay(day: string, original?: unknown): string {
  const base = Date.parse(`${day}T00:00:00Z`);
  const orig = original ? new Date(String(original)).getTime() : NaN;
  if (isNaN(orig)) return new Date(base).toISOString();
  const intoIstDay = (((orig + IST_MS) % DAY_MS) + DAY_MS) % DAY_MS;
  return new Date(base - IST_MS + intoIstDay).toISOString();
}

export const taskForm: FormSpec = {
  title: "New task",
  editTitle: "Edit task",
  endpoint: "/api/tasks",
  submitLabel: "Save",
  invalidate: ["tasks", "task", "task-kpis"],

  initial: { title: "", description: "", priority: "normal", assigneeId: "", entryDate: "", dueDate: "", slaDueDate: "" },

  editInitial: (r) => ({
    title: r.title ?? "",
    description: r.description ?? "",
    priority: r.priority ?? "normal",
    assigneeId: r.assigneeId ?? "",
    entryDate: r.entryDate ? String(r.entryDate).slice(0, 10) : "",
    dueDate: istDay(r.dueAt),
    slaDueDate: istDay(r.slaDueAt),
    // What the task carries now — an unchanged day is left alone.
    _dueAt: r.dueAt ?? null,
    _slaDueAt: r.slaDueAt ?? null,
  }),

  // The PATCH takes a title of 2+ characters.
  validate: (v) => (String(v.title ?? "").trim().length >= 2 ? null : { title: "Say what needs doing." }),

  sections: [
    {
      fields: [
        { key: "title", label: "What needs doing", required: true },
        { key: "description", label: "Description", type: "textarea" },
        { key: "priority", label: "Priority", type: "select", options: [{ value: "low", label: "Low" }, { value: "normal", label: "Normal" }, { value: "high", label: "High" }, { value: "urgent", label: "Urgent" }] },
        {
          key: "assigneeId", label: "Assigned to", type: "lookup", lookupEndpoint: "/api/employees", lookupEnvelope: "rows",
          lookupLabel: (e) => e.name + (Array.isArray(e.roles) && e.roles.length ? ` · ${e.roles[0]}` : ""),
          lookupFilter: (e) => (e.status ?? "active") === "active",
        },
        { key: "entryDate", label: "Entry date", type: "date" },
        // Quick chips (Today 5 pm / Tomorrow 10 am) carry their India time; a day from the calendar keeps the task's.
        { key: "dueDate", label: "Due date", type: "due" },
        { key: "slaDueDate", label: "SLA due (blank = none)", type: "date" },
      ],
    },
  ],

  buildBody: (f) => {
    const dueChanged = !!f.dueDate && f.dueDate !== istDay(f._dueAt);
    const due = splitDue(f.dueDate);
    const slaChanged = (f.slaDueDate || "") !== istDay(f._slaDueAt);
    return {
      title: String(f.title).trim(),
      description: f.description || undefined,
      priority: f.priority,
      assigneeId: f.assigneeId || undefined,
      entryDate: f.entryDate || undefined,
      ...(dueChanged ? { dueAt: due.time ? istToIso(f.dueDate) : onIstDay(due.day, f._dueAt) } : {}),
      // A cleared SLA date clears the SLA (null), as on the web; an untouched one is left be.
      ...(slaChanged ? { slaDueAt: f.slaDueDate ? onIstDay(f.slaDueDate, f._slaDueAt) : null } : {}),
    };
  },

  redirect: () => null,
};
