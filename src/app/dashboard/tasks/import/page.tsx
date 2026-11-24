import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { SheetImport } from "@/components/imports/SheetImport";
import { allowedText } from "@/lib/imports/sheet/spec";
import { tasksSpec } from "@/lib/imports/sheet/specs/tasks";

export const dynamic = "force-dynamic";

/** Import tasks from Excel. The API refuses anyone without the capability; this page just sends them back. */
export default async function ImportTasksPage() {
  const session = await requireSession();
  if (!can(session.roles, "task.edit.all", session.permissions)) redirect("/dashboard/tasks");
  return (
    <SheetImport
      label="Tasks"
      singular="task"
      backHref="/dashboard/tasks"
      importUrl="/api/tasks/import"
      sampleUrl="/api/tasks/import/sample"
      maxRows={tasksSpec.maxRows}
      columns={tasksSpec.columns.map((c) => ({ header: c.required ? `${c.header} *` : c.header, required: !!c.required, help: c.help, allowed: allowedText(c) }))}
      notes={tasksSpec.notes}
    />
  );
}
