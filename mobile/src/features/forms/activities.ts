/**
 * Log activity ("Log call / visit") form — parity with the web ActivityLogger
 * drawer. Subject picker (client OR lead), kind pills, call-only fields
 * (direction / outcome / duration), a one-line subject, notes, occurred-on and
 * an optional next follow-up. POSTs the exact camelCase body to /api/activities.
 */

import type { FormSpec } from "./types";
import { istToIso, splitDue } from "../../components/form/due";
import { clientNameById, leadNameById, presetName } from "./pickers";

function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
/** An earlier day is logged at noon IST that day. */
const noonIst = (day: string) => new Date(`${day}T12:00:00+05:30`).toISOString();
/** "Occurred on" today is NOW — noon stamped a 9 a.m. call three hours in the
 *  future. Taken when the form is saved, so a log queued offline keeps it. */
const occurredAt = (day?: string) => (!day || day >= todayIso() ? new Date().toISOString() : noonIst(day));
/** The follow-up day at 10:00 IST (the CRM's follow-up time), or a quick chip's India time. */
const followUpAt = (v?: string) => istToIso(v, "10:00");

export const activityForm: FormSpec = {
  title: "Log activity",
  endpoint: "/api/activities",
  submitLabel: "Save activity",
  invalidate: ["activities"],

  initial: (params) => ({
    subjectType: params.leadId ? "lead" : "investor",
    investorId: params.investorId ?? "",
    leadId: params.leadId ?? "",
    // Opened from the client's / lead's page: show the name, not "Selected".
    _investorName: presetName(params, "investorId"),
    _leadName: presetName(params, "leadId"),
    kind: "call",
    direction: "outbound",
    status: "",
    durationMin: "",
    subject: "",
    notes: "",
    occurredDay: todayIso(),
    nextFollowupDay: "",
  }),

  validate: (v) => {
    const e: Record<string, string> = {};
    if (v.subjectType === "investor" && !v.investorId) e.investorId = "Pick a client";
    if (v.subjectType === "lead" && !v.leadId) e.leadId = "Pick a lead";
    // The API takes 0 – 86,400 seconds; a typo like 600 hours was a bare 400.
    const min = String(v.durationMin ?? "").trim();
    if (v.kind === "call" && min && !(Number(min) >= 0 && Number(min) <= 1440)) e.durationMin = "Enter minutes between 0 and 1,440";
    if (v.nextFollowupDay && splitDue(v.nextFollowupDay).day < todayIso()) e.nextFollowupDay = "Pick today or a later day";
    return Object.keys(e).length ? e : null;
  },

  sections: [
    {
      title: "Who & what",
      fields: [
        {
          key: "subjectType", label: "Log against", type: "select",
          options: [{ value: "investor", label: "Client" }, { value: "lead", label: "Lead" }],
        },
        {
          key: "investorId", label: "Client", type: "typeahead",
          searchEndpoint: "/api/search", searchEnvelope: "investors",
          searchLabel: (i) => i.name, searchSublabel: (i) => [i.pan_display, i.segment_tag].filter(Boolean).join(" · "),
          searchDisplayKey: "_investorName", searchInitialLabel: clientNameById,
          placeholder: "Search a client by name or PAN…",
          visibleIf: (v) => v.subjectType === "investor",
        },
        {
          key: "leadId", label: "Lead", type: "typeahead",
          searchEndpoint: "/api/search", searchEnvelope: "leads",
          searchLabel: (l) => l.name, searchSublabel: (l) => [l.phone, l.stage ? String(l.stage).replace(/_/g, " ") : ""].filter(Boolean).join(" · "),
          searchDisplayKey: "_leadName", searchInitialLabel: leadNameById,
          placeholder: "Search a lead by name or phone…",
          visibleIf: (v) => v.subjectType === "lead",
        },
        {
          key: "kind", label: "Type", type: "select",
          options: [
            { value: "call", label: "Call" }, { value: "visit", label: "Visit" }, { value: "note", label: "Note" },
            { value: "whatsapp", label: "WhatsApp" }, { value: "email", label: "Email" }, { value: "sms", label: "SMS" }, { value: "other", label: "Other" },
          ],
        },
      ],
    },
    {
      title: "Call details",
      visibleIf: (v) => v.kind === "call",
      fields: [
        { key: "direction", label: "Direction", type: "select", options: [{ value: "outbound", label: "Outbound" }, { value: "inbound", label: "Inbound" }] },
        {
          key: "status", label: "Outcome", type: "select",
          options: [
            { value: "", label: "— Not set —" }, { value: "answered", label: "Answered" }, { value: "completed", label: "Completed" },
            { value: "no_answer", label: "No answer" }, { value: "busy", label: "Busy" }, { value: "left_voicemail", label: "Left voicemail" }, { value: "no_show", label: "No-show" },
          ],
        },
        { key: "durationMin", label: "Duration (min)", type: "number" },
      ],
    },
    {
      title: "Details",
      fields: [
        { key: "subject", label: "Summary", placeholder: "e.g. SIP top-up discussion" },
        { key: "notes", label: "Notes / outcome", type: "textarea" },
        { key: "occurredDay", label: "Occurred on", type: "date", maxToday: true },
        { key: "nextFollowupDay", label: "Next follow-up (optional)", type: "due", defaultTime: "10:00" },
      ],
    },
  ],

  buildBody: (form, params) => {
    const subjectId = form.subjectType === "investor" ? (form.investorId || params.investorId) : (form.leadId || params.leadId);
    const body: Record<string, any> = {
      subjectType: form.subjectType,
      subjectId,
      kind: form.kind,
      subject: form.subject || undefined,
      notes: form.notes || undefined,
      occurredAt: occurredAt(form.occurredDay),
      nextFollowupAt: followUpAt(form.nextFollowupDay),
    };
    if (form.kind === "call") {
      body.direction = form.direction || undefined;
      if (form.status) body.status = form.status;
      const min = parseFloat(form.durationMin);
      if (min > 0) body.durationSec = Math.min(86400, Math.round(min * 60));
    }
    return body;
  },

  redirect: () => null,
};
