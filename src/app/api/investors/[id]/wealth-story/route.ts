import { handleApiError } from "@/lib/api/error-handler";
/**
 * Wealth Story — a client-facing, Spotify-Wrapped-style recap of the client's
 * trailing 12 months of investing.
 *
 *   GET  /api/investors/[id]/wealth-story          → story JSON
 *   GET  /api/investors/[id]/wealth-story?pdf=1    → branded PDF (attachment)
 *   POST /api/investors/[id]/wealth-story          → { action: "email", to? }
 *        emails the same PDF to the client (default: investors.email) using
 *        the firm's resolved sender — same pattern as /api/calculators/share.
 *
 * Numbers are honest: "value today" is the live Σ folios.aum snapshot;
 * "you added this year" is actual recorded inflows in the window. No returns
 * are computed or implied.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql, and, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession, type SessionUser } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { investors, folios, tenants } from "@/db/schema";
import { renderCalcPdf, type PdfBlock } from "@/lib/calculators/calc-pdf";
import { fetchBrandLogoBytes } from "@/lib/calculators/share-helpers";
import { pickLogo } from "@/lib/branding/logo";
import { emailAdapter } from "@/lib/comms/adapters/resend";
import { resolveEmailSender } from "@/lib/comms/sender";
import { emailLogoHeaderHtml } from "@/lib/comms/email-logo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ────────────────────────── story shape ────────────────────────── */

type WealthStory = {
  client: { name: string; email: string | null; tenureYears: number; riskProfile: string | null };
  period: { from: string; to: string };
  invested: number;
  withdrawn: number;
  netInvested: number;
  currentValue: number;
  sipInstallments: number;
  sipTotal: number;
  activeMonths: number;
  topHolding: { name: string; value: number } | null;
  holdingsCount: number;
  amcCount: number;
  goals: { name: string; targetAmount: number; progressPct: number | null }[];
  funFacts: string[];
  hasData: boolean;
};

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const monLabel = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

/* ────────────────────────── data loader ────────────────────────── */

async function loadStory(tx: any, tenantId: string, investorId: string): Promise<WealthStory | null> {
  const [inv] = await tx
    .select({
      id: investors.id,
      name: investors.name,
      email: investors.email,
      riskProfile: investors.riskProfile,
      createdAt: investors.createdAt,
      onboardedAt: investors.onboardedAt,
    })
    .from(investors)
    .where(and(eq(investors.id, investorId), eq(investors.tenantId, tenantId), isNull(investors.deletedAt)))
    .limit(1);
  if (!inv) return null;

  const to = new Date();
  const from = new Date(to);
  from.setFullYear(from.getFullYear() - 1);
  const fromIso = isoDate(from);
  const toIso = isoDate(to);

  // One-pass transaction aggregates over the trailing-12-month window.
  const agg = (
    await tx.execute(sql`
      SELECT
        COALESCE(SUM(amount) FILTER (WHERE direction = 'inflow'  AND type IN ('purchase','sip','lumpsum')), 0) AS invested,
        COALESCE(SUM(amount) FILTER (WHERE type IN ('redemption','swp')), 0)                                    AS withdrawn,
        COUNT(*)             FILTER (WHERE type = 'sip')                                                        AS sip_installments,
        COALESCE(SUM(amount) FILTER (WHERE type = 'sip'), 0)                                                    AS sip_total,
        COUNT(DISTINCT date_trunc('month', order_date))
                             FILTER (WHERE direction = 'inflow' AND type IN ('purchase','sip','lumpsum'))       AS active_months,
        COUNT(*)                                                                                                AS tx_count
      FROM transactions
      WHERE investor_id = ${investorId}
        AND order_date >= ${fromIso} AND order_date <= ${toIso}
        AND status NOT IN ('rejected','cancelled','failed')
    `)
  ).rows[0] as any;

  const folioRows = await tx
    .select({ aum: folios.aum, amcName: folios.amcName, schemes: folios.schemes })
    .from(folios)
    .where(and(eq(folios.investorId, investorId), eq(folios.tenantId, tenantId)));

  const currentValue = folioRows.reduce((s: number, f: any) => s + num(f.aum), 0);
  const byScheme = new Map<string, number>();
  const amcs = new Set<string>();
  for (const f of folioRows) {
    if (f.amcName) amcs.add(String(f.amcName).trim().toLowerCase());
    for (const s of (f.schemes ?? []) as any[]) {
      if (!s?.schemeName) continue;
      byScheme.set(s.schemeName, (byScheme.get(s.schemeName) ?? 0) + num(s.value));
    }
  }
  let topHolding: WealthStory["topHolding"] = null;
  for (const [name, value] of byScheme) if (value > 0 && (!topHolding || value > topHolding.value)) topHolding = { name, value };

  const goalRows = (
    await tx.execute(sql`
      SELECT name, target_amount, progress_pct
      FROM goals
      WHERE investor_id = ${investorId} AND status NOT IN ('abandoned')
      ORDER BY target_date ASC
      LIMIT 6
    `)
  ).rows as any[];

  const invested = num(agg?.invested);
  const withdrawn = num(agg?.withdrawn);
  const sipInstallments = num(agg?.sip_installments);
  const sipTotal = num(agg?.sip_total);
  const activeMonths = num(agg?.active_months);
  const txCount = num(agg?.tx_count);

  const anchor = inv.onboardedAt ?? inv.createdAt;
  const tenureYears = anchor ? Math.max(0, Math.round(((Date.now() - new Date(anchor).getTime()) / 31557600000) * 10) / 10) : 0;

  // Deterministic, honest fun-facts — never fabricated, never about returns.
  const funFacts: string[] = [];
  if (sipInstallments >= 10) funFacts.push(`${sipInstallments} SIP installments this year — investing on autopilot. That's real discipline.`);
  if (activeMonths >= 2) funFacts.push(`You added money in ${activeMonths} of the last 12 months.`);
  if (byScheme.size >= 2 && amcs.size >= 1)
    funFacts.push(`Your portfolio spans ${byScheme.size} scheme${byScheme.size === 1 ? "" : "s"} across ${amcs.size} fund house${amcs.size === 1 ? "" : "s"}.`);
  if (funFacts.length < 2 && tenureYears >= 1) funFacts.push(`${tenureYears} year${tenureYears >= 2 ? "s" : ""} of investing together — thank you for the trust.`);

  return {
    client: { name: inv.name, email: inv.email ?? null, tenureYears, riskProfile: inv.riskProfile ?? null },
    period: { from: fromIso, to: toIso },
    invested,
    withdrawn,
    netInvested: invested - withdrawn,
    currentValue,
    sipInstallments,
    sipTotal,
    activeMonths,
    topHolding,
    holdingsCount: byScheme.size,
    amcCount: amcs.size,
    goals: goalRows.map((g) => ({ name: g.name, targetAmount: num(g.target_amount), progressPct: g.progress_pct == null ? null : num(g.progress_pct) })),
    funFacts: funFacts.slice(0, 3),
    hasData: folioRows.length > 0 || txCount > 0 || currentValue > 0,
  };
}

