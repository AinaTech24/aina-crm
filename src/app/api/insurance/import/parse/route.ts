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

// Every field the Add-Policy form captures, so an import can populate the full
// policy record (not just the basics). { key, label } — the label shows in the
// column-mapping dropdown.
const OUR_FIELDS = [
  { key: "clientPan", label: "Client PAN" },
  { key: "insurer", label: "Insurer" },
  { key: "planName", label: "Plan name" },
  { key: "policyNumber", label: "Policy number" },
  { key: "policyType", label: "Policy type" },
  { key: "businessType", label: "Business type" },
  { key: "sumAssured", label: "Sum assured / IDV" },
  { key: "annualPremium", label: "Annual premium" },
  { key: "commission", label: "Commission (₹)" },
  { key: "premiumFrequency", label: "Premium frequency" },
  { key: "premiumPayingTermYears", label: "Premium paying term (yrs)" },
  { key: "policyTermYears", label: "Policy term (yrs)" },
  { key: "livesCovered", label: "Lives covered" },
  { key: "policyStartDate", label: "Policy start date" },
  { key: "maturityDate", label: "Maturity date" },
  { key: "nextPremiumDueDate", label: "Next premium due" },
  { key: "nomineeName", label: "Nominee name" },
  { key: "nomineeRelation", label: "Nominee relation" },
  { key: "nomineeShare", label: "Nominee share %" },
  { key: "proposerName", label: "Proposer name" },
  { key: "proposerPan", label: "Proposer PAN" },
  { key: "status", label: "Status" },
  { key: "remarks", label: "Remarks" },
  { key: "vehicleRegNo", label: "Vehicle reg. no. (motor)" },
  { key: "makeModel", label: "Make / model (motor)" },
  { key: "ncbPercent", label: "NCB % (motor)" },
  { key: "coverType", label: "Cover type (motor)" },
  { key: "roomRentCapInr", label: "Room-rent cap (health)" },
  { key: "coPayPercent", label: "Co-pay % (health)" },
  { key: "preExistingWaitingMonths", label: "Pre-existing waiting mo. (health)" },
  { key: "coverageNotes", label: "Coverage notes (general)" },
  // Policyholder & address
  { key: "holderName", label: "Policyholder name" },
  { key: "customerId", label: "Customer ID" },
  { key: "uin", label: "UIN" },
  { key: "email", label: "Email ID" },
  { key: "mobile", label: "Mobile no" },
  { key: "addressLine1", label: "Address line 1 / street" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "postalCode", label: "Postal code" },
  { key: "country", label: "Country" },
  // Agency & sourcing
  { key: "agencyCode", label: "Agency code" },
  { key: "agencyName", label: "Agency name" },
  { key: "agencyContact", label: "Agency contact no" },
  { key: "agencyEmail", label: "Agency email" },
  // Receipt, payment & tax
  { key: "receiptNo", label: "Receipt no" },
  { key: "receiptDate", label: "Receipt date" },
  { key: "businessChannel", label: "Business channel" },
  { key: "paymentDetails", label: "Payment details" },
  { key: "taxInvoiceNo", label: "Tax invoice no" },
  { key: "taxInvoiceDate", label: "Tax invoice date" },
  { key: "gstin", label: "GSTIN / PAN" },
  { key: "financialYear", label: "Financial year" },
  { key: "eightyDAmount", label: "80-D amount" },
  { key: "grossPremium", label: "Gross premium" },
  // Proposer extras
  { key: "proposerCustomerId", label: "Proposer customer ID" },
  { key: "proposerPhone", label: "Proposer phone" },
  { key: "proposerEmail", label: "Proposer email" },
  { key: "proposerAddressLine1", label: "Proposer address line 1" },
  { key: "proposerCity", label: "Proposer city" },
  { key: "proposerState", label: "Proposer state" },
  { key: "proposerPostalCode", label: "Proposer postal code" },
];

function suggestMapping(headers: string[]): Record<string, string> {
  const m: Record<string, string> = {};
  // Order matters — more specific patterns first.
  const patterns: Array<[RegExp, string]> = [
    [/proposer.?pan/i, "proposerPan"],
    [/proposer/i, "proposerName"],
    [/client.?pan|holder.?pan|^pan$|pan.?no/i, "clientPan"],
    [/insurer|insurance.?co|company/i, "insurer"],
    [/plan.?name|product.?name|^plan$|scheme/i, "planName"],
    [/policy.?(no|number|num)/i, "policyNumber"],
    [/business.?type/i, "businessType"],
    [/policy.?type|^type$|category|product.?type/i, "policyType"],
    [/sum.?assured|sum.?insured|\bidv\b|cover(age)?.?amount|\bsa\b/i, "sumAssured"],
    [/premium.?paying|^ppt$|paying.?term/i, "premiumPayingTermYears"],
    [/policy.?term|term.?years|tenure/i, "policyTermYears"],
    [/lives|members.?covered|no.?of.?lives/i, "livesCovered"],
    [/frequency|freq|payment.?mode|^mode$/i, "premiumFrequency"],
    [/commission|brokerage/i, "commission"],
    [/annual.?premium|premium(?!.*(freq|mode|paying))/i, "annualPremium"],
    [/start.?date|commence|issue.?date|risk.?start/i, "policyStartDate"],
    [/maturity/i, "maturityDate"],
    [/next.?(premium|due)|due.?date|renewal.?date/i, "nextPremiumDueDate"],
    [/nominee.?(share|%|percent)/i, "nomineeShare"],
    [/nominee.?rel/i, "nomineeRelation"],
    [/nominee.?name|^nominee$/i, "nomineeName"],
    [/vehicle|reg.?no|registration/i, "vehicleRegNo"],
    [/make|model/i, "makeModel"],
    [/\bncb\b/i, "ncbPercent"],
    [/cover.?type/i, "coverType"],
    [/room.?rent/i, "roomRentCapInr"],
    [/co.?pay/i, "coPayPercent"],
    [/pre.?exist|waiting/i, "preExistingWaitingMonths"],
    [/coverage.?note|cover.?note/i, "coverageNotes"],
    [/status/i, "status"],
    [/remark|notes?/i, "remarks"],
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
