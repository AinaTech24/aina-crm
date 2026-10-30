import { describe, expect, it } from "vitest";
import { itemMeta, renderBriefingEmail } from "@/lib/briefing/email";
import type { ActionGroup } from "@/lib/command-center/queue";

const group = (over: Partial<ActionGroup>): ActionGroup =>
  ({ key: "k", label: "Overdue tasks", icon: "Clock", severity: "today", tone: "amber", count: 1, href: "/dashboard/tasks", items: [], ...over }) as ActionGroup;

const groups: ActionGroup[] = [
  group({
    key: "tasks", label: "Overdue tasks", count: 158, items: [
      { id: "1", title: "Reminder: Portfolio Review with Bhavesh Bhoi tomorrow", detail: "normal · due 05 Jun 26", href: "/dashboard/tasks/1" },
      { id: "2", title: "Call <Ravi> & family", detail: "high · due 06 Jun 26", href: "/dashboard/tasks/2" },
    ],
  }),
  group({ key: "sla", label: "SLA breached — service requests", tone: "rose", count: 1, href: "/dashboard/service-requests",
    items: [{ id: "3", title: "ZKZYc", detail: "#SR-2026-00001 · SLA passed", href: "/dashboard/service-requests/3" }] }),
];

describe("morning briefing email", () => {
  const mail = renderBriefingEmail({
    userName: "Pritesh Thakor",
    firm: { name: "We Care Freedom Wealth", logoUrl: "/api/public/logo/x.png", color: "#0b5cab" },
    groups,
    baseUrl: "https://crm.example.in",
    now: new Date("2026-10-30T02:43:00Z"),
  });

  it("greets by first name, dates the day in India time, no emoji", () => {
    expect(mail.html).toContain("Good morning, Pritesh");
    expect(mail.html).toContain("Friday, 30 October 2026");
    expect(mail.html).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(mail.subject).toBe("Morning briefing · 159 items need your attention");
  });

  it("heads with the firm: absolute logo and its colour", () => {
    expect(mail.html).toContain('src="https://crm.example.in/api/public/logo/x.png"');
    expect(mail.html).toContain("background:#0b5cab");
  });

  it("links every item absolutely and offers View all for the rest", () => {
    expect(mail.html).toContain('href="https://crm.example.in/dashboard/tasks/1"');
    expect(mail.html).toContain("View all 158");
    expect(mail.html).not.toContain("View all 1 ");
  });

  it("escapes item text", () => {
    expect(mail.html).toContain("Call &lt;Ravi&gt; &amp; family");
    expect(mail.html).not.toContain("<Ravi>");
  });

  it("drops normal priority and names the others", () => {
    expect(itemMeta("normal · due 05 Jun 26")).toBe("Due 05 Jun 26");
    expect(itemMeta("high · due 06 Jun 26")).toBe("High priority · due 06 Jun 26");
    expect(itemMeta("#SR-1 · SLA passed")).toBe("#SR-1 · SLA passed");
    expect(itemMeta("Tier — · ₹12.40 L AUM · due 15 Oct 26")).toBe("₹12.40 L AUM · due 15 Oct 26");
  });

  it("ignores a firm colour that is not a plain hex", () => {
    const m = renderBriefingEmail({ userName: "A", firm: { name: "F", color: "red;background:url(x)" }, groups, baseUrl: "https://x" });
    expect(m.html).not.toContain("url(x)");
    expect(m.html).toContain("#1f2937");
  });

  it("has a readable plain-text part", () => {
    expect(mail.text).toContain("Overdue tasks (158)");
    expect(mail.text).toContain("View all: https://crm.example.in/dashboard/tasks");
  });
});
