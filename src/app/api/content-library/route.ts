/**
 * AINA Content Library — platform-shared.
 *
 *   GET  /api/content-library         — list active assets (any logged-in user)
 *   POST /api/content-library         — register an asset (AINA platform admins only)
 *   POST /api/content-library/upload-url — presigned S3 PUT (AINA only)
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { withPlatformAdmin, withSystem } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { isPlatformAdmin } from "@/lib/platform";
import {
  contentLibraryAssets,
  ASSET_TYPES,
  ASSET_CATEGORIES,
} from "@/db/schema";

export const dynamic = "force-dynamic";

const CreateBody = z.object({
  title: z.string().min(2).max(200),
  description: z.string().max(2000).optional(),
  type: z.enum(ASSET_TYPES),
  category: z.enum(ASSET_CATEGORIES).default("general"),
  fileUrl: z.string().url(),
  fileName: z.string().max(300).optional(),
  fileSizeBytes: z.number().int().nonnegative().optional(),
  mimeType: z.string().max(120).optional(),
  thumbnailUrl: z.string().url().optional(),
  tags: z.array(z.string().max(50)).optional(),
  brandingConfig: z
    .object({
      position: z.enum(["top", "bottom", "both"]).optional(),
      heightPct: z.number().min(5).max(50).optional(),
      background: z.string().optional(),
    })
    .optional(),
  publishAt: z.string().optional(),
  expireAt: z.string().optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    // Allow any logged-in tenant user OR a platform admin to list.
    // Use system context because the table has no tenant_id and the RLS
    // policy already restricts writes to platform admins.
    const rows = await withSystem(async (tx) =>
      tx.select().from(contentLibraryAssets).orderBy(desc(contentLibraryAssets.createdAt))
    );
    const platformAdmin = isPlatformAdmin(session.roles);
    const visible = platformAdmin
      ? rows
      : rows.filter((r) => r.isActive && (!r.expireAt || new Date(r.expireAt) > new Date()));
    // For non-admins, scrub the raw S3 URLs out of image assets — MFDs
    // can only access images via /api/content-library/[id]/branded.
    const safe = platformAdmin
      ? visible
      : visible.map((r) => {
          if (r.type !== "image") return r;
          return {
            ...r,
            fileUrl: `/api/content-library/${r.id}/branded?mode=download`,
            thumbnailUrl: `/api/content-library/${r.id}/branded?mode=preview`,
          };
        });
    return NextResponse.json({ assets: safe });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!isPlatformAdmin(session.roles)) {
      return NextResponse.json({ error: "forbidden — platform admin only" }, { status: 403 });
    }
    const parse = CreateBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json(
        { error: "invalid body", issues: parse.error.issues },
        { status: 400 }
      );
    }
    const body = parse.data;
    const id = uuid();
    await withPlatformAdmin(session.userId, async (tx) => {
      await tx.insert(contentLibraryAssets).values({
        id,
        title: body.title,
        description: body.description ?? null,
        type: body.type,
        category: body.category,
        fileUrl: body.fileUrl,
        fileName: body.fileName ?? null,
        fileSizeBytes: body.fileSizeBytes != null ? String(body.fileSizeBytes) : null,
        mimeType: body.mimeType ?? null,
        thumbnailUrl: body.thumbnailUrl ?? body.fileUrl, // images: self-thumbnail
        tags: body.tags ?? [],
        brandingConfig: body.brandingConfig ?? null,
        publishAt: body.publishAt ? new Date(body.publishAt) : null,
        expireAt: body.expireAt ? new Date(body.expireAt) : null,
        uploadedByUserId: session.userId,
        isActive: true,
      } as any);
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}