/* ────────────────────────── story → PDF ────────────────────────── */

function storyToBlocks(story: WealthStory): PdfBlock[] {
  const blocks: PdfBlock[] = [];
  blocks.push({
    type: "insight",
    text:
      `This Wealth Story covers ${monLabel(story.period.from)} to ${monLabel(story.period.to)}. ` +
      `"Value today" is the current portfolio value on record; "You added this year" is the money actually invested during the period — this is a recap of recorded activity, not a projection of returns.`,
  });

  blocks.push({ type: "stat", label: "Value today", value: inr(story.currentValue) });
  blocks.push({ type: "stat", label: "You added this year", value: inr(story.invested) });
  blocks.push({ type: "stat", label: "You withdrew", value: inr(story.withdrawn) });
  blocks.push({ type: "stat", label: "Net added this year", value: inr(story.netInvested) });
  blocks.push({ type: "stat", label: "SIP installments", value: String(story.sipInstallments) });
  blocks.push({ type: "stat", label: "Added via SIP", value: inr(story.sipTotal) });
  blocks.push({ type: "stat", label: "Schemes held", value: String(story.holdingsCount) });
  blocks.push({ type: "stat", label: "Fund houses", value: String(story.amcCount) });
  blocks.push({ type: "stat", label: "Investing together for", value: `${story.client.tenureYears} yr${story.client.tenureYears >= 2 ? "s" : ""}` });

  if (story.topHolding) {
    blocks.push({ type: "section", text: "Your top holding" });
    blocks.push({ type: "table", head: ["Scheme", "Value today"], rows: [[story.topHolding.name, inr(story.topHolding.value)]] });
  }

  if (story.goals.length) {
    blocks.push({ type: "section", text: "Goals in motion" });
    blocks.push({
      type: "table",
      head: ["Goal", "Target", "Progress"],
      rows: story.goals.map((g) => [g.name, inr(g.targetAmount), g.progressPct == null ? "-" : `${Math.round(g.progressPct)}%`]),
    });
  }

  if (story.funFacts.length) {
    blocks.push({ type: "section", text: "Highlights of your year" });
    for (const f of story.funFacts) blocks.push({ type: "insight", text: f });
  }

  blocks.push({ type: "section", text: "Important" });
  blocks.push({
    type: "insight",
    text:
      "Mutual fund investments are subject to market risks. Read all scheme related documents carefully. " +
      "Past activity and current values do not indicate or guarantee future returns.",
  });
  return blocks;
}

