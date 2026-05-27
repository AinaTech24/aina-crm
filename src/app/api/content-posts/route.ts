/**
 * Content posts collection.
 *   GET  /api/content-posts
 *   POST /api/content-posts
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import {
  contentPosts,
  POST_PLATFORMS,
  POST_CONTENT_TYPES,
  POST_APPROVAL_STATUSES,
  POST_POSTING_STATUSES,
} from "@/db/schema";

export const dynamic = "force-dynamic";

const CreateBody = z.object({
  contentDate: z.string(),
  platform: z.enum(POST_PLATFORMS),
  contentType: z.enum(POST_CONTENT_TYPES).default("image_post"),
  topic: z.string().min(1).max(200),
  caption: z.string().max(5000).optional(),
  creativeFiles: z
    .array(
      z.object({
        name: z.string(),
        url: z.string(),
        kind: z.enum(["image", "video", "doc"]).optional(),
      })
    )
    .optional(),
  complianceChecked: z.boolean().optional(),
  complianceNotes: z.string().max(1000).optional(),
  approvalStatus: z.enum(POST_APPROVAL_STATUSES).optional(),
  approvedByUserId: z.string().uuid().optional(),
  postedStatus: z.enum(POST_POSTING_STATUSES).optional(),
  postLink: z.string().max(500).optional(),
  campaignId: z.string().uuid().optional(),
  remarks: z.string().max(1000).optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    const rows = await withTenant(session.tenantId, async (tx) =>
      tx.select().from(contentPosts).orderBy(desc(contentPosts.contentDate))
    );
    return NextResponse.json({ posts: rows });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "content_calendar.manage");
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = CreateBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json(
        { error: "invalid body", issues: parse.error.issues },
        { status: 400 }
      );
    }
    const body = parse.data;
    // Defensive: even on POST, refuse to set posted_status='posted' without both gates.
    if (body.postedStatus === "posted") {
      const okCompliance = body.complianceChecked === true;
      const okApproval = body.approvalStatus === "approved";
      if (!okCompliance || !okApproval) {
        return NextResponse.json(
          {
            error:
              "Cannot create a post in 'posted' state until compliance is checked and approval is granted.",
            blockedBy: { compliance: !okCompliance, approval: !okApproval },
          },
          { status: 409 }
        );
      }
    }

    const id = uuid();
    const clientMeta = clientMetaFromHeaders(req.headers);

    await withTenant(session.tenantId, async (tx) => {
      const now = new Date();
      await tx.insert(contentPosts).values({
        id,
        tenantId: session.tenantId,
        branchId: session.branchId ?? null,
        contentDate: body.contentDate,
        platform: body.platform,
        contentType: body.contentType,
        topic: body.topic,
        caption: body.caption ?? null,
        creativeFiles: body.creativeFiles ?? [],
        complianceChecked: body.complianceChecked ?? false,
        complianceCheckedAt: body.complianceChecked ? now : null,
        complianceCheckedByUserId: body.complianceChecked ? session.userId : null,
        complianceNotes: body.complianceNotes ?? null,
        approvalStatus: body.approvalStatus ?? "pending",
        approvedByUserId: body.approvalStatus === "approved" ? session.userId : null,
        approvedAt: body.approvalStatus === "approved" ? now : null,
        postedStatus: body.postedStatus ?? "not_posted",
        postedAt: body.postedStatus === "posted" ? now : null,
        postLink: body.postLink ?? null,
        campaignId: body.campaignId ?? null,
        remarks: body.remarks ?? null,
        createdByUserId: session.userId,
      } as any);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "content_post.create",
        entityType: "content_post",
        entityId: id,
        after: {
          platform: body.platform,
          topic: body.topic,
          contentDate: body.contentDate,
        },
        ...clientMeta,
      });
    });

    return NextResponse.json({ id }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "internal" },
      { status: err.status ?? 500 }
    );
  }
}
