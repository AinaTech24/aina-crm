import React from "react";
import { ModuleList } from "../../../../src/components/ModuleList";
import { GenericCard } from "../../../../src/components/domain/GenericCard";
import { useModuleList } from "../../../../src/features/list";
import { srStatusBadge } from "../../../../src/lib/status";
import { titleCase } from "../../../../src/lib/format";

const CHIPS = [
  { key: "", label: "All" },
  { key: "open", label: "Open" },
  { key: "in_progress", label: "In Progress" },
  { key: "resolved", label: "Resolved" },
  { key: "closed", label: "Closed" },
];

export default function ServiceRequests() {
  return (
    <ModuleList<any>
      title="Service Requests"
      unit={["request", "requests"]}
      useData={() => useModuleList("service-requests", "/api/service-requests", "serviceRequests")}
      chips={CHIPS}
      filterFn={(sr, q, f) =>
        (!f || sr.status === f) &&
        (!q || `${sr.subject ?? ""} ${sr.ticketNo ?? ""} ${sr.type ?? ""}`.toLowerCase().includes(q.toLowerCase()))
      }
      renderCard={(sr, open) => (
        <GenericCard
          icon="headphones"
          title={sr.subject ?? titleCase(sr.type) ?? "Request"}
          subtitle={`${sr.ticketNo ?? ""} · ${titleCase(sr.type)}`}
          badge={srStatusBadge(sr.status)}
          badge2={sr.priority ? { label: titleCase(sr.priority), tone: "neutral" } : undefined}
          onPress={open}
        />
      )}
      hrefFor={(sr) => `/m/service-requests/${sr.id}`}
      searchPlaceholder="Search ticket, subject…"
      emptyIcon="headphones"
      emptyTitle="No service requests"
      emptyMessage="Client service tickets and complaints will appear here."
    />
  );
}
