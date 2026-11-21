/**
 * Generic module detail. Looks up the registry config for :module and renders
 * DetailScaffold from the record at <endpoint>/<id>.
 */

import React from "react";
import { useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { DetailScaffold } from "../../../../src/components/DetailScaffold";
import { WebOnlyState } from "../../../../src/components/WebOnlyState";
import { useModuleItem } from "../../../../src/features/list";
import { REGISTRY } from "../../../../src/features/registry";

export default function GenericModuleDetail() {
  const { module, id } = useLocalSearchParams<{ module: string; id: string }>();
  const cfg = REGISTRY[module];
  const qc = useQueryClient();
  // List-only modules have no /[id] endpoint — render from the cached list item.
  const cachedItem = cfg?.listOnly
    ? ((qc.getQueryData([module]) as any[] | undefined) ?? []).find((x) => String(x?.id) === String(id))
    : undefined;
  const { data, isLoading, isError, error, refetch } = useModuleItem<any>(
    `detail:${module}`,
    cfg && !cfg.listOnly ? id : undefined,
    cfg ? `${cfg.endpoint}/${id}` : ""
  );

  if (!cfg) return <WebOnlyState title="Details" webPath={`/dashboard/${module ?? ""}/${id ?? ""}`} />;

  const item = cfg.listOnly ? cachedItem : ((cfg.detailEnvelope && data?.[cfg.detailEnvelope]) || data);
  const spec = item ? cfg.detail(item) : {};
  const title = item ? cfg.card(item).title : cfg.title;

  return (
    <DetailScaffold
      title={title}
      subtitle={spec.subtitle}
      loading={cfg.listOnly ? false : isLoading}
      isError={cfg.listOnly ? false : isError}
      errorMessage={(error as any)?.message}
      onRetry={refetch}
      heroLabel={spec.heroLabel}
      heroValue={spec.heroValue}
      badges={spec.badges}
      fields={spec.fields}
      sections={spec.sections}
    />
  );
}
