import { e, graph, n, and, p } from "./_helpers";
import type { RecipeDef } from ".";

export const mandateExpiryRecipe: RecipeDef = {
  key: "mandate_expiry_t90_t60_t30",
  name: "Mandate expiry T-90 / T-60 / T-30 reminders",
  description:
    "NACH mandates expire after 5 years. This workflow runs nightly, finds investors whose mandate is expiring soon, and nudges them progressively (WA at T-90 and T-60, WA + email + RM task at T-30).",
  category: "operations",
  tags: ["mandate", "nach", "renewal"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", {}),
      n("branch", "branch", {
        cases: [
          { label: "T-30", criteria: and(p({ kind: "computed", key: "days_to_review" } as any, "lte", 30)) },
          { label: "T-60", criteria: and(p("event.days_to_expiry", "lte", 60)) },
          { label: "T-90", criteria: and(p("event.days_to_expiry", "lte", 90)) },
        ],
      }),
      n("wa_t30", "send_whatsapp", {
        templateKey: "mandate_expiry_30",
        variables: { name: "subject.name", date: "event.expires_at" },
        category: "utility",
      }),
      n("email_t30", "send_email", {
        templateKey: "mandate_expiry_30_email",
        variables: { name: "subject.name", date: "event.expires_at" },
        category: "transactional",
      }),
      n("task_t30", "create_task", {
        title: "NACH mandate expiring in 30 days for {{subject.name}}",
        type: "mandate_renewal",
        priority: "high",
        assignee: "subject.rm_id",
        dueAfter: { amount: 7, unit: "day" },
      }),
      n("wa_t60", "send_whatsapp", {
        templateKey: "mandate_expiry_60",
        variables: { name: "subject.name", date: "event.expires_at" },
        category: "utility",
      }),
      n("wa_t90", "send_whatsapp", {
        templateKey: "mandate_expiry_90",
        variables: { name: "subject.name", date: "event.expires_at" },
        category: "utility",
      }),
      n("end", "end", {}),
    ],
    edges: [
      e("e0", "trigger", "branch"),
      e("e1", "branch", "wa_t30", "case_0"),
      e("e2", "wa_t30", "email_t30"),
      e("e3", "email_t30", "task_t30"),
      e("e4", "task_t30", "end"),
      e("e5", "branch", "wa_t60", "case_1"),
      e("e6", "wa_t60", "end"),
      e("e7", "branch", "wa_t90", "case_2"),
      e("e8", "wa_t90", "end"),
      e("e9", "branch", "end", "default"),
    ],
  }),
};
