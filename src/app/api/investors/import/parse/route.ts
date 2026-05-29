import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/investors/import/parse
 * multipart/form-data: file=<xlsx|csv>
 *
 * Parses the uploaded file in memory and returns:
 *   { headers: string[], rows: object[], suggestedMapping: Record<headerKey, ourField> }
 *
 * Does NOT touch the DB — that's the commit step.
 */

import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const OUR_FIELDS = [
  "name",
  "pan",
  "email",
  "phone",
  "whatsappPhone",
  "dob",
  "segmentTag",
  "investorCategory",
  "city",
  "state",
  "pincode",
  "nomineeName",
  "nomineeRelation",
  "bankName",
  "bankAccountNumberMasked",
  "bankIfsc",
];

/** Heuristic header → field guesser. */
function suggestMapping(headers: string[]): Record<string, string> {
  const m: Record<string, string> = {};
  const patterns: Array<[RegExp, string]> = [
    [/^name|client.?name|investor.?name|full.?name/i, "name"],
    [/^pan|pan.?card|pan.?no/i, "pan"],
    [/^email|e.?mail/i, "email"],
    [/^phone$|mobile|contact/i, "phone"],
    [/whatsapp|wa.?no/i, "whatsappPhone"],
    [/dob|birth|date.?of.?birth/i, "dob"],
    [/segment|tier|class/i, "segmentTag"],
    [/category|type/i, "investorCategory"],
    [/^city|town/i, "city"],
    [/^state|province/i, "state"],
    [/pincode|pin.?code|zip/i, "pincode"],
    [/nominee.?name|nominee$/i, "nomineeName"],
    [/nominee.?rel/i, "nomineeRelation"],
    [/bank.?name/i, "bankName"],
    [/account.?no|a\/c|bank.?ac/i, "bankAccountNumberMasked"],
    [/ifsc/i, "bankIfsc"],
  ];
  for (const h of headers) {
    for (const [re, field] of patterns) {
      if (re.test(h)) {
        m[h] = field;
        break;
      }
    }
  }
  return m;
}

export async function POST(req: NextRequest) {
  try {
    await requireSession();
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file required" }, { status: 400 });
    }
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "file too large (max 10MB)" }, { status: 413 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) {
      return NextResponse.json({ error: "no sheet found" }, { status: 400 });
    }

    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "", raw: false });
    if (rows.length === 0) {
      return NextResponse.json({ error: "empty sheet" }, { status: 400 });
    }
    if (rows.length > 5000) {
      return NextResponse.json({ error: "too many rows (max 5000 per import)" }, { status: 413 });
    }

    const headers = Object.keys(rows[0]);
    const suggested = suggestMapping(headers);

    // Return only first 200 rows for the preview UI; the commit step re-parses the file.
    return NextResponse.json({
      headers,
      ourFields: OUR_FIELDS,
      suggestedMapping: suggested,
      rows: rows.slice(0, 200),
      total: rows.length,
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
