import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { complianceDocuments } from "@/db/schema";
import { presignedGetUrl } from "@/lib/storage/s3";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    // Same gate as the vault list — compliance + back-office team (owner via can()).
    requireAny(session.roles, ["compliance.view", "kyc.manage"], session.permissions);

    const id = new URL(req.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    const downloadUrl = await withTenant(session.tenantId, async (tx) => {
      const [doc] = await tx
        .select({
          name: complianceDocuments.name,
          storageKey: complianceDocuments.storageKey,
        })
        .from(complianceDocuments)
        .where(and(eq(complianceDocuments.id, id), eq(complianceDocuments.tenantId, session.tenantId)))
        .limit(1);

      if (!doc) {
        throw new Error("Document not found or unauthorized access");
      }

      // Generate a presigned S3 download URL valid for 10 minutes (600 seconds)
      return await presignedGetUrl(doc.storageKey, 600, doc.name);
    });

    const redirectUrl = downloadUrl.startsWith("/")
      ? new URL(downloadUrl, req.url).toString()
      : downloadUrl;

    return NextResponse.redirect(redirectUrl);
  } catch (err: any) {
    return handleApiError(err);
  }
}
