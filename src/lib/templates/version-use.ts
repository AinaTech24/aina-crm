/**
 * Which version of a message template is the one that gets SENT.
 *
 * `templates.current_version_id` is what `dispatch()` sends, and only while the
 * template's status is `approved`. Every version in the history can be made the
 * current one again ("Use this version") as long as it was approved — a draft,
 * a submitted or a rejected version never reaches a client this way.
 *
 * WhatsApp: Meta approves the template under its key, and the sync worker never
 * writes that back onto the version row, so a submitted version counts as
 * approved once Meta's registry says APPROVED for the key.
 */

export function canUseVersion(
  channel: string,
  approvalStatus: string,
  metaApproved = false
): boolean {
  if (approvalStatus === "approved_external") return true;
  if (channel === "whatsapp") {
    return metaApproved && (approvalStatus === "approved_internal" || approvalStatus === "submitted");
  }
  return approvalStatus === "approved_internal";
}

/** Why a version cannot be used — shown on its disabled button. */
export function cannotUseReason(approvalStatus: string): string {
  switch (approvalStatus) {
    case "draft":
      return "A draft has to be submitted and approved first";
    case "submitted":
      return "Waiting for approval";
    case "rejected":
      return "This version was rejected";
    default:
      return "Only an approved version can be used";
  }
}
