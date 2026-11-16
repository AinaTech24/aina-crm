/**
 * The Meetings list's "add a field" catalog and the loader behind it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MEETING_EXTRA_FIELDS, allowedMeetingExtraKeys, meetingExtraOptions } from "@/lib/list-columns/meeting-fields";

describe("meeting extra fields", () => {
  it("every field has a unique key, a label and an expression", () => {
    const keys = MEETING_EXTRA_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(MEETING_EXTRA_FIELDS.every((f) => f.label && f.expr && f.group)).toBe(true);
    expect(keys.some((k) => k.includes(":"))).toBe(false); // `x:` / `cf:` belong to the column key, not the field
  });

  it("withholds the client's email / phone when the licence does not allow them", () => {
    const opts = meetingExtraOptions((f) => f !== "email");
    expect(opts.some((o) => o.key === "email")).toBe(false);
    expect(opts.some((o) => o.key === "phone")).toBe(true);
    expect(allowedMeetingExtraKeys(opts).has("attendees")).toBe(true);
  });
});

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("loadMeetingExtra against the database", () => {
  const tenant = crypto.randomUUID();
  const rm = crypto.randomUUID();
  const branch = crypto.randomUUID();
  const client = crypto.randomUUID();
  const lead = crypto.randomUUID();
  const parent = crypto.randomUUID();
  const meeting = crypto.randomUUID();
  const leadMeeting = crypto.randomUUID();
  let withSystem: typeof import("@/db/client").withSystem;
  let withTenant: typeof import("@/db/client").withTenant;
  let sql: typeof import("drizzle-orm").sql;
  let load: typeof import("@/lib/list-columns/meeting-fields").loadMeetingExtra;
  const q = (t: ReturnType<typeof import("drizzle-orm").sql>) => withSystem((tx) => tx.execute(t));

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem, withTenant } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    ({ loadMeetingExtra: load } = await import("@/lib/list-columns/meeting-fields"));
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'Mtg Firm', 'Mtg Firm', ${"ARN-MT-" + tenant.slice(0, 6)})`);
    await q(sql`INSERT INTO branches (id, tenant_id, name, code) VALUES (${branch}::uuid, ${tenant}::uuid, 'Surat', 'SRT')`);
    await q(sql`INSERT INTO users (id, tenant_id, email, name, roles, status) VALUES (${rm}::uuid, ${tenant}::uuid, ${"mt-" + rm.slice(0, 6) + "@t.in"}, 'Riya RM', ARRAY['rm']::text[], 'active')`);
    await q(sql`INSERT INTO investors (id, tenant_id, pan, name, email, phone, rm_id, branch_id, segment_tag, address)
                VALUES (${client}::uuid, ${tenant}::uuid, ${"ZZZPM" + tenant.slice(0, 4).toUpperCase() + "9Z"}, 'Test Client', 'c@t.in', '9999999999', ${rm}::uuid, ${branch}::uuid, 'Gold',
                        '{"city":"Surat"}'::jsonb)`);
    await q(sql`INSERT INTO leads (id, tenant_id, name, email, phone, city, stage, source, owner_id, branch_id)
                VALUES (${lead}::uuid, ${tenant}::uuid, 'Test Lead', 'l@t.in', '8888888888', 'Vadodara', 'call_done', 'website_form', ${rm}::uuid, ${branch}::uuid)`);
    await q(sql`INSERT INTO review_meetings (id, tenant_id, investor_id, rm_id, meeting_type, meeting_date, meeting_mode)
                VALUES (${parent}::uuid, ${tenant}::uuid, ${client}::uuid, ${rm}::uuid, 'portfolio_review', '2026-01-10 10:00+05:30', 'office')`);
    await q(sql`INSERT INTO review_meetings (id, tenant_id, investor_id, rm_id, category, parent_meeting_id, meeting_type, meeting_date, duration_minutes, meeting_mode,
                  location_or_link, status, discussion_points, outcome, outcome_notes, next_review_date, reschedule_count, follow_up_task_created, attendees)
                VALUES (${meeting}::uuid, ${tenant}::uuid, ${client}::uuid, ${rm}::uuid, 'follow_up', ${parent}::uuid, 'follow_up_call', '2026-03-05 15:30+05:30', '45', 'online',
                  'https://meet.example/abc', 'completed', 'SIP step-up', 'more_info', 'Wants time', '2026-09-01', 2, 'true',
                  '[{"name":"Spouse A","role":"spouse","isExternal":true},{"name":"CA B","role":"ca","isExternal":true}]'::jsonb)`);
    await q(sql`INSERT INTO review_meetings (id, tenant_id, lead_id, rm_id, meeting_type, meeting_date, meeting_mode)
                VALUES (${leadMeeting}::uuid, ${tenant}::uuid, ${lead}::uuid, ${rm}::uuid, 'discovery_call', '2026-04-01 11:00+05:30', 'phone')`);
  }, 60_000);

  afterAll(async () => {
    if (!withSystem) return;
    await q(sql`DELETE FROM review_meetings WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM leads WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM investors WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM users WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM branches WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`).catch(() => {});
  });

  it("runs EVERY field in the catalog without a SQL error, and reads the ones set", async () => {
    const all = new Set(MEETING_EXTRA_FIELDS.map((f) => f.key));
    const got = await withTenant(tenant, (tx) => load(tx as any, [meeting, leadMeeting], [...all], all));
    const v = got[meeting];
    expect(v.time).toBe("03:30 PM");
    expect(v.duration).toBe("45");
    expect(v.location).toBe("https://meet.example/abc");
    expect(v.discussion).toBe("SIP step-up");
    expect(v.attendees).toBe("Spouse A, CA B");
    expect(v.follow_up_of).toBe("10 Jan 2026");
    expect(v.next_review).toBe("01 Sep 2026");
    expect(v.outcome).toBe("More Info");
    expect(v.reschedules).toBe("2");
    expect(v.tasks_made).toBe("Yes");
    expect(v.party_kind).toBe("Client");
    expect(v.email).toBe("c@t.in");
    expect(v.city).toBe("Surat");
    expect(v.segment).toBe("Gold");
    expect(v.branch).toBe("Surat");
    expect(v.client_rm).toBe("Riya RM");
    const l = got[leadMeeting];
    expect(l.party_kind).toBe("Lead");
    expect(l.email).toBe("l@t.in");
    expect(l.city).toBe("Vadodara");
    expect(l.lead_owner).toBe("Riya RM");
    expect(l.lead_stage).toBe("Call Done");
    expect(l.lead_source).toBe("Website Form");
    expect(l.tasks_made).toBe("No");
  });

  it("a key that is not offered is never run", async () => {
    const got = await withTenant(tenant, (tx) => load(tx as any, [meeting], ["email", "pan; drop table investors"], new Set(["email"])));
    expect(Object.keys(got[meeting])).toEqual(["email"]);
  });
});
