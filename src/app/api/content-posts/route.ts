import { handleApiError } from "@/lib/api/error-handler";
/**
 * Content posts collection.
 *   GET  /api/content-posts
 *   POST /api/content-posts
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { scanCaption } from "@/lib/content/scan";
import {
  campaigns,
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
        name: z.string().max(300),
        url: z.string().max(2000),
        kind: z.enum(["image", "video", "doc"]).optional(),
      })
    )
    .max(20)
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
    requireCap(session.roles, "content_calendar.manage");
    const rows = await withTenant(session.tenantId, async (tx) =>
      tx
        .select()
        .from(contentPosts)
        .where(eq(contentPosts.tenantId, session.tenantId))
        .orderBy(desc(contentPosts.contentDate))
    );
    return NextResponse.json({ posts: rows });
  } catch (err: any) {
    return handleApiError(err);
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
    const id = uuid();
    const clientMeta = clientMetaFromHeaders(req.headers);

    // A post always starts UNGATED. Compliance check, approval, and posting are
    // deliberate, audited later steps — you cannot create-and-publish, nor
    // self-pre-approve, in one shot (the compliance + approval gates would be
    // meaningless otherwise). Client-supplied approved/posted/checked are dropped.
    const startApproval = body.approvalStatus === "approved" ? "pending" : (body.approvalStatus ?? "pending");

    let scan: Awaited<ReturnType<typeof scanCaption>> = null;
    await withTenant(session.tenantId, async (tx) => {
      if (body.campaignId) {
        const [c] = await tx
          .select({ id: campaigns.id })
          .from(campaigns)
          .where(and(eq(campaigns.id, body.campaignId), eq(campaigns.tenantId, session.tenantId)))
          .limit(1);
        if (!c) throw Object.assign(new Error("Linked campaign not found in this tenant."), { status: 400 });
      }

      scan = await scanCaption(tx, session.tenantId, body.caption);

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
        complianceChecked: false,
        complianceCheckedAt: null,
        complianceCheckedByUserId: null,
        complianceNotes: body.complianceNotes ?? null,
        complianceScan: scan as any,
        approvalStatus: startApproval,
        approvedByUserId: null,
        approvedAt: null,
        postedStatus: "not_posted",
        postedAt: null,
        postLink: null,
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
        after: { platform: body.platform, topic: body.topic, contentDate: body.contentDate },
        ...clientMeta,
      });
    });

    return NextResponse.json({ id, complianceScan: scan }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
