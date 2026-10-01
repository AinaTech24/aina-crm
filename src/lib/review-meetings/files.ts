/**
 * Files uploaded to a meeting. SERVER-ONLY.
 *
 * A meeting's Attachments list (`review_meetings.attachments`, jsonb) holds
 * pasted links and, since this, uploaded files. A file entry is
 * `{ name, url: "", fileId, size }`; the bytes live in object storage under a
 * key derived from the meeting and the file id (`fileKey`), so the entry needs
 * no storage path of its own and the meeting editor's Save — which rewrites
 * the whole list — cannot lose it as long as it keeps `fileId`.
 *
 * Who may: the people who may edit the meeting — meeting managers, its RM,
 * and a team member listed as attending (`attendees` kind "user"), the same
 * rule as the meeting page itself.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";

export const MEETING_FILE_MAX_BYTES = 25 * 1024 * 1024; // 25 MB, as task attachments

export function fileKey(tenantId: string, meetingId: string, fileId: string): string {
  return `tenants/${tenantId}/meetings/${meetingId}/${fileId}`;
}

export type MeetingFileEntry = { name: string; url: string; fileId: string; size?: number; uploadedAt?: string };

/** The meeting's attachments if this user may work on it, else null. */
export async function loadMeetingForFiles(
  tx: Tx, session: SessionUser, meetingId: string,
): Promise<{ attachments: Array<Record<string, unknown>> } | null> {
  const r = (await tx.execute(sql`
    SELECT rm_id, attachments, attendees FROM review_meetings
     WHERE id = ${meetingId}::uuid AND tenant_id = ${session.tenantId}::uuid
  `)).rows[0] as { rm_id: string | null; attachments: unknown; attendees: unknown } | undefined;
  if (!r) return null;
  const canAll = can(session.roles, "review_meeting.manage.all", session.permissions);
  const attends = Array.isArray(r.attendees)
    && (r.attendees as Array<Record<string, unknown>>).some((a) => a?.kind === "user" && a?.refId === session.userId);
  if (!canAll && r.rm_id !== session.userId && !attends) return null;
  return { attachments: Array.isArray(r.attachments) ? (r.attachments as Array<Record<string, unknown>>) : [] };
}

/** A content type for the download, from the file name. */
export function contentTypeFor(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = {
    pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
    doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    csv: "text/csv", txt: "text/plain",
  };
  return map[ext] ?? "application/octet-stream";
}
