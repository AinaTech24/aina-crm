/**
 * Start a new risk profile — the web's /dashboard/risk-profiles/new:
 *
 *   /m/risk-profiles/new?investorId=<uuid>   straight to the questionnaire
 *   /m/risk-profiles/new                     pick the client first
 *
 * A minor linked to a guardian is not profiled here: their profile is the
 * guardian's, so this sends the RM to the guardian's record instead.
 */

import React from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { Card } from "../../../../src/components/ui/Card";
import { Text } from "../../../../src/components/ui/Text";
import { Button } from "../../../../src/components/ui/Button";
import { LoadingState, ErrorState, PermissionDeniedState } from "../../../../src/components/states";
import { useInvestorFull } from "../../../../src/features/investors/api";
import { useRiskCaps, useRiskCurrent, useRiskTemplate } from "../../../../src/features/risk-profiles/api";
import { ClientPicker } from "../../../../src/features/risk-profiles/ClientPicker";
import { RiskWizard } from "../../../../src/features/risk-profiles/RiskWizard";
import { displayPan } from "../../../../src/features/risk-profiles/pan-display";
import { profileIsGuardians } from "../../../../src/features/risk-profiles/rules";
import { palette, spacing } from "../../../../src/theme/tokens";

export default function NewRiskProfile() {
  const { investorId } = useLocalSearchParams<{ investorId?: string }>();
  const router = useRouter();
  const { me, canManage } = useRiskCaps();

  if (me && !canManage) {
    return <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}><ScreenHeader title="New risk profile" /><PermissionDeniedState /></View>;
  }

  if (!investorId) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
        <ScreenHeader title="Start a new risk profile" />
        <ClientPicker onPick={(r) => router.replace(`/m/risk-profiles/new?investorId=${r.id}` as any)} />
      </View>
    );
  }

  return <Capture investorId={investorId} />;
}

function Capture({ investorId }: { investorId: string }) {
  const router = useRouter();
  // The client-360 payload: the same viewable-client check as the web page, and
  // usually already cached by the profile or client screen this came from.
  const inv = useInvestorFull(investorId);
  const tpl = useRiskTemplate();
  const current = useRiskCurrent(investorId);

  if (inv.isLoading || tpl.isLoading) return <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}><ScreenHeader title="Risk profile" /><LoadingState /></View>;
  if (inv.isError || tpl.isError || !inv.data?.investor || !tpl.data) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
        <ScreenHeader title="Risk profile" />
        <ErrorState message={((inv.error ?? tpl.error) as any)?.message} onRetry={() => { inv.refetch(); tpl.refetch(); }} />
      </View>
    );
  }

  const i = inv.data.investor as any;
  if (profileIsGuardians(i)) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
        <ScreenHeader title={i.name ?? "Risk profile"} />
        <View style={{ padding: spacing.lg }}>
          <Card>
            <Text variant="body">
              A minor's risk profile is the guardian's{current.data?.minorOf ? ` (${current.data.minorOf})` : ""}.
            </Text>
            <View style={{ marginTop: spacing.md }}>
              <Button label="Guardian's risk profile" onPress={() => router.replace(`/m/risk-profiles/${i.guardianInvestorId}` as any)} full />
            </View>
          </Card>
        </View>
      </View>
    );
  }

  return (
    <RiskWizard
      investor={{ id: i.id, name: i.name ?? "", pan: displayPan(i.pan), dob: i.dob ?? null }}
      template={tpl.data}
    />
  );
}
