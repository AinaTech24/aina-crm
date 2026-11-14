/**
 * Edit a task — what the live CRM's task page saves (web TaskDetailDrawer →
 * PATCH /api/tasks/[id]): title, description, priority, assignee, entry date,
 * due date and SLA due. The PATCH has no type or recurrence, and it never
 * takes the old remarks (comments have their own endpoint), so neither is
 * offered here. Creating a task is NewTaskScreen (request types, scheme rows).
 */

import type { FormSpec } from "./types";

const day = (v: unknown) => (v ? String(v).slice(0, 10) : "");

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
    entryDate: day(r.entryDate),
    dueDate: day(r.dueAt),
    slaDueDate: day(r.slaDueAt),
  }),

  validate: (v) => (v.title?.trim() ? null : { title: "Say what needs doing." }),

  sections: [
    {
      fields: [
        { key: "title", label: "What needs doing", required: true },
        { key: "description", label: "Description", type: "textarea" },
        { key: "priority", label: "Priority", type: "select", options: [{ value: "low", label: "Low" }, { value: "normal", label: "Normal" }, { value: "high", label: "High" }, { value: "urgent", label: "Urgent" }] },
        {
          key: "assigneeId", label: "Assigned to", type: "lookup", lookupEndpoint: "/api/employees", lookupEnvelope: "rows",
          lookupLabel: (e) => e.name + (Array.isArray(e.roles) && e.roles.length ? ` · ${e.roles[0]}` : ""),
        },
        { key: "entryDate", label: "Entry date", type: "date" },
        { key: "dueDate", label: "Due date", type: "date" },
        { key: "slaDueDate", label: "SLA due (blank = none)", type: "date" },
      ],
    },
  ],

  buildBody: (f) => ({
    title: f.title.trim(),
    description: f.description || undefined,
    priority: f.priority,
    assigneeId: f.assigneeId || undefined,
    entryDate: f.entryDate || undefined,
    dueAt: f.dueDate ? new Date(f.dueDate).toISOString() : undefined,
    // A cleared SLA date clears the SLA (null), as on the web.
    slaDueAt: f.slaDueDate ? new Date(f.slaDueDate).toISOString() : null,
  }),

  redirect: () => null,
};
