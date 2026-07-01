import React from "react";
import { useLocalSearchParams } from "expo-router";
import { DetailScaffold } from "../../../../src/components/DetailScaffold";
import { useModuleItem } from "../../../../src/features/list";
import { srStatusBadge } from "../../../../src/lib/status";
import { titleCase, fmtDate } from "../../../../src/lib/format";

export default function ServiceRequestDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: sr, isLoading, isError, error, refetch } = useModuleItem<any>("service-request", id, `/api/service-requests/${id}`);
  const item = sr?.serviceRequest ?? sr;

  return (
    <DetailScaffold
      title={item?.subject ?? "Request"}
      subtitle={item?.ticketNo ?? undefined}
      loading={isLoading}
      isError={isError}
      errorMessage={(error as any)?.message}
      onRetry={refetch}
      badges={item ? [srStatusBadge(item.status), ...(item.priority ? [{ label: titleCase(item.priority), tone: "neutral" as const, dot: false }] : [])] : []}
      fields={
        item
          ? [
              { label: "Ticket", value: item.ticketNo },
              { label: "Type", value: titleCase(item.type) },
              { label: "Channel", value: titleCase(item.channel) },
              { label: "Priority", value: titleCase(item.priority) },
              { label: "SEBI category", value: titleCase(item.sebiCategory) },
              { label: "Source", value: titleCase(item.complaintSource) },
              { label: "SLA resolution", value: fmtDate(item.slaResolutionAt) },
              { label: "Resolved", value: fmtDate(item.resolvedAt) },
            ]
          : []
      }
      sections={item ? [{ title: "DESCRIPTION", body: item.description }] : []}
    />
  );
}
