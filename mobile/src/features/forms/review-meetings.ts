/**
 * Review-meeting create form — field-for-field parity with the web
 * ScheduleMeetingForm (/dashboard/review-meetings/new). Same Client|Lead|Family
 * subject toggle, same meeting-type / mode / duration / status / RM fields, same
 * date+time → ISO meetingDate combine, same POST body to /api/review-meetings.
 *
 * Web nuance preserved:
 *  - The subject picker swaps by `subjectKind`. Exactly one of investorId /
 *    leadId is sent (the API enforces the XOR). A FAMILY meeting attaches to the
 *    family's PRIMARY investor + the familyId and is forced to category "review"
 *    — the web resolves the primary investor from its in-memory family list, so
 *    the family search here encodes "<familyId>:<primaryInvestorId>" as its value
 *    and buildBody splits it back apart. GET /api/families returns raw rows
 *    (snake_case: family_name, head_name, primary_investor_id) 50 at a time, so
 *    it is searched, not listed — the camelCase lookup it replaced labelled every
 *    family "Family" and sent no investorId, so the POST failed its XOR check.
 *  - meetingType is derived from category via TYPE_FOR_CATEGORY.
 *  - The web pushes to the review-meetings LIST after create → no detail redirect.
 */

import type { FormSpec } from "./types";

// 15-minute time slots across the day, labelled 12-hour (mirrors TIME_SLOTS).
const TIME_SLOTS: Array<{ value: string; label: string }> = (() => {
  const out: Array<{ value: string; label: string }> = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 15, 30, 45]) {
      const hh = String(h).padStart(2, "0");
      const mm = String(m).padStart(2, "0");
      const ampm = h < 12 ? "AM" : "PM";
      const h12 = h % 12 === 0 ? 12 : h % 12;
      out.push({ value: `${hh}:${mm}`, label: `${h12}:${mm} ${ampm}` });
    }
  }
  return out;
})();

const TYPE_FOR_CATEGORY: Record<string, string> = {
  new: "new_investment_discussion",
  review: "portfolio_review",
  follow_up: "follow_up_call",
};

// Tomorrow at 11:00, skipping weekends (mirrors defaultDateTimeParts).
function defaultDateTimeParts(): { day: string; time: string } {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  if (d.getDay() === 6) d.setDate(d.getDate() + 2);
  else if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: "11:00" };
}

