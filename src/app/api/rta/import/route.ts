/**
 * RTA reverse-feed import.
 *   POST /api/rta/import   (multipart/form-data)
 *     file       — the RTA mailback .csv OR password-protected .zip
 *     password   — zip password (only when uploading a .zip; never persisted)
 *     dryRun     — "1" to preview (parse + counts, no DB writes)
 *     assignToMe — "1" to set rmId = current user on newly-created investors
 *
 * Detects the RTA + report type from the file header, parses it, and (unless
 * dryRun) upserts investors + folios. Returns a summary either way.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { parseRtaCsv } from "@/lib/rta";
import { importRtaFolios } from "@/lib/rta/import";
import { extractRtaCsvFromZip } from "@/lib/rta/unzip";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    // Importing the client master is an admin action — owners + ops/back-office.
    const allowed =
      can(session.roles, "investor.edit.all", session.permissions) ||
      can(session.roles, "dashboard.view.owner", session.permissions);
    if (!allowed) {
      return NextResponse.json({ error: "You don't have permission to import the client master." }, { status: 403 });
    }

    const form = await req.formData();
    const file = form.get("file");
    const password = (form.get("password") as string) || undefined;
    const dryRun = form.get("dryRun") === "1";
    const assignToMe = form.get("assignToMe") === "1";

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }

    const buf = new Uint8Array(await file.arrayBuffer());

    // Decode: a zip (PK magic) is unzipped with the password; otherwise treat as
    // a raw CSV (latin-1).
    let text: string;
    const isZip = buf.length > 1 && buf[0] === 0x50 && buf[1] === 0x4b;
    if (isZip) {
      try {
        const r = await extractRtaCsvFromZip(buf, password);
        text = r.text;
      } catch (e: any) {
        return NextResponse.json(
          { error: `Could not open the zip — ${e?.message ?? "wrong password or unsupported archive"}.` },
          { status: 400 }
        );
      }
    } else {
      text = new TextDecoder("latin1").decode(buf);
    }

    const parsed = parseRtaCsv(text);
    if (parsed.source === "unknown" || parsed.folios.length === 0) {
      return NextResponse.json(
        {
          error: parsed.warnings[0] ?? "Unrecognised RTA file — header did not match a known report.",
          source: parsed.source,
          reportType: parsed.reportType,
          totalRows: parsed.totalRows,
        },
        { status: 400 }
      );
    }

    // Validate the file against what the user selected in the guided flow.
    const selectedRta = ((form.get("rta") as string) || "").trim();
    const selectedReport = ((form.get("reportType") as string) || "").trim();
    if (selectedRta && parsed.source !== selectedRta) {
      return NextResponse.json(
        { error: `You selected ${selectedRta.toUpperCase()}, but this file looks like ${parsed.source.toUpperCase()} ${parsed.reportType}. Pick the matching RTA, or the right file.` },
        { status: 400 }
      );
    }
    if (selectedReport && parsed.reportType && selectedReport !== parsed.reportType) {
      return NextResponse.json(
        { error: `You selected file type ${selectedReport}, but this file is ${parsed.reportType}. Pick the matching file type.` },
        { status: 400 }
      );
    }

    const summary = await withTenant(
      session.tenantId,
      (tx) =>
        importRtaFolios(tx as any, session.tenantId, parsed.folios, {
          dryRun,
          assignRmId: assignToMe ? session.userId : null,
          reportType: parsed.reportType,
          kind: parsed.kind === "holdings" ? "holdings" : "master",
        }),
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    return NextResponse.json({
      ok: true,
      source: parsed.source,
      reportType: parsed.reportType,
      totalRows: parsed.totalRows,
      missingPan: parsed.missingPan,
      summary,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
