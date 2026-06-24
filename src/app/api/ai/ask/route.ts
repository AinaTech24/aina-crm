import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/ai/ask — conversational Q&A over the firm's REAL data.
 *
 * Body: { question }
 *
 * Safe-by-design: we never let the model write SQL. Instead we compute a live
 * snapshot of the firm's key metrics from the database (RLS-scoped to the tenant)
 * and hand it to the model as the ONLY source of truth, with a hard rule to
 * answer strictly from those figures (no invented numbers). This makes answers
 * accurate ("real database") without any SQL-injection / data-exfiltration risk.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { aiMessagesClient, isAiConfigured } from "@/lib/ai/provider";

export const dynamic = "force-dynamic";

const Body = z.object({
  question: z.string().min(2).max(500),
  /** Prior turns for multi-turn follow-ups ("…and how many of those are HNI?"). */
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(12)
    .optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

    if (!(await isAiConfigured())) {
      return NextResponse.json(
        { error: "AI isn't configured yet. Set the provider + API key in Aina Admin → AI & Models." },
        { status: 400 }
      );
    }

    // ── Live metric snapshot (RLS-scoped to this tenant) ───────────────────
    const snapshot = await withTenant(session.tenantId, async (tx) => {
      const inv = (
        await tx.execute(sql`
          SELECT
            COUNT(*) FILTER (WHERE status <> 'closed' AND merged_into_id IS NULL AND deleted_at IS NULL)::int AS active_clients,
            COALESCE(SUM(aum) FILTER (WHERE status <> 'closed' AND merged_into_id IS NULL AND deleted_at IS NULL), 0)::numeric AS total_aum,
            COALESCE(SUM(active_sip_amount) FILTER (WHERE status <> 'closed' AND merged_into_id IS NULL AND deleted_at IS NULL), 0)::numeric AS monthly_sip_book,
            COUNT(*) FILTER (WHERE kyc_status NOT IN ('verified','registered') AND deleted_at IS NULL)::int AS kyc_pending,
            COUNT(*) FILTER (WHERE (nominee_name IS NULL OR nominee_name = '') AND deleted_at IS NULL AND status <> 'closed')::int AS no_nominee,
            COUNT(*) FILTER (WHERE segment_tag = 'HNI' AND deleted_at IS NULL)::int AS hni_clients,
            COUNT(*) FILTER (WHERE last_transaction_at < now() - interval '365 days' AND deleted_at IS NULL AND status <> 'closed')::int AS dormant_clients
          FROM investors WHERE tenant_id = ${session.tenantId}::uuid
        `)
      ).rows[0] as any;

      const top = (
        await tx.execute(sql`
          SELECT name, COALESCE(aum,0)::numeric AS aum FROM investors
          WHERE tenant_id = ${session.tenantId}::uuid AND status <> 'closed' AND merged_into_id IS NULL AND deleted_at IS NULL
          ORDER BY aum DESC NULLS LAST LIMIT 10
        `)
      ).rows as any[];

      const leads = (
        await tx.execute(sql`SELECT COUNT(*)::int AS open_leads FROM leads WHERE tenant_id = ${session.tenantId}::uuid AND status NOT IN ('won','lost','converted')`)
      ).rows[0] as any;

      const tasks = (
        await tx.execute(sql`
          SELECT
            COUNT(*) FILTER (WHERE status IN ('open','in_progress','blocked'))::int AS open_tasks,
            COUNT(*) FILTER (WHERE status IN ('open','in_progress','blocked') AND due_at < now())::int AS overdue_tasks
          FROM tasks WHERE tenant_id = ${session.tenantId}::uuid
        `)
      ).rows[0] as any;

      const sips = (
        await tx.execute(sql`SELECT COUNT(*)::int AS active_sips FROM sips WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active'`)
      ).rows[0] as any;

      const ins = (
        await tx.execute(sql`
          SELECT COUNT(*) FILTER (WHERE status = 'active')::int AS active_policies,
                 COALESCE(SUM(annual_premium) FILTER (WHERE status = 'active'),0)::numeric AS active_annual_premium
          FROM insurance_policies WHERE tenant_id = ${session.tenantId}::uuid
        `)
      ).rows[0] as any;

      const meetings = (
        await tx.execute(sql`SELECT COUNT(*)::int AS upcoming_meetings FROM review_meetings WHERE tenant_id = ${session.tenantId}::uuid AND status IN ('scheduled','confirmed') AND meeting_date >= now()`)
      ).rows[0] as any;

      // AUM by RM (top 8) — answers "who's my biggest RM by book?".
      const byRm = (
        await tx.execute(sql`
          SELECT u.name, COALESCE(SUM(i.aum),0)::numeric AS aum, COUNT(*)::int AS clients
          FROM investors i JOIN users u ON u.id = i.rm_id
          WHERE i.tenant_id = ${session.tenantId}::uuid AND i.status <> 'closed' AND i.deleted_at IS NULL AND i.merged_into_id IS NULL
          GROUP BY u.name ORDER BY aum DESC LIMIT 8
        `)
      ).rows as any[];

      // KYC status breakdown + new clients this month.
      const kyc = (
        await tx.execute(sql`
          SELECT COALESCE(kyc_status,'unknown') AS status, COUNT(*)::int AS n
          FROM investors WHERE tenant_id = ${session.tenantId}::uuid AND deleted_at IS NULL AND status <> 'closed'
          GROUP BY COALESCE(kyc_status,'unknown') ORDER BY n DESC
        `)
      ).rows as any[];

      const extra = (
        await tx.execute(sql`
          SELECT
            COUNT(*) FILTER (WHERE created_at >= date_trunc('month', now()))::int AS new_clients_this_month,
            COUNT(*) FILTER (WHERE created_at >= now() - interval '30 days')::int AS new_clients_30d
          FROM investors WHERE tenant_id = ${session.tenantId}::uuid AND deleted_at IS NULL
        `)
      ).rows[0] as any;

      const activeClients = Number(inv.active_clients);
      const totalAum = Number(inv.total_aum);

      return {
        active_clients: Number(inv.active_clients),
        total_aum_inr: Math.round(Number(inv.total_aum)),
        monthly_sip_book_inr: Math.round(Number(inv.monthly_sip_book)),
        kyc_pending_clients: Number(inv.kyc_pending),
        clients_without_nominee: Number(inv.no_nominee),
        hni_clients: Number(inv.hni_clients),
        dormant_clients_365d: Number(inv.dormant_clients),
        open_leads: Number(leads.open_leads),
        open_tasks: Number(tasks.open_tasks),
        overdue_tasks: Number(tasks.overdue_tasks),
        active_sips: Number(sips.active_sips),
        active_insurance_policies: Number(ins.active_policies),
        active_insurance_annual_premium_inr: Math.round(Number(ins.active_annual_premium)),
        upcoming_meetings: Number(meetings.upcoming_meetings),
        new_clients_this_month: Number(extra.new_clients_this_month),
        new_clients_last_30d: Number(extra.new_clients_30d),
        avg_aum_per_client_inr: activeClients > 0 ? Math.round(totalAum / activeClients) : 0,
        top_clients_by_aum: top.map((t) => ({ name: t.name, aum_inr: Math.round(Number(t.aum)) })),
        aum_by_rm: byRm.map((r) => ({ rm: r.name, aum_inr: Math.round(Number(r.aum)), clients: Number(r.clients) })),
        kyc_status_breakdown: kyc.map((k) => ({ status: k.status, clients: Number(k.n) })),
      };
    });

    const system = `You are the analytics assistant inside an Indian Mutual Fund Distributor's CRM.
Answer the user's question using ONLY the JSON metrics below — these are LIVE, real figures for THIS firm.
Rules:
- Use ONLY these numbers. NEVER invent or estimate a figure that isn't present.
- If the question needs a metric that's not in the snapshot, say you don't track that yet and list 2-3 things you CAN answer.
- Format money in Indian style with the ₹ symbol (e.g. ₹1,23,45,000). Be concise (1-4 sentences or a short list).
- "AUM" = assets under management. "SIP book" = total monthly SIP amount.

LIVE METRICS (JSON):
${JSON.stringify(snapshot, null, 2)}`;

    // Carry prior turns so follow-ups ("…and how many of those are HNI?") resolve.
    const history = (parse.data.history ?? []).slice(-8).map((m) => ({ role: m.role, content: m.content }));
    const res = await aiMessagesClient().messages.create({
      model: "fast",
      max_tokens: 600,
      system,
      messages: [...history, { role: "user", content: parse.data.question }],
    });
    const answer = res.content
      .filter((b) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .trim();

    return NextResponse.json({ answer, metrics: snapshot });
  } catch (err: any) {
    return handleApiError(err);
  }
}
