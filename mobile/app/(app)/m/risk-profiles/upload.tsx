/**
 * Upload Risk Profile — record a profile the client already holds from its PDF.
 *
 *   /m/risk-profiles/upload?investorId=<uuid>   that client
 *   /m/risk-profiles/upload                     pick the client first
 */

import React from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { LoadingState, ErrorState, PermissionDeniedState } from "../../../../src/components/states";
import { useRiskCaps, useRiskCurrent } from "../../../../src/features/risk-profiles/api";
import { ClientPicker } from "../../../../src/features/risk-profiles/ClientPicker";
import { UploadRiskProfileForm } from "../../../../src/features/risk-profiles/UploadRiskProfileForm";
import { palette } from "../../../../src/theme/tokens";

export default function UploadRiskProfile() {
  const { investorId } = useLocalSearchParams<{ investorId?: string }>();
  const router = useRouter();
  const { me, canManage } = useRiskCaps();

  if (me && !canManage) {
    return <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}><ScreenHeader title="Upload Risk Profile" /><PermissionDeniedState /></View>;
  }

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title="Upload Risk Profile" />
      {investorId ? (
        <ForClient investorId={investorId} />
      ) : (
        <ClientPicker onPick={(r) => router.replace(`/m/risk-profiles/upload?investorId=${r.id}` as any)} />
      )}
    </View>
  );
}

function ForClient({ investorId }: { investorId: string }) {
  const cur = useRiskCurrent(investorId);
  if (cur.isLoading) return <LoadingState />;
  if (cur.isError || !cur.data) return <ErrorState message={(cur.error as any)?.message} onRetry={cur.refetch} />;
  return <UploadRiskProfileForm client={{ id: cur.data.id, name: cur.data.name }} />;
}
