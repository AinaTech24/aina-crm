/**
 * WebOnlyState — what a route the app has no native screen for shows (a
 * notification or link to a web-only page, e.g. /dashboard/payroll/…). It used
 * to promise "coming up" / "Unknown module" with no way forward; now it names
 * the page and opens the same page in the web CRM.
 */

import React from "react";
import { View, Linking } from "react-native";
import { ScreenHeader } from "./ui/ScreenHeader";
import { EmptyState } from "./states";
import { API_BASE_URL } from "../config";
import { palette } from "../theme/tokens";

type FeatherName = React.ComponentProps<typeof import("@expo/vector-icons").Feather>["name"];

export function WebOnlyState({ title, webPath, icon = "external-link" }: { title: string; webPath: string; icon?: FeatherName }) {
  const path = webPath.startsWith("/") ? webPath : `/${webPath}`;
  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title={title} />
      <EmptyState
        icon={icon}
        title="Open this on the web"
        message="This page is in the web CRM, not in the app."
        actionLabel="Open in browser"
        onAction={() => Linking.openURL(`${API_BASE_URL}${path}`).catch(() => {})}
      />
    </View>
  );
}
