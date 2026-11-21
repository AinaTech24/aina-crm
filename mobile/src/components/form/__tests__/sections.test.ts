/**
 * The form engine's folding rules (components/form/sections) and how they land
 * on the real forms: long forms fold, short ones stay flat, and only the first
 * section and the ones with something missing open.
 */
jest.mock("../../../api/client", () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), del: jest.fn() } }));
jest.mock("../../../lib/offlineQueue", () => ({ queuedPost: jest.fn(), queuedPatch: jest.fn() }));
jest.mock("../../../features/leads/LeadDuplicateNotice", () => ({ LeadDuplicateNotice: () => null }));
jest.mock("../../../features/investors/PanExistsNotice", () => ({ PanExistsNotice: () => null }));

import {
  firstErrorKey, initiallyOpen, isFilled, isLongForm, needsAttention, openAtFirstSight, sectionSummary, serverFieldErrors, shouldCollapse, shownSections,
} from "../sections";
import { FORMS } from "../../../features/forms";
import { fixedDepositForm } from "../../../features/forms/fixed-deposits";
import type { FormSpec, SectionSpec } from "../../../features/forms/types";

describe("what counts as filled", () => {
  it("ignores blanks, empty lists, a switch left off and readonly lines", () => {
    expect(isFilled({ type: "text" }, "  ")).toBe(false);
    expect(isFilled({ type: "text" }, "Asha")).toBe(true);
    expect(isFilled({ type: "multiselect" }, [])).toBe(false);
    expect(isFilled({ type: "multiselect" }, ["SIP"])).toBe(true);
    expect(isFilled({ type: "switch" }, false)).toBe(false);
    expect(isFilled({ type: "switch" }, true)).toBe(true);
    expect(isFilled({ type: "readonly" }, "x")).toBe(false);
    expect(isFilled({ type: "number" }, 0)).toBe(true);
  });
});

describe("folding rules", () => {
  it("folds only a long form, unless the spec says", () => {
    expect(shouldCollapse(3, 12)).toBe(true);
    expect(shouldCollapse(2, 30)).toBe(false);
    expect(shouldCollapse(3, 10)).toBe(false);
    expect(shouldCollapse(5, 40, "never")).toBe(false);
    expect(shouldCollapse(2, 4, "always")).toBe(true);
  });
  it("opens the first section, a missing required field, an error, or defaultOpen", () => {
    const s: SectionSpec = { title: "Contact", fields: [] };
    expect(initiallyOpen({ first: true, section: s, attention: false })).toBe(true);
    expect(initiallyOpen({ first: false, section: s, attention: false })).toBe(false);
    expect(initiallyOpen({ first: false, section: s, attention: true })).toBe(true);
    expect(initiallyOpen({ first: false, section: { ...s, defaultOpen: true }, attention: false })).toBe(true);
    expect(initiallyOpen({ first: true, section: { ...s, defaultOpen: false }, attention: false })).toBe(false);
    // No title = no header to open it by.
    expect(initiallyOpen({ first: false, section: { fields: [] }, attention: false })).toBe(true);
  });
  it("needs attention for an error or an empty required field", () => {
    const fields = [{ key: "name", label: "Name", required: true }, { key: "city", label: "City" }];
    expect(needsAttention(fields, { name: "", city: "" }, null)).toBe(true);
    expect(needsAttention(fields, { name: "Asha", city: "" }, null)).toBe(false);
    expect(needsAttention(fields, { name: "Asha", city: "" }, { city: "Too long" })).toBe(true);
  });
  it("summarises a folded section", () => {
    const s: SectionSpec = { title: "Contact", fields: [{ key: "a", label: "A" }, { key: "b", label: "B" }, { key: "c", label: "C", type: "readonly" }] };
    expect(sectionSummary(s, s.fields, { a: "x", b: "" })).toBe("1 of 2 filled");
    expect(sectionSummary({ ...s, summary: () => "Retail" }, s.fields, {})).toBe("Retail");
  });
  it("finds the first error in field order", () => {
    expect(firstErrorKey(["name", "pan", "email"], { email: "bad", pan: "bad" })).toBe("pan");
    expect(firstErrorKey(["name"], {})).toBeNull();
  });
});

describe("server field errors", () => {
  it("maps zod issues and fieldErrors onto the form's own keys only", () => {
    const body = {
      error: "invalid body",
      issues: [{ path: ["email"], message: "Invalid email" }, { path: ["subjectId"], message: "Required" }],
      details: { fieldErrors: { phone: ["Too short"], email: ["second message"] } },
    };
    expect(serverFieldErrors(body, ["name", "email", "phone"])).toEqual({ email: "Invalid email", phone: "Too short" });
    expect(serverFieldErrors({ error: "Pick a date", field: "dueDate" }, ["dueDate"])).toEqual({ dueDate: "Pick a date" });
    expect(serverFieldErrors(null, ["x"])).toEqual({});
  });
});

/** What a spec looks like when it opens: folded? which sections open? */
function opening(spec: FormSpec, params: Record<string, string> = {}) {
  const form = typeof spec.initial === "function" ? spec.initial(params) : { ...spec.initial };
  const shown = shownSections(spec.sections ?? spec.steps?.[0].sections ?? [], form);
  const long = isLongForm(shown, spec.collapse);
  const open = openAtFirstSight(shown, form, spec.validate?.(form) ?? null);
  return { long, open: shown.filter((_, i) => open[i]).map((x) => x.section.title ?? "(untitled)") };
}

describe("the real forms", () => {
  it("folds the new client form down to identity", () => {
    expect(opening(FORMS.investors)).toEqual({ long: true, open: ["Identity & personal"] });
  });
  it("folds a new lead (with More details) to its contact", () => {
    expect(opening(FORMS.leads)).toEqual({ long: true, open: ["Contact"] });
  });
  it("opens a goal's client and amount, folds the assumptions", () => {
    expect(opening(FORMS.goals)).toEqual({ long: true, open: ["Goal", "Amount & horizon"] });
  });
  it("opens an FD's client and deposit, folds the rest", () => {
    expect(opening(fixedDepositForm)).toEqual({ long: true, open: ["Client", "Deposit"] });
  });
  it("keeps the short forms flat", () => {
    for (const key of ["tasks", "activities", "review-meetings", "service-requests", "employees"]) {
      expect([key, opening(FORMS[key]).long]).toEqual([key, false]);
    }
  });
});
