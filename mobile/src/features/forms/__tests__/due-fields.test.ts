/**
 * Due / follow-up / meeting fields with quick chips send India time, and a
 * day picked from the calendar still sends exactly what it always did.
 */
jest.mock("../../../api/client", () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), del: jest.fn() } }));
jest.mock("../../../lib/offlineQueue", () => ({ queuedPost: jest.fn(), queuedPatch: jest.fn() }));
jest.mock("../../leads/LeadDuplicateNotice", () => ({ LeadDuplicateNotice: () => null }));

import { leadForm } from "../leads";
import { activityForm } from "../activities";
import { reviewMeetingForm } from "../review-meetings";
import { serviceRequestForm } from "../service-requests";
import { taskForm } from "../tasks";

const init = (spec: any, params: Record<string, string> = {}) => (typeof spec.initial === "function" ? spec.initial(params) : { ...spec.initial });

describe("lead follow-up", () => {
  it("a chip's time is India time; a bare day stays 10:00 IST", () => {
    expect(leadForm.buildBody({ ...init(leadForm), name: "Asha", followUpDate: "2026-11-21T17:00" }, {}).followUpDate).toBe("2026-11-21T11:30:00.000Z");
    expect(leadForm.buildBody({ ...init(leadForm), name: "Asha", followUpDate: "2026-11-21" }, {}).followUpDate).toBe("2026-11-21T04:30:00.000Z");
  });
  it("an edited lead sends an unchanged 5 pm follow-up back as 5 pm", () => {
    const rec = { name: "Asha", source: "website", nextFollowUpAt: "2026-11-20T11:30:00.000Z" };
    const form = { ...init(leadForm), ...leadForm.editInitial!(rec, {}) };
    expect(form.nextFollowUpAt).toBe("2026-11-20T17:00");
    expect(leadForm.buildBody(form, {}).nextFollowUpAt).toBe(rec.nextFollowUpAt);
  });
});

describe("activity follow-up", () => {
  it("takes a chip's India time and still refuses a past day", () => {
    const base = { ...init(activityForm), investorId: "00000000-0000-4000-8000-000000000001" };
    expect(activityForm.buildBody({ ...base, nextFollowupDay: "2026-12-01T17:00" }, {}).nextFollowupAt).toBe("2026-12-01T11:30:00.000Z");
    expect(activityForm.validate!({ ...base, nextFollowupDay: "2020-01-01T10:00" })?.nextFollowupDay).toBeTruthy();
  });
  it("shows the client's name when the page passed it", () => {
    expect(init(activityForm, { investorId: "i1", name: "Rajesh Patel" })._investorName).toBe("Rajesh Patel");
    expect(init(activityForm, { leadId: "l1", name: "Asha" })._leadName).toBe("Asha");
    expect(init(activityForm, { name: "Nobody" })._investorName).toBe("");
  });
});

describe("meeting time", () => {
  it("reads the slot as India time", () => {
    const form = { ...init(reviewMeetingForm, { investorId: "i1" }), meetingDay: "2026-11-22", meetingTime: "10:00" };
    expect(reviewMeetingForm.buildBody(form, {}).meetingDate).toBe("2026-11-22T04:30:00.000Z");
  });
  it("is named when opened from a lead or client page", () => {
    const f = init(reviewMeetingForm, { leadId: "l1", name: "Asha" });
    expect([f.subjectKind, f.leadId, f._leadName]).toEqual(["lead", "l1", "Asha"]);
    const body = reviewMeetingForm.buildBody({ ...f, meetingDay: "2026-11-22" }, {});
    expect(body.leadId).toBe("l1");
    expect(body._leadName).toBeUndefined();
  });
});

describe("service request client", () => {
  it("keeps the name out of the body", () => {
    const f = init(serviceRequestForm, { investorId: "i1", name: "Rajesh Patel" });
    expect(f._investorName).toBe("Rajesh Patel");
    const body = serviceRequestForm.buildBody({ ...f, subject: "Update bank account" }, {});
    expect(body.investorId).toBe("i1");
    expect(Object.keys(body)).not.toContain("_investorName");
  });
});

describe("editing a task's due", () => {
  const rec = { title: "Call back", priority: "normal", dueAt: "2026-11-21T04:30:00.000Z" };
  it("a chip sets its own India time", () => {
    const form = taskForm.editInitial!(rec, {});
    expect(taskForm.buildBody({ ...form, dueDate: "2026-11-22T17:00" }, {}).dueAt).toBe("2026-11-22T11:30:00.000Z");
  });
  it("a day from the calendar keeps the task's time of day", () => {
    const form = taskForm.editInitial!(rec, {});
    expect(taskForm.buildBody({ ...form, dueDate: "2026-11-23" }, {}).dueAt).toBe("2026-11-23T04:30:00.000Z");
    expect(taskForm.buildBody(form, {}).dueAt).toBeUndefined();
  });
});
