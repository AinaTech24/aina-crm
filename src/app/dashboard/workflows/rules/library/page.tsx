import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, BookMarked } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { RuleLibraryGrid } from "@/components/workflow-rules/RuleLibraryGrid";

export const dynamic = "force-dynamic";

export default async function RuleLibraryPage() {
  const session = await requireSession();
  if (!can(session.roles, "workflow.edit", session.permissions)) redirect("/dashboard/automations");

  return (
    <div className="space-y-5 max-w-5xl">
      <Link href="/dashboard/automations" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to Automations
      </Link>
      <PageHeaderCard title={<><BookMarked className="size-6 text-muted-foreground" /> Rule Library</>} />
      <RuleLibraryGrid />
    </div>
  );
}
