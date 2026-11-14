/**
 * One opportunity — where its journey runs: the same card the client page
 * uses (OpportunityCard), with a link to the client. Who may work it, and who
 * a step can be handed to, come with the client's opportunities.
 */

import React from "react";
import { View, ScrollView, RefreshControl } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { LoadingState, ErrorState } from "../../../../src/components/states";
import { useOpportunity, useClientOpportunities } from "../../../../src/features/opportunities/api";
import { OpportunityCard } from "../../../../src/features/opportunities/OpportunityCard";
import { palette, spacing } from "../../../../src/theme/tokens";

export default function OpportunityDetail() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const { data: o, isLoading, isError, refetch, isRefetching } = useOpportunity(id);
  const client = useClientOpportunities(o?.investorId);

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title={o?.productLabel ?? "Opportunity"} subtitle={name || undefined} />
      {isLoading ? <LoadingState /> : isError || !o ? <ErrorState onRetry={refetch} /> : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => { refetch(); client.refetch(); }} tintColor={palette.brand} />}
        >
          <OpportunityCard o={o} canWork={!!client.data?.canWork} staff={client.data?.staff ?? []} showClient clientName={name || undefined} />
        </ScrollView>
      )}
    </View>
  );
}
