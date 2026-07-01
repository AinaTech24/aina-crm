/**
 * Bottom tabs: Home · Search · Tasks · Firm Profile · Settings (per the chosen
 * IA). Everything else lives in the drawer; the hamburger (header-left) opens it.
 */

import React from "react";
import { View } from "react-native";
import { Tabs } from "expo-router";
import { DrawerToggleButton } from "expo-router/drawer";
import { Feather } from "@expo/vector-icons";
import { palette, spacing, fontWeight } from "../../../src/theme/tokens";

/** expo-router's built-in toggle handles opening the parent drawer (no
 *  @react-navigation/* dependency, which SDK 56 disallows alongside the router). */
function HamburgerButton() {
  return (
    <View style={{ paddingLeft: spacing.sm }}>
      <DrawerToggleButton tintColor={palette.ink} />
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: palette.brand,
        tabBarInactiveTintColor: palette.faint,
        tabBarStyle: { borderTopColor: palette.line, height: 60, paddingBottom: 8, paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: fontWeight.medium },
        headerStyle: { backgroundColor: palette.surface, shadowColor: "transparent", elevation: 0, borderBottomWidth: 0 },
        headerTitleStyle: { fontWeight: fontWeight.bold, color: palette.ink, fontSize: 18 },
        headerLeft: () => <HamburgerButton />,
      }}
    >
      <Tabs.Screen
        name="home"
        options={{ title: "Home", tabBarIcon: ({ color, size }) => <Feather name="home" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="search"
        options={{ title: "Search", tabBarIcon: ({ color, size }) => <Feather name="search" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="tasks"
        options={{ title: "Tasks", tabBarIcon: ({ color, size }) => <Feather name="check-square" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="firm-profile"
        options={{ title: "Firm Profile", tabBarIcon: ({ color, size }) => <Feather name="briefcase" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: "Settings", tabBarIcon: ({ color, size }) => <Feather name="settings" size={size} color={color} /> }}
      />
    </Tabs>
  );
}
