import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/leads/import/parse  multipart/form-data: file=<xlsx|csv>
 * Returns parsed headers + suggested mapping + first 200 rows for preview.
 */

import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

const OUR_FIELDS = [
  "name", "email", "phone", "city", "source", "campaignName", "interestedIn",
  "intendedAmount", "stage", "score", "nextFollowUpAt", "notes",
];

function suggestMapping(headers: string[]): Record<string, string> {
  const m: Record<string, string> = {};
  const patterns: Array<[RegExp, string]> = [
    [/^(lead.?)?name|full.?name/i, "name"],
    [/^email|e.?mail/i, "email"],
    [/^phone$|mobile|contact/i, "phone"],
    [/^city|town/i, "city"],
    [/source/i, "source"],
    [/campaign/i, "campaignName"],
    [/interest|product/i, "interestedIn"],
    [/(intended|investment|amount).*amount|amount/i, "intendedAmount"],
    [/stage|status/i, "stage"],
    [/score/i, "score"],
    [/next.?follow|follow.?up.?date/i, "nextFollowUpAt"],
    [/note|remark/i, "notes"],
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
    const session = await requireSession();
    // Importing the firm's book is a manager action — gate parse with the same
    // capability as the commit step (was requireSession-only).
    requireCap(session.roles, "lead.edit.all", session.permissions);
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
    if (rows.length > 5000) return NextResponse.json({ error: "too many rows (max 5000)" }, { status: 413 });

    const headers = Object.keys(rows[0]);
    return NextResponse.json({
      headers,
      ourFields: OUR_FIELDS,
      suggestedMapping: suggestMapping(headers),
      rows: rows.slice(0, 200),
      total: rows.length,
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
