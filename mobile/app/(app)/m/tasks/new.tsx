import React from "react";
import { View } from "react-native";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { EmptyState } from "../../../../src/components/states";
import { palette } from "../../../../src/theme/tokens";

export default function NewTask() {
  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title="New task" />
      <EmptyState icon="plus-circle" title="Create task" message="Title, type, priority, assignee, due date → POST /api/tasks. Native form in the forms pass." />
    </View>
  );
}