export const reviewMeetingForm: FormSpec = {
  title: "Schedule review meeting",
  endpoint: "/api/review-meetings",
  submitLabel: "Schedule meeting",
  // The meetings list is ["meetings", …]; the meeting also lands on the calendar and in a reminder task.
  invalidate: ["meetings", "calendar", "tasks", "task-kpis", "command-center"],

  initial: (params) => {
    const def = defaultDateTimeParts();
    return {
      subjectKind: params.leadId ? "lead" : "client",
      investorId: params.investorId ?? "",
      leadId: params.leadId ?? "",
      familyId: "", // encodes "<familyId>:<primaryInvestorId>"
      subject: "",
      category: ["new", "review", "follow_up"].includes(params.category ?? "") ? params.category! : "review",
      meetingDay: def.day,
      meetingTime: def.time,
      durationMinutes: "30",
      meetingMode: "online",
      locationOrLink: "",
      discussionPoints: "",
      rmId: "",
      coAttendeeIds: [],
      status: "scheduled",
    };
  },

  // Only the chosen subject's picker shows (web: Client / Lead / Family tabs);
  // a family meeting is always a review.
  derive: (v) => (v.subjectKind === "family" && v.category !== "review" ? { category: "review" } : null),

  validate: (v) => {
    const e: Record<string, string> = {};
    if (!v.meetingDay) e.meetingDay = "Date is required";
    if (!v.meetingTime) e.meetingTime = "Time is required";
    if (v.subjectKind === "client" && !v.investorId) e.investorId = "Pick a client";
    else if (v.subjectKind === "lead" && !v.leadId) e.leadId = "Pick a lead";
    else if (v.subjectKind === "family" && !v.familyId) e.familyId = "Pick a family";
    else if (v.subjectKind === "family" && !String(v.familyId).split(":")[1]) e.familyId = "This family has no head client yet — set one in Families first.";
    return Object.keys(e).length ? e : null;
  },

  sections: [
    {
      title: "Meeting details",
      fields: [
        { key: "subject", label: "Subject" },
        {
          key: "subjectKind",
          label: "Who is the meeting with?",
          type: "select",
          options: [
            { value: "client", label: "Client" },
            { value: "lead", label: "Lead" },
            { value: "family", label: "Family" },
          ],
        },
        {
          key: "investorId",
          label: "Client",
          type: "typeahead",
          searchEndpoint: "/api/search",
          searchEnvelope: "investors",
          searchLabel: (i) => i.name,
          searchSublabel: (i) => [i.pan_display, i.segment_tag].filter(Boolean).join(" · "),
          placeholder: "Search a client by name or PAN…",
          visibleIf: (v) => v.subjectKind === "client",
        },
        {
          key: "leadId",
          label: "Lead",
          type: "typeahead",
          searchEndpoint: "/api/search",
          searchEnvelope: "leads",
          searchLabel: (l) => l.name,
          searchSublabel: (l) => [l.phone, l.stage ? String(l.stage).replace(/_/g, " ") : ""].filter(Boolean).join(" · "),
          placeholder: "Search a lead by name or phone…",
          visibleIf: (v) => v.subjectKind === "lead",
        },
        {
          key: "familyId",
          label: "Family",
          type: "typeahead",
          searchEndpoint: "/api/families",
          searchEnvelope: "families",
          searchParam: "q",
          searchExtraParams: { limit: "20" },
          searchValue: (f) => `${f.id}:${f.primary_investor_id ?? f.primaryInvestorId ?? ""}`,
          searchLabel: (f) => f.family_name ?? f.familyName ?? f.head_name ?? f.headName ?? "Family",
          searchSublabel: (f) => [
            f.head_name ?? f.headName ? `Head: ${f.head_name ?? f.headName}` : null,
            f.member_count != null ? `${f.member_count} member${Number(f.member_count) === 1 ? "" : "s"}` : null,
            (f.primary_investor_id ?? f.primaryInvestorId) ? null : "no head client",
          ].filter(Boolean).join(" · "),
          placeholder: "Search a family group…",
          visibleIf: (v) => v.subjectKind === "family",
        },
        {
          key: "category",
          label: "Meeting type",
          type: "select",
          // A family meeting is a review (web ScheduleMeetingForm).
          visibleIf: (v) => v.subjectKind !== "family",
          options: [
            { value: "new", label: "New Meeting" },
            { value: "review", label: "Review Meeting" },
            { value: "follow_up", label: "Follow-up Meeting" },
          ],
        },
        {
          key: "meetingMode",
          label: "Mode",
          type: "select",
          options: [
            { value: "office", label: "Office" },
            { value: "client_place", label: "Client Place" },
            { value: "online", label: "Online" },
            { value: "phone", label: "Phone" },
          ],
        },
        { key: "meetingDay", label: "Date", type: "date" },
        { key: "meetingTime", label: "Time", type: "select", options: TIME_SLOTS },
        { key: "durationMinutes", label: "Duration (minutes)", type: "number" },
        {
          key: "status",
          label: "Initial status",
          type: "select",
          options: [
            { value: "scheduled", label: "Scheduled" },
            { value: "confirmed", label: "Confirmed" },
          ],
        },
        {
          key: "rmId",
          label: "Assigned RM",
          type: "lookup",
          lookupEndpoint: "/api/employees?role=rm",
          lookupEnvelope: "rows",
          lookupLabel: (e) => e.name + (Array.isArray(e.roles) && e.roles.length ? ` · ${e.roles[0]}` : ""),
          placeholder: "Use the client's RM",
          clearable: true,
        },
        {
          // A joint meeting (CRM 2026-10-01): colleagues alongside the RM — each is
          // saved as a team attendee and told; the meeting shows in their meetings.
          key: "coAttendeeIds",
          label: "Colleagues joining (optional)",
          type: "multiselect",
          lookupEndpoint: "/api/review-meetings/team",
          lookupEnvelope: "team",
          lookupLabel: (u) => u.name,
          lookupFilter: (u, form) => u.id !== form.rmId,
          help: "Up to 10.",
        },
        { key: "locationOrLink", label: "Location / link" },
        { key: "discussionPoints", label: "Discussion points (agenda)", type: "textarea" },
      ],
    },
  ],

  buildBody: (form) => {
    const body: Record<string, any> = {
      subject: form.subject || undefined,
      category: form.category,
      meetingType: TYPE_FOR_CATEGORY[form.category] ?? "portfolio_review",
      meetingDate: new Date(`${form.meetingDay}T${form.meetingTime || "11:00"}:00`).toISOString(),
      durationMinutes: parseInt(form.durationMinutes, 10) || 30,
      meetingMode: form.meetingMode,
      locationOrLink: form.locationOrLink || undefined,
      discussionPoints: form.discussionPoints || undefined,
      rmId: form.rmId || undefined,
      coAttendeeIds: Array.isArray(form.coAttendeeIds) && form.coAttendeeIds.length ? form.coAttendeeIds.slice(0, 10) : undefined,
      status: form.status,
    };
    if (form.subjectKind === "client") body.investorId = form.investorId;
    else if (form.subjectKind === "lead") body.leadId = form.leadId;
    else {
      // Family → attach to the primary investor + the familyId, force review.
      const [familyId, primaryInvestorId] = String(form.familyId).split(":");
      body.investorId = primaryInvestorId || undefined;
      body.familyId = familyId || undefined;
      body.category = "review";
    }
    return body;
  },

  redirect: () => null,
};
