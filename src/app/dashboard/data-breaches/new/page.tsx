import { ShieldAlert } from "lucide-react";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { EmptyState } from "@/components/common/EmptyState";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { NewBreachForm } from "./NewBreachForm";

export const dynamic = "force-dynamic";

export default async function NewDataBreachPage() {
  const session = await requireSession();
  if (!can(session.roles, "compliance.edit", session.permissions)) {
    return (
      <div className="mt-6">
        <EmptyState icon={ShieldAlert} title="Report it to your compliance officer" description="Only the compliance officer or the owner logs a breach. Tell them at once — the firm has 72 hours to report it." primary={{ href: "/dashboard", label: "Back to dashboard" }} />
      </div>
    );
  }
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeaderCard title="Log a breach" breadcrumb={[{ label: "Data breaches", href: "/dashboard/data-breaches" }, { label: "Log a breach" }]} />
      <NewBreachForm />
    </div>
  );
}
