/**
 * The PDF response for the client and family reports: the firm's branding,
 * the footer note, and the attachment headers. SERVER-ONLY.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { tenants } from "@/db/schema";
import { fetchBrandLogoBytes } from "@/lib/calculators/share-helpers";
import { pickLogo } from "@/lib/branding/logo";
import { formatDate } from "@/lib/format";
import { renderClientReportPdf } from "./client-report-pdf";
import type { ClientReport } from "./client-report";

export async function reportPdfResponse(
  req: NextRequest,
  tenant: typeof tenants.$inferSelect | undefined,
  report: ClientReport,
  opts: { title: string; filePrefix: string },
): Promise<NextResponse> {
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const logoBytes = await fetchBrandLogoBytes(tenant ? pickLogo(tenant, "full") : null, host ? `${proto}://${host}` : null);
  const firmName = tenant?.legalName || tenant?.displayName || "Your firm";

  const pdf = await renderClientReportPdf({
    brand: {
      firmName,
      arn: tenant?.arn ?? null,
      primaryColor: tenant?.primaryColor ?? null,
      secondaryColor: tenant?.secondaryColor ?? null,
      logoBytes,
    },
    title: opts.title,
    clientName: report.clientName,
    subtitles: report.subtitles,
    footerNote:
      `Confidential - prepared by ${firmName} for ${report.clientName} on ${formatDate(new Date())}. ` +
      "Figures are as recorded in the CRM; mutual fund values use the latest NAV available and are indicative. " +
      "Mutual fund investments are subject to market risks; read all scheme related documents carefully.",
    blocks: report.blocks,
  });

  const safe = report.clientName.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "").slice(0, 40) || "report";
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${opts.filePrefix}_${safe}_${new Date().toISOString().slice(0, 10)}.pdf"`,
      "cache-control": "no-store",
    },
  });
}
