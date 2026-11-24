import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { SheetImport } from "@/components/imports/SheetImport";
import { allowedText } from "@/lib/imports/sheet/spec";
import { meetingsSpec } from "@/lib/imports/sheet/specs/meetings";

export const dynamic = "force-dynamic";

/** Import meetings from Excel. The API refuses anyone without the capability; this page just sends them back. */
export default async function ImportMeetingsPage() {
  const session = await requireSession();
  if (!can(session.roles, "review_meeting.manage.all", session.permissions)) redirect("/dashboard/review-meetings");
  return (
    <SheetImport
      label="Meetings"
      singular="meeting"
      backHref="/dashboard/review-meetings"
      importUrl="/api/review-meetings/import"
      sampleUrl="/api/review-meetings/import/sample"
      maxRows={meetingsSpec.maxRows}
      columns={meetingsSpec.columns.map((c) => ({ header: c.required ? `${c.header} *` : c.header, required: !!c.required, help: c.help, allowed: allowedText(c) }))}
      notes={meetingsSpec.notes}
    />
  );
}
