import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/content-library/[id]/branded?mode=preview|download
 *
 * Returns the asset's image with the caller's tenant branding strip
 * composited server-side. The raw S3 file URL is NEVER returned to the
 * MFD's browser — this endpoint is the only access path.
 *
 *   mode=preview   → inline (used by the <img> preview on the detail page)
 *   mode=download  → Content-Disposition: attachment (for the Download button)
 *
 * Cache: per-tenant, immutable for 5 minutes (the asset itself never
 * changes; the branding is derived from the caller's session). The cache
 * key embeds tenantId so two tenants can't share a cached payload.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { contentLibraryAssets, tenants } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { composeBrandedImage, type BrandingTenant } from "@/lib/branding/compose";
import { getBrandingTemplate } from "@/lib/branding/templates";
import { assetVisibleTo, fetchAssetBytes } from "@/lib/content/asset-url";

export const dynamic = "force-dynamic";
// sharp needs the Node runtime, not Edge.
export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode") === "download" ? "download" : "preview";
    // Named branding preset (Classic/Minimal/Bold/Split) — maps to a
    // position + heightPct via the shared catalog. Explicit position/h params
    // (below) still win, preserving the original fine-grained controls.
    const templateParam = url.searchParams.get("template");
    // MFD-controllable layout overrides
    const posParam = url.searchParams.get("position");
    const overridePosition: "top" | "bottom" | "both" | "split" | null =
      posParam === "top" || posParam === "bottom" || posParam === "both" || posParam === "split"
        ? posParam
        : null;
    const heightParam = url.searchParams.get("h");
    const overrideHeight = heightParam ? Number(heightParam) : null;

    // Load asset — global OR caller's own (withSystem bypasses RLS, so this
    // predicate is what stops cross-tenant image exfiltration by id).
    const asset = await withSystem(async (tx) =>
      (await tx
        .select()
        .from(contentLibraryAssets)
        .where(and(eq(contentLibraryAssets.id, id), assetVisibleTo(session.tenantId)))
        .limit(1))[0] ?? null
    );
    if (!asset) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (!asset.isActive) return NextResponse.json({ error: "asset inactive" }, { status: 410 });
    if (asset.type !== "image") {
      return NextResponse.json(
        { error: `branded rendering is only supported for image assets (this one is ${asset.type})` },
        { status: 400 }
      );
    }

    const tenant = (await withTenant(session.tenantId, async (tx) =>
      tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1)
    ))[0];
    if (!tenant) return NextResponse.json({ error: "tenant not found" }, { status: 404 });

    // Fetch the source bytes — server-to-server, never exposed to the browser.
    // SSRF-guarded + timed + size-capped (the fileUrl can be tenant-controlled).
    const fetched = await fetchAssetBytes(asset.fileUrl);
    if (!fetched.ok) {
      return NextResponse.json({ error: fetched.error }, { status: fetched.status });
    }
    const sourceBuf = fetched.buf;

    // Build the branding snapshot
    const brand: BrandingTenant = {
      displayName: tenant.displayName ?? null,
      legalName: tenant.legalName ?? null,
      arn: tenant.arn ?? null,
      phone: (tenant as any).phone ?? null,
      email: (tenant as any).email ?? null,
      website: (tenant as any).website ?? null,
      address: (tenant as any).address ?? null,
      logoUrl: (tenant as any).logoUrl ?? null,
      primaryColor: (tenant as any).primaryColor ?? null,
    };

    // Per-request overrides take precedence over the asset's defaults.
    const config = { ...((asset.brandingConfig as any) ?? {}) };
    // Apply the named template first (if supplied), then let any explicit
    // position/height params override it.
    if (templateParam) {
      const t = getBrandingTemplate(templateParam);
      config.position = t.image.position;
      config.heightPct = t.image.heightPct;
    }
    if (overridePosition) config.position = overridePosition;
    if (overrideHeight && overrideHeight >= 5 && overrideHeight <= 50) {
      config.heightPct = overrideHeight;
    }

    const pngBuf = await composeBrandedImage(sourceBuf, brand, config);

    const filename = `${(asset.title ?? "asset").replace(/[^a-zA-Z0-9._-]/g, "_")}-${
      (tenant.arn ?? "").replace(/^ARN-?/i, "")
    }.png`;

    // Tight per-tenant cache. The S3 ETag isn't checked here — invalidate
    // by re-uploading or PATCHing the asset (createdAt changes don't affect
    // the rendered output).
    const headers = new Headers({
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=300",
      "Content-Disposition":
        mode === "download" ? `attachment; filename="${filename}"` : `inline; filename="${filename}"`,
    });
    return new NextResponse(new Uint8Array(pngBuf), { status: 200, headers });
  } catch (err: any) {
    return handleApiError(err);
  }
}
