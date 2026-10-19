/**
 * A risk profile the client already holds, recorded by uploading its PDF.
 *
 *   GET  /api/risk-profiles/upload?investorId=…   the client's current profile (for the form's "this replaces…" note)
 *   POST /api/risk-profiles/upload                multipart: file (PDF) + investorId, category, score, assessedOn, expiresOn,
 *                                                 assessedBy?, remarks?
 *
 * Everything is checked BEFORE the file is stored: the client is in the
 * viewer's book, a minor is refused, the dates make sense, the file really is a
 * PDF. See lib/risk-profile/upload.ts for what is recorded and why.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { clientMetaFromHeaders } from "@/lib/audit";
import { handleApiError } from "@/lib/api/error-handler";
import { loadViewableInvestor } from "@/lib/investors/access";
import { isS3Configured, putObject, vaultKey } from "@/lib/storage/s3";
import { firmFolderName } from "@/lib/storage/firm-folder";
import { indiaToday } from "@/lib/fixed-deposits/terms";
import { riskExpiresOn } from "@/lib/risk-profile/expiry";
import {
  MAX_PDF_BYTES,
  UploadFieldsSchema,
  recordUploadedRiskProfile,
  validateUploadDates,
  type CurrentRiskProfile,
} from "@/lib/risk-profile/upload";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const day = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/** A real PDF starts with "%PDF-" within its first kilobyte. */
function looksLikePdf(buf: Buffer): boolean {
  return buf.subarray(0, 1024).includes("%PDF-");
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
    const investorId = new URL(req.url).searchParams.get("investorId") ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(investorId)) return NextResponse.json({ error: "investorId is required" }, { status: 400 });

    const out = await withTenant(session.tenantId, async (tx) => {
      const inv = await loadViewableInvestor(tx, session, investorId);
      if (!inv) return null;
      let guardianName: string | null = null;
      if (inv.investorCategory === "minor" && inv.guardianInvestorId) {
        const g = await loadViewableInvestor(tx, session, inv.guardianInvestorId);
        guardianName = g?.name ?? "the guardian";
      }
      const current: CurrentRiskProfile | null = inv.riskProfile
        ? {
            category: inv.riskProfile,
            score: inv.riskProfileScore ?? null,
            signedAt: day(inv.riskProfileSignedAt),
            expiresOn: day(riskExpiresOn(inv)),
            provisional: !!inv.riskProfileProvisional,
          }
        : null;
      return { id: inv.id, name: inv.name, minorOf: guardianName, current };
    });
    if (!out) return NextResponse.json({ error: "Client not found" }, { status: 404 });
    return NextResponse.json(out);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "risk_profile.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const form = await req.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });

    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Attach the client's risk profile as a PDF." }, { status: 400 });
    }
    if (file.size > MAX_PDF_BYTES) {
      return NextResponse.json({ error: `The PDF is too large — the limit is ${MAX_PDF_BYTES / 1024 / 1024} MB.` }, { status: 413 });
    }

    const raw = Object.fromEntries(
      ["investorId", "category", "score", "assessedOn", "expiresOn", "assessedBy", "remarks"].map((k) => [k, form.get(k) ?? undefined]),
    );
    const parsed = UploadFieldsSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid fields", issues: parsed.error.issues }, { status: 400 });
    }
    const fields = parsed.data;
    const today = indiaToday();
    const dateError = validateUploadDates(fields.assessedOn, fields.expiresOn, today);
    if (dateError) return NextResponse.json({ error: dateError }, { status: 400 });

    const buf = Buffer.from(await file.arrayBuffer());
    if (!looksLikePdf(buf)) {
      return NextResponse.json({ error: "That file is not a PDF. Upload the risk profile as a PDF." }, { status: 400 });
    }

    // Check the client BEFORE storing anything.
    const investor = await withTenant(session.tenantId, (tx) => loadViewableInvestor(tx, session, fields.investorId));
    if (!investor) return NextResponse.json({ error: "Client not found" }, { status: 404 });
    if (investor.investorCategory === "minor" && investor.guardianInvestorId) {
      return NextResponse.json({ error: "A minor's risk profile is the guardian's — upload it on the guardian's record." }, { status: 409 });
    }

    const key = vaultKey(session.tenantId, "kyc", file.name || "risk-profile.pdf", {
      firm: await firmFolderName(session.tenantId),
      uploader: session.name,
      client: investor.name,
      docType: "risk_profile",
    });
    try {
      await putObject(key, buf, "application/pdf");
    } catch (e: any) {
      const detail = e?.name || e?.Code || e?.message || "unknown error";
      return NextResponse.json(
        { error: isS3Configured() ? `Storage upload failed (${detail}).` : `Local storage write failed (${detail}).` },
        { status: 502 },
      );
    }

    const result = await withTenant(session.tenantId, async (tx) => {
      // Re-read inside the write's transaction: the newest-wins check needs the current signed date.
      const fresh = await loadViewableInvestor(tx, session, fields.investorId);
      if (!fresh) throw Object.assign(new Error("Client not found"), { status: 404 });
      return recordUploadedRiskProfile(tx, {
        tenantId: session.tenantId,
        userId: session.userId,
        investor: fresh,
        fields,
        documentKey: key,
        today,
        clientMeta: clientMetaFromHeaders(req.headers),
      });
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
