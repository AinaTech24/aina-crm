/**
 * Lead create form — field-for-field parity with the web
 * /dashboard/leads/new page. Same sections, same options (values + labels),
 * same POST body to /api/leads. The web page redirects to the leads LIST on
 * success (router.push("/dashboard/leads")), so redirect() returns null.
 *
 * Notes on fidelity vs. web:
 *  - The web avatar upload (Camera → /api/compliance/upload → avatarUrl) is a
 *    file-picker side effect with no FormSpec equivalent, so it is omitted;
 *    avatarUrl is simply never sent (web sends it as undefined when empty too).
 *  - The live duplicate scan (/api/leads/check-duplicate) is LeadDuplicateNotice:
 *    an inline warning that never blocks or alters the payload. An existing
 *    CLIENT is offered "Start opportunity" instead of a new lead.
 *  - The web referrer picker (InvestorLookup) is a typeahead over
 *    /api/search (envelope "investors") and returns BOTH id + name; the web
 *    POST sends referredByInvestorId + referredByName together. The mobile
 *    lookup model stores only the id, so referredByName cannot be recovered
 *    from the selection and is not sent. See "notes".
 *  - The web sub-distributor picker hits /api/sub-distributors?status=active
 *    (envelope "subDistributors"); modelled as a lookup here.
 */

import type { FormSpec } from "./types";
import { LeadDuplicateNotice } from "../leads/LeadDuplicateNotice";
import { LEAD_SOURCE_OPTIONS } from "../leads/api";
import { dueFromIso, istToIso } from "../../components/form/due";

