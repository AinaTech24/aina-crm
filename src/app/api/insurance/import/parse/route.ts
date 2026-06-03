import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/insurance/import/parse — File Import (Zoho parity) for the
 * insurance policy book. Parses an xlsx/csv in memory and returns headers +
 * our mappable fields + a heuristic auto-mapping. No DB writes (that's commit).
 */

import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const OUR_FIELDS = [
  "clientPan", "insurer", "planName", "policyNumber", "policyType",
  "sumAssured", "annualPremium", "premiumFrequency",
  "policyStartDate", "maturityDate", "nextPremiumDueDate",
  "nomineeName", "nomineeRelation",
];

function suggestMapping(headers: string[]): Record<string, string> {
  const m: Record<string, string> = {};
  const patterns: Array<[RegExp, string]> = [
    [/pan|client.?pan|holder.?pan/i, "clientPan"],
    [/insurer|company|insurance.?co/i, "insurer"],
    [/plan|product.?name|scheme/i, "planName"],
    [/policy.?(no|number|num)/i, "policyNumber"],
    [/policy.?type|type|category|product.?type/i, "policyType"],
    [/sum.?assured|cover|sum.?insured|sa\b/i, "sumAssured"],
    [/premium(?!.*freq)|annual.?premium/i, "annualPremium"],
    [/frequency|freq|mode|payment.?mode/i, "premiumFrequency"],
    [/start.?date|commence|issue.?date|risk.?start/i, "policyStartDate"],
    [/maturity/i, "maturityDate"],
    [/next.?(premium|due)|due.?date|renewal.?date/i, "nextPremiumDueDate"],
    [/nominee.?name|nominee$/i, "nomineeName"],
    [/nominee.?rel/i, "nomineeRelation"],
  ];
  for (const h of headers) for (const [re, f] of patterns) if (re.test(h)) { m[h] = f; break; }
  return m;
}

export async function POST(req: NextRequest) {
  try {
    await requireSession();
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });
    if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "file too large (max 10MB)" }, { status: 413 });

    const buf = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) return NextResponse.json({ error: "no sheet found" }, { status: 400 });
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "", raw: false });
    if (rows.length === 0) return NextResponse.json({ error: "empty sheet" }, { status: 400 });
    if (rows.length > 5000) return NextResponse.json({ error: "too many rows (max 5000 per import)" }, { status: 413 });

    const headers = Object.keys(rows[0]);
    return NextResponse.json({
      headers,
      ourFields: OUR_FIELDS,
      suggestedMapping: suggestMapping(headers),
      rows: rows.slice(0, 1000),
      total: rows.length,
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
