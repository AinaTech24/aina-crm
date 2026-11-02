import { ShieldCheck } from "lucide-react";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { EmptyState } from "@/components/common/EmptyState";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { NewPrivacyRequestForm } from "./NewPrivacyRequestForm";

export const dynamic = "force-dynamic";

export default async function NewPrivacyRequestPage() {
  const session = await requireSession();
  if (!can(session.roles, "compliance.edit", session.permissions)) {
    return (
      <div className="mt-6">
        <EmptyState
          icon={ShieldCheck}
          title="Only the compliance officer can log a privacy request"
          description="Pass the request to your compliance officer or the firm owner."
          primary={{ href: "/dashboard", label: "Back to dashboard" }}
        />
      </div>
    );
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeaderCard
        title="New privacy request"
        breadcrumb={[{ label: "Privacy requests", href: "/dashboard/privacy-requests" }, { label: "New request" }]}
      />
      <NewPrivacyRequestForm today={today} />
    </div>
  );
}
