import React from "react";
import { View } from "react-native";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { EmptyState } from "../../../../src/components/states";
import { palette } from "../../../../src/theme/tokens";

export default function NewLead() {
  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title="Add lead" />
      <EmptyState
        icon="user-plus"
        title="New lead form"
        message="Capture form (name, contact, source, intended amount, interest products) posting to POST /api/leads — building the native forms pass next."
      />
    </View>
  );
}
