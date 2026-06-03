import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import crypto from "node:crypto";
import { withSystem, withTenant } from "@/db/client";
import { users } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const userId = sp.get("userId");
    const token = sp.get("token");

    if (!userId || !token) {
      return new NextResponse("Bad Request: missing params", { status: 400 });
    }

    const expectedSignature = crypto
      .createHmac("sha256", process.env.NEXTAUTH_SECRET ?? "dev-secret")
      .update(userId)
      .digest("hex");

    if (token !== expectedSignature) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const user = await withSystem(async (tx) => {
      return (await tx.select().from(users).where(eq(users.id, userId)).limit(1))[0];
    });

    if (!user) {
      return new NextResponse("User not found", { status: 404 });
    }

    const now = new Date();
    const monthStartIso = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const monthEndIso = new Date(now.getFullYear(), now.getMonth() + 4, 0).toISOString().slice(0, 10);

    const out: any[] = [];

    await withTenant(user.tenantId, async (tx) => {
      const tasks = await tx.execute(sql`
        SELECT id, title, due_at, priority, description
        FROM tasks
        WHERE due_at IS NOT NULL
          AND due_at::date >= ${monthStartIso} AND due_at::date <= ${monthEndIso}
        ORDER BY due_at ASC LIMIT 500
      `);
      for (const r of tasks.rows as any[]) {
        out.push({ date: r.due_at, kind: "task", title: r.title, description: r.description });
      }

      const leads = await tx.execute(sql`
        SELECT id, name, next_follow_up_at, stage
        FROM leads
        WHERE next_follow_up_at IS NOT NULL
          AND next_follow_up_at::date >= ${monthStartIso}
          AND next_follow_up_at::date <= ${monthEndIso}
          AND converted_investor_id IS NULL AND stage NOT IN ('lost')
        LIMIT 500
      `);
      for (const r of leads.rows as any[]) {
        out.push({ date: r.next_follow_up_at, kind: "follow_up", title: `Follow up: ${r.name}`, description: `Stage: ${r.stage}` });
      }

      const reviews = await tx.execute(sql`
        SELECT id, name, next_review_at, segment_tag
        FROM investors
        WHERE next_review_at IS NOT NULL
          AND next_review_at::date >= ${monthStartIso}
          AND next_review_at::date <= ${monthEndIso}
        LIMIT 500
      `);
      for (const r of reviews.rows as any[]) {
        out.push({ date: r.next_review_at, kind: "review", title: `Review: ${r.name}`, description: `Segment: ${r.segment_tag ?? "—"}` });
      }

      const sips = await tx.execute(sql`
        SELECT s.id, s.scheme_name, s.amount, s.next_installment_at, i.name AS investor_name
        FROM sips s LEFT JOIN investors i ON i.id = s.investor_id
        WHERE s.status = 'active' AND s.next_installment_at IS NOT NULL
          AND s.next_installment_at::date >= ${monthStartIso}
          AND s.next_installment_at::date <= ${monthEndIso}
        LIMIT 500
      `);
      for (const r of sips.rows as any[]) {
        out.push({ date: r.next_installment_at, kind: "sip", title: `SIP · ${r.investor_name ?? "—"}`, description: `Amount: ₹${r.amount}\nScheme: ${r.scheme_name ?? "—"}` });
      }

      const campaigns = await tx.execute(sql`
        SELECT id, name, scheduled_at, channel, status
        FROM campaigns
        WHERE scheduled_at IS NOT NULL
          AND scheduled_at::date >= ${monthStartIso}
          AND scheduled_at::date <= ${monthEndIso}
        LIMIT 200
      `);
      for (const r of campaigns.rows as any[]) {
        out.push({ date: r.scheduled_at, kind: "campaign", title: r.name, description: `Channel: ${r.channel} · Status: ${r.status}` });
      }

      const compliance = await tx.execute(sql`
        SELECT 'arn' AS kind, arn_expiry_at AS due_date, arn AS identifier
        FROM tenants WHERE id = ${user.tenantId}::uuid AND arn_expiry_at IS NOT NULL
          AND arn_expiry_at >= ${monthStartIso}::date AND arn_expiry_at <= ${monthEndIso}::date
        UNION ALL
        SELECT 'nism', nism_expiry_at::date, name
        FROM users WHERE nism_expiry_at IS NOT NULL
          AND nism_expiry_at::date >= ${monthStartIso} AND nism_expiry_at::date <= ${monthEndIso}
        UNION ALL
        SELECT 'kyc', ckyc_expiry_at, name
        FROM investors WHERE ckyc_expiry_at IS NOT NULL
          AND ckyc_expiry_at >= ${monthStartIso}::date AND ckyc_expiry_at <= ${monthEndIso}::date
        LIMIT 200
      `);
      for (const r of compliance.rows as any[]) {
        out.push({
          date: r.due_date,
          kind: "compliance",
          title: `${r.kind?.toUpperCase()} Expiry: ${r.identifier}`,
          description: `Compliance renewal checklist alert for ${r.identifier}`,
        });
      }
    });

    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//AinaTech//AinaCRM//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
    ];

    const clean = (str: string) => str.replace(/[\n\r]/g, " ").replace(/[,;]/g, "\\$&");

    for (const item of out) {
      const dateObj = new Date(item.date);
      const formatIcalDate = (d: Date) => {
        return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
      };

      const startStr = formatIcalDate(dateObj);
      const endDateObj = new Date(dateObj.getTime() + 60 * 60 * 1000);
      const endStr = formatIcalDate(endDateObj);
      const stampStr = formatIcalDate(new Date());

      ics.push("BEGIN:VEVENT");
      ics.push(`UID:${item.kind}-${startStr}-${crypto.randomUUID().slice(0, 8)}@ainacrm.com`);
      ics.push(`DTSTAMP:${stampStr}`);
      ics.push(`DTSTART:${startStr}`);
      ics.push(`DTEND:${endStr}`);
      ics.push(`SUMMARY:[${item.kind.toUpperCase()}] ${clean(item.title)}`);
      if (item.description) {
        ics.push(`DESCRIPTION:${clean(item.description)}`);
      }
      ics.push("END:VEVENT");
    }

    ics.push("END:VCALENDAR");
    const icsContent = ics.join("\r\n");

    return new NextResponse(icsContent, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="ainacrm-feed.ics"`,
      },
    });
  } catch (err: any) {
    return new NextResponse(err?.message ?? "Error", { status: 500 });
  }
}
