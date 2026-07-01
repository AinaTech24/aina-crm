import React from "react";
import { Stack } from "expo-router";
import { palette } from "../../../../src/theme/tokens";

export default function BusinessEntriesLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.surfaceAlt } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" />
    </Stack>
  );
}
