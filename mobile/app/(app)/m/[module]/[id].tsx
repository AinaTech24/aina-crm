/**
 * Generic module detail. Looks up the registry config for :module and renders
 * DetailScaffold from the record at <endpoint>/<id>.
 */

import React from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { DetailScaffold } from "../../../../src/components/DetailScaffold";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { ErrorState } from "../../../../src/components/states";
import { useModuleItem } from "../../../../src/features/list";
import { REGISTRY } from "../../../../src/features/registry";
import { palette } from "../../../../src/theme/tokens";

export default function GenericModuleDetail() {
  const { module, id } = useLocalSearchParams<{ module: string; id: string }>();
  const cfg = REGISTRY[module];
  const { data, isLoading, isError, error, refetch } = useModuleItem<any>(
    `detail:${module}`,
    cfg ? id : undefined,
    cfg ? `${cfg.endpoint}/${id}` : ""
  );

  if (!cfg) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
        <ScreenHeader title="Details" />
        <ErrorState message="Unknown module" />
      </View>
    );
  }

  const item = (cfg.detailEnvelope && data?.[cfg.detailEnvelope]) || data;
  const spec = item ? cfg.detail(item) : {};
  const title = item ? cfg.card(item).title : cfg.title;

  return (
    <DetailScaffold
      title={title}
      subtitle={spec.subtitle}
      loading={isLoading}
      isError={isError}
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
