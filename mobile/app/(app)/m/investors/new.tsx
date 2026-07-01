import React from "react";
import { View } from "react-native";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { EmptyState } from "../../../../src/components/states";
import { palette } from "../../../../src/theme/tokens";

export default function NewInvestor() {
  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title="Add client" />
      <EmptyState
        icon="user-plus"
        title="Client onboarding form"
        message="The native KYC capture form (react-hook-form + your existing Zod schema, native pickers, license field-gating) is the next build — it posts to POST /api/investors."
      />
    </View>
  );
}
