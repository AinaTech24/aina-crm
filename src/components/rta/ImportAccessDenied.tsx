/**
 * Shown by the RTA import pages when lib/rta/import-access refuses the viewer —
 * an explanation, not a 404 and not the global error screen.
 */
import { ShieldAlert } from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";

export function ImportAccessDenied({ message }: { message: string }) {
  return (
    <div className="mt-6">
      <EmptyState
        icon={ShieldAlert}
        title="You don't have access to RTA imports"
        description={message}
        primary={{ href: "/dashboard", label: "Back to dashboard" }}
      />
    </div>
  );
}