async function buildStoryPdf(req: NextRequest, session: SessionUser, story: WealthStory, tenant: any) {
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const origin = host ? `${proto}://${host}` : null;
  const logoBytes = await fetchBrandLogoBytes(pickLogo(tenant, "full"), origin);
  const generatedAt = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

  const pdf = await renderCalcPdf({
    firmName: tenant?.legalName ?? tenant?.displayName ?? "Your firm",
    arn: tenant?.arn ?? null,
    preparedBy: session.name,
    firmPhone: tenant?.phone ?? null,
    firmEmail: tenant?.email ?? null,
    firmWebsite: tenant?.website ?? null,
    clientName: story.client.name,
    clientEmail: story.client.email,
    calcName: "Your Wealth Story",
    blocks: storyToBlocks(story),
    logoBytes,
    primaryHex: tenant?.primaryColor ?? null,
    generatedAt,
  });
  const fname = `WealthStory_${story.client.name}`.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 60) + ".pdf";
  return { pdf, fname };
}

/* ────────────────────────── GET ────────────────────────── */

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
    const { id } = await params;
    const wantPdf = req.nextUrl.searchParams.get("pdf") === "1";

    const data = await withTenant(
      session.tenantId,
      async (tx) => {
        const story = await loadStory(tx, session.tenantId, id);
        if (!story) return null;
        if (!wantPdf) return { story, tenant: null as any };
        const tenant = (await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1))[0] ?? null;
        return { story, tenant };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (!wantPdf) return NextResponse.json(data.story);

    const { pdf, fname } = await buildStoryPdf(req, session, data.story, data.tenant);
    return new NextResponse(pdf as any, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${fname}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}

/* ────────────────────────── POST (email to client) ────────────────────────── */

const esc = (s: string) => (s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

const PostBody = z.object({
  action: z.literal("email"),
  to: z.string().max(160).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
    const { id } = await params;
    const parsed = PostBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

    const data = await withTenant(
      session.tenantId,
      async (tx) => {
        const story = await loadStory(tx, session.tenantId, id);
        if (!story) return null;
        const tenant = (await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1))[0] ?? null;
        let sender: any;
        try { sender = await resolveEmailSender(tx, session.tenantId, session.userId); } catch { sender = { source: "resend" }; }
        return { story, tenant, sender };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );
    if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });

    const email = (parsed.data.to ?? data.story.client.email ?? "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json(
        { error: "No valid email for this client — add one to their profile or enter an address." },
        { status: 400 }
      );
    }

    const tenant = data.tenant as any;
    const firmName = tenant?.displayName ?? tenant?.legalName ?? "Your advisor";
    const { pdf, fname } = await buildStoryPdf(req, session, data.story, tenant);

    const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#0f172a;">
      ${emailLogoHeaderHtml(tenant?.logoUrl, firmName)}
      <p>Dear ${esc(data.story.client.name || "Investor")},</p>
      <p>Here's your <strong>year in investing</strong> with ${esc(firmName)} — your personal Wealth Story for the last 12 months, attached as a PDF. ✨</p>
      <p>It covers what you added, your SIP discipline, your top holding and the goals you're building towards. We'd love to walk you through it on a call.</p>
      <p style="margin-top:20px;">Warm regards,<br/><strong>${esc(firmName)}</strong></p>
      <p style="font-size:11px;color:#64748b;margin-top:20px;border-top:1px solid #e2e8f0;padding-top:10px;">Mutual fund investments are subject to market risks. Read all scheme related documents carefully.</p>
    </div>`;

    try {
      const res = await emailAdapter.send({
        tenantId: session.tenantId,
        tokens: {},
        rendered: {
          subject: `Your Wealth Story — a year in investing with ${firmName}`,
          text: `Here's your year in investing with ${firmName} — your Wealth Story PDF is attached.`,
          tokens: {},
        },
        recipient: email,
        category: "transactional",
        inlineHtml: html,
        idempotencyKey: `wealth-story:${session.userId}:${id}:${Date.now()}`,
        smtp: (data.sender as any).smtp,
        apiKey: (data.sender as any).apiKey,
        fromOverride: (data.sender as any).fromEmail || undefined,
        fromNameOverride: (data.sender as any).fromName || firmName,
        replyTo: (data.sender as any).replyTo || undefined,
        attachments: [{ filename: fname, content: pdf }],
      } as any);
      return NextResponse.json({ ok: true, externalId: (res as any)?.externalId ?? null });
    } catch (e: any) {
      const m = String(e?.message ?? "");
      const friendly = /RESEND_API_KEY|EAUTH|invalid login|535|ECONNREFUSED|getaddrinfo|certificate|authentication/i.test(m)
        ? "Couldn't send — check your firm's email connection under Settings → Email."
        : m || "Could not send email";
      return NextResponse.json({ error: friendly }, { status: 502 });
    }
  } catch (err: any) {
    return handleApiError(err);
  }
}