/** The API's email check (zod .email()) — catch it here instead of a bare "invalid body". */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** A follow-up DAY becomes 10:00 IST that day (the CRM's follow-up time); a
 *  quick chip's time ("Today 5 pm") is India time too.
 *  `new Date("2026-11-21")` is UTC midnight — the task fell due at 05:30. */
const followUpAtIst = (v: string) => istToIso(v, "10:00")!;

export const leadForm: FormSpec = {
  title: "New lead",
  endpoint: "/api/leads",
  submitLabel: "Create lead",
  invalidate: ["leads"],

  initial: {
    name: "",
    email: "",
    phone: "",
    city: "",
    source: "manual",
    /** "Other" source, in the lead's words — saved as source_campaign. */
    sourceOther: "",
    referredByInvestorId: "",
    subDistributorId: "",
    ownerId: "",
    leadType: "",
    aumPotential: "",
    interestProducts: [],
    expectedBusinessAmount: "",
    followUpDate: "",
    occupation: "",
    altPhone: "",
    altEmail: "",
    currentInvestments: [],
    notes: "",
    // Edit-only (mirrors the web LeadEditPanel; shown via section visibleIf on _edit).
    _edit: "",
    pan: "",
    pincode: "",
    sourceCampaign: "",
    intendedAmount: "",
    nextFollowUpAt: "",
    followUpNotes: "",
    lostReason: "",
  },

  validate: (v) => {
    const e: Record<string, string> = {};
    // The API needs 2–120 characters (create and edit); a 1-letter name was a 400.
    if (!v.name?.trim()) e.name = "Name is required";
    else if (v.name.trim().length < 2) e.name = "Enter at least 2 characters";
    if (v.email?.trim() && !EMAIL_RE.test(v.email.trim())) e.email = "Enter a valid email address";
    if (v._edit !== "1" && v.altEmail?.trim() && !EMAIL_RE.test(v.altEmail.trim())) e.altEmail = "Enter a valid email address";
    if (v._edit !== "1" && String(v.expectedBusinessAmount ?? "").trim() && !(Number(v.expectedBusinessAmount) >= 0)) e.expectedBusinessAmount = "Enter an amount in rupees";
    // Web requires a linked referrer when source is referral / existing_client.
    // Only on create: the edit form has no referrer field, so an imported
    // referral lead without one could never be saved.
    if (
      v._edit !== "1" &&
      (v.source === "referral" || v.source === "existing_client") &&
      !v.referredByInvestorId
    ) {
      e.referredByInvestorId = "Referred-by client is required for this source";
    }
    return Object.keys(e).length ? e : null;
  },

  sections: [
    {
      title: "Contact",
      fields: [
        { key: "name", label: "Name", required: true },
        { key: "email", label: "Email", type: "email" },
        { key: "phone", label: "Phone", type: "tel" },
        { key: "city", label: "City" },
        { key: "pan", label: "PAN", autoCapitalize: "characters", transform: (v) => v.toUpperCase(), visibleIf: (v) => v._edit === "1" },
        { key: "pincode", label: "Pincode", keyboard: "number-pad" as any, visibleIf: (v) => v._edit === "1" },
      ],
    },
    {
      title: "Source & attribution",
      fields: [
        {
          key: "source",
          label: "Source",
          type: "select",
          options: LEAD_SOURCE_OPTIONS,
        },
        // An existing client who wants more is an opportunity, not a lead, so the
        // CRM no longer offers "Existing Client Reference"; "Other" asks where from.
        { key: "sourceOther", label: "Where did this lead come from?", visibleIf: (v) => v._edit !== "1" && v.source === "other" },
        { key: "sourceCampaign", label: "Source campaign", placeholder: "e.g. Diwali webinar", visibleIf: (v) => v._edit === "1" },
        {
          key: "referredByInvestorId",
          label: "Referred by (Client)",
          type: "typeahead",
          searchEndpoint: "/api/search",
          searchEnvelope: "investors",
          searchLabel: (r) => r.name,
          searchSublabel: (r) => [r.pan_display, r.phone].filter(Boolean).join(" · "),
          placeholder: "Type the existing client's name, PAN, or mobile…",
          help: "Required for Client Referral. Links the referring client so referral credit is tracked.",
          visibleIf: (v) => v._edit !== "1" && ["referral", "existing_client"].includes(v.source),
        },
        {
          key: "subDistributorId",
          label: "Sub-distributor",
          type: "lookup",
          lookupEndpoint: "/api/sub-distributors?status=active",
          lookupEnvelope: "subDistributors",
          lookupLabel: (r) => r.name + (r.code ? ` · ${r.code}` : "") + (r.arnNumber ? ` · ARN: ${r.arnNumber}` : ""),
          placeholder: "Type sub-distributor name, code, or ARN…",
          clearable: true,
          help: "optional · channel partner credit",
          visibleIf: (v) => v._edit !== "1",
        },
        {
          key: "ownerId",
          label: "Assign RM",
          type: "lookup",
          lookupEndpoint: "/api/employees?role=rm",
          lookupEnvelope: "rows",
          lookupLabel: (e) => e.name + (Array.isArray(e.roles) && e.roles.length ? ` · ${e.roles[0]}` : ""),
          placeholder: "Use default assignment",
          clearable: true,
          help: "Leave blank to use your role and firm assignment rules.",
        },
      ],
    },
    {
      title: "Qualification",
      visibleIf: (v) => v._edit !== "1",
      fields: [
        {
          key: "leadType",
          label: "Lead type",
          type: "select",
          options: [
            { value: "", label: "—" },
            { value: "individual", label: "Individual" },
            { value: "hni", label: "HNI" },
            { value: "nri", label: "NRI" },
            { value: "huf", label: "HUF" },
            { value: "corporate", label: "Corporate" },
            { value: "minor", label: "Minor" },
          ],
        },
        {
          key: "aumPotential",
          label: "AUM potential",
          type: "select",
          options: [
            { value: "", label: "—" },
            { value: "under_10l", label: "< ₹10 L" },
            { value: "10l_50l", label: "₹10 – 50 L" },
            { value: "50l_2cr", label: "₹50 L – 2 Cr" },
            { value: "hni_2cr_plus", label: "HNI · ₹2 Cr+" },
          ],
        },
        {
          key: "interestProducts",
          label: "Products of interest",
          type: "multiselect",
          options: [
            "Equity MF", "Debt MF", "Hybrid MF", "ELSS (Tax)", "Index Funds",
            "SIP", "Lumpsum", "NPS", "Insurance", "PMS", "AIF", "FD / Bonds",
          ],
          help: "Tap all that apply.",
        },
        {
          key: "expectedBusinessAmount",
          label: "Expected business (₹)",
          type: "number",
        },
        {
          key: "followUpDate",
          label: "Follow-up date",
          type: "due",
          defaultTime: "10:00",
          help: "Sets the next follow-up + creates an RM task.",
        },
      ],
    },
    {
      title: "Follow-up & pipeline",
      visibleIf: (v) => v._edit === "1",
      fields: [
        { key: "intendedAmount", label: "Intended amount (₹)", type: "number" },
        { key: "nextFollowUpAt", label: "Next follow-up", type: "due", defaultTime: "10:00" },
        { key: "followUpNotes", label: "Follow-up notes", type: "textarea" },
        { key: "lostReason", label: "Lost reason", placeholder: "Only if not qualified" },
      ],
    },
    {
      title: "More details",
      visibleIf: (v) => v._edit !== "1",
      fields: [
        { key: "occupation", label: "Occupation" },
        { key: "altPhone", label: "Alternate phone", type: "tel", placeholder: "Secondary number" },
        { key: "altEmail", label: "Alternate email", type: "email", placeholder: "Secondary email" },
        {
          key: "currentInvestments",
          label: "Current investments",
          type: "multiselect",
          options: [
            "Equity MF", "Debt MF", "Hybrid MF", "ELSS (Tax)", "Index Funds",
            "SIP", "Lumpsum", "NPS", "Insurance", "PMS", "AIF", "FD / Bonds",
          ],
          help: "What they already hold elsewhere — tap all that apply.",
        },
        {
          key: "notes",
          label: "Notes",
          type: "textarea",
          placeholder: "Anything the RM should know about this lead…",
        },
      ],
    },
  ],

  buildBody: (form) => {
    // Edit mode → PATCH body (mirrors the web LeadEditPanel's editable fields).
    if (form._edit === "1") {
      // A field the record HAD and the user cleared is sent as "" (the API
      // nulls it); one that was empty all along is left out, so an edit never
      // turns NULLs into empty strings.
      const had: Record<string, boolean> = form._had ?? {};
      const u = (key: string) => {
        const v = String(form[key] ?? "").trim();
        return v ? v : had[key] ? "" : undefined;
      };
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        email: (form.email || "").trim(),
        phone: u("phone"),
        pan: u("pan"),
        city: u("city"),
        pincode: u("pincode"),
        source: form.source,
        sourceCampaign: u("sourceCampaign"),
        intendedAmount: u("intendedAmount"),
        nextFollowUpAt: form.nextFollowUpAt ? followUpAtIst(form.nextFollowUpAt) : had.nextFollowUpAt ? "" : undefined,
        followUpNotes: u("followUpNotes"),
        lostReason: u("lostReason"),
        notes: u("notes"),
      };
      // "Assign RM" shows in edit too; it used to be dropped from the PATCH.
      if (form.ownerId) body.ownerId = form.ownerId;
      return body;
    }
    const products = Array.isArray(form.interestProducts) ? form.interestProducts : [];
    const current = Array.isArray(form.currentInvestments) ? form.currentInvestments : [];
    const payload: any = {
      name: form.name.trim(),
      avatarUrl: form.avatarUrl || undefined,
      email: form.email?.trim() || undefined,
      phone: form.phone || undefined,
      city: form.city || undefined,
      source: form.source,
      sourceCampaign: form.source === "other" && form.sourceOther?.trim() ? form.sourceOther.trim() : undefined,
      notes: form.notes || undefined,
      leadType: form.leadType || undefined,
      aumPotential: form.aumPotential || undefined,
      occupation: form.occupation || undefined,
      altPhone: form.altPhone || undefined,
      altEmail: form.altEmail?.trim() || undefined,
      interestProducts: products.length ? products : undefined,
      currentInvestments: current.length ? current : undefined,
      expectedBusinessAmount: form.expectedBusinessAmount
        ? Number(form.expectedBusinessAmount)
        : undefined,
      // The day picked, at 10:00 IST (the web sends its datetime-local instant).
      followUpDate: form.followUpDate ? followUpAtIst(form.followUpDate) : undefined,
    };
    if (form.referredByInvestorId) {
      payload.referredByInvestorId = form.referredByInvestorId;
      payload.referredByName = form.referredByName;
    }
    if (form.ownerId) payload.ownerId = form.ownerId;
    if (form.subDistributorId) payload.subDistributorId = form.subDistributorId;
    return payload;
  },

  // Web redirects to the leads LIST (router.push("/dashboard/leads")).
  redirect: () => null,

  notice: LeadDuplicateNotice,

  editTitle: "Edit lead",
  // GET /api/leads/[id] returns the lead object directly (no envelope).
  editInitial: (rec) => {
    // The IST day of a stored instant — and its IST time unless it is the
    // usual 10:00, so an unchanged follow-up is sent back exactly as it was.
    const dstr = (v: any) => dueFromIso(v, "10:00");
    const has = (v: unknown) => v != null && String(v).trim() !== "";
    return {
      _edit: "1",
      _had: {
        phone: has(rec.phone), pan: has(rec.pan), city: has(rec.city), pincode: has(rec.pincode),
        sourceCampaign: has(rec.sourceCampaign), intendedAmount: has(rec.intendedAmount), nextFollowUpAt: has(rec.nextFollowUpAt),
        followUpNotes: has(rec.followUpNotes), lostReason: has(rec.lostReason), notes: has(rec.notes),
      },
      name: rec.name ?? "",
      email: rec.email ?? "",
      phone: rec.phone ?? "",
      pan: rec.pan ?? "",
      city: rec.city ?? "",
      pincode: rec.pincode ?? "",
      source: rec.source ?? "manual",
      sourceCampaign: rec.sourceCampaign ?? "",
      intendedAmount: rec.intendedAmount ?? (rec.expectedBusinessAmount != null ? String(rec.expectedBusinessAmount) : ""),
      nextFollowUpAt: dstr(rec.nextFollowUpAt),
      followUpNotes: rec.followUpNotes ?? "",
      lostReason: rec.lostReason ?? "",
      notes: rec.notes ?? "",
      // Carried but hidden in edit:
      referredByInvestorId: rec.referredByInvestorId ?? "",
      subDistributorId: rec.subDistributorId ?? "",
      ownerId: rec.ownerId ?? "",
      leadType: rec.leadType ?? "",
      aumPotential: rec.aumPotential ?? "",
      interestProducts: rec.interestProducts ?? [],
      currentInvestments: rec.profile?.currentInvestments ?? [],
      occupation: rec.profile?.occupation ?? "",
      altPhone: rec.altPhone ?? "",
      altEmail: rec.altEmail ?? "",
      expectedBusinessAmount: rec.expectedBusinessAmount != null ? String(rec.expectedBusinessAmount) : "",
      followUpDate: "",
    };
  },
};
