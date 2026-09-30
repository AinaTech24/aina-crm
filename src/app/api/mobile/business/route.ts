import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { POST as createEntry } from "@/app/api/business-entries/route";
import { POST as createPolicy } from "@/app/api/insurance/route";
import { mobileFirmAccess } from "@/lib/mobile/access";

const Input = z.object({ investorId: z.string().uuid(), rmId: z.string().uuid(), product: z.enum(["sip", "lumpsum", "life", "health", "motor", "other"]),
  amount: z.number().positive().max(1e12), name: z.string().min(1).max(200), provider: z.string().min(1).max(120),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reference: z.string().max(60).default(""), notes: z.string().max(1000).default("") });
export async function GET() {
  try {
    const s = await requireSession();
    if (!s.roles.some(r => ["owner", "branch_head", "rm", "ops", "back_office"].includes(r))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const result = await withTenant(s.tenantId, async tx => {
      const scope = (owner: string) => mobileFirmAccess(s) ? sql`TRUE` : s.roles.includes("branch_head")
        ? (s.branchId ? sql`u.branch_id = ${s.branchId}::uuid` : sql`FALSE`) : sql`${sql.raw(owner)} = ${s.userId}::uuid`;
      const entries = await tx.execute(sql`
        SELECT e.id, e.client_name AS client, e.product_type AS product, e.business_date::text AS date,
          e.total_amount AS amount, e.status, u.name AS rm FROM business_entries e
          LEFT JOIN users u ON u.id = e.rm_id AND u.tenant_id = e.tenant_id
          WHERE e.tenant_id = ${s.tenantId}::uuid AND ${scope("e.rm_id")}
        UNION ALL
        SELECT p.id, i.name AS client, p.policy_type AS product, p.policy_start_date::text AS date,
          p.annual_premium AS amount, p.status, u.name AS rm FROM insurance_policies p
          JOIN investors i ON i.id = p.investor_id AND i.tenant_id = p.tenant_id
          LEFT JOIN users u ON u.id = p.sold_by_user_id AND u.tenant_id = p.tenant_id
          WHERE p.tenant_id = ${s.tenantId}::uuid AND ${scope("p.sold_by_user_id")}
        ORDER BY date DESC NULLS LAST LIMIT 300`);
      const members = await tx.execute(sql`SELECT id, name FROM users WHERE tenant_id = ${s.tenantId}::uuid
        AND status = 'active' AND ${mobileFirmAccess(s) ? sql`TRUE` : s.roles.includes("branch_head") && s.branchId ? sql`branch_id = ${s.branchId}::uuid` : sql`id = ${s.userId}::uuid`} ORDER BY name`);
      return { entries: entries.rows, members: members.rows };
    }, { userId: s.userId, branchId: s.branchId, roles: s.roles });
    return NextResponse.json({ ...result, canEnter: s.roles.some(r => ["ops", "back_office"].includes(r)) });
  } catch (e) { return handleApiError(e); }
}
export async function POST(req: NextRequest) {
  try {
    const s = await requireSession();
    if (!s.roles.some(r => ["ops", "back_office"].includes(r))) return NextResponse.json({ error: "Only Operations can enter business from the mobile app" }, { status: 403 });
    const parsed = Input.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid business entry", issues: parsed.error.issues }, { status: 400 });
    const b = parsed.data;
    const client = await withTenant(s.tenantId, async tx => {
      const member = (await tx.execute(sql`SELECT id FROM users WHERE tenant_id = ${s.tenantId}::uuid AND id = ${b.rmId}::uuid AND status = 'active'`)).rows[0];
      if (!member) throw Object.assign(new Error("Choose an active team member"), { status: 400 });
      return (await tx.execute(sql`SELECT name FROM investors WHERE tenant_id = ${s.tenantId}::uuid AND id = ${b.investorId}::uuid AND deleted_at IS NULL`)).rows[0];
    }, { userId: s.userId, branchId: s.branchId, roles: s.roles });
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });
    const insurance = ["life", "health", "motor"].includes(b.product);
    const payload = insurance ? { investorId: b.investorId, soldByUserId: b.rmId, insurer: b.provider,
      planName: b.name, policyType: b.product === "life" ? "life_other" : b.product, annualPremium: b.amount,
      policyNumber: b.reference || undefined, policyStartDate: b.date, premiumFrequency: "annual", status: "active", remarks: b.notes }
      : { investorId: b.investorId, rmId: b.rmId, clientName: client.name, productType: b.product === "other" ? "other" : "mutual_fund",
        businessDate: b.date, status: "confirmed", amcName: b.provider, folioNo: b.reference, notes: b.notes,
        lines: [{ schemeName: b.name, amcName: b.provider, amount: b.amount, txnType: b.product === "sip" ? "sip" : "lumpsum", frequency: b.product === "sip" ? "monthly" : "one_time" }] };
    // Reuse the web ledger transaction, audit and event creation.
    const forwarded = new NextRequest(new URL(insurance ? "/api/insurance" : "/api/business-entries", req.url), {
      method: "POST", headers: req.headers, body: JSON.stringify(payload),
    });
    return insurance ? createPolicy(forwarded) : createEntry(forwarded);
  } catch (e) { return handleApiError(e); }
}
