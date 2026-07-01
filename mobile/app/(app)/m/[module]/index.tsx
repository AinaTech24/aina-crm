/**
 * Generic module list. Reads the :module param, looks it up in the registry, and
 * renders ModuleList against its endpoint. Modules not yet in the registry show a
 * titled "coming up" placeholder (still capability-gated by the drawer).
 */

import React from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { ModuleList } from "../../../../src/components/ModuleList";
import { GenericCard } from "../../../../src/components/domain/GenericCard";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { EmptyState } from "../../../../src/components/states";
import { useModuleList } from "../../../../src/features/list";
import { REGISTRY, defaultFilter } from "../../../../src/features/registry";
import { MENU } from "../../../../src/navigation/menu";
import { palette } from "../../../../src/theme/tokens";

export default function GenericModuleList() {
  const { module } = useLocalSearchParams<{ module: string }>();
  const cfg = REGISTRY[module];

  if (!cfg) {
    const item = MENU.flatMap((g) => g.items).find((it) => it.key === module);
    return (
      <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
        <ScreenHeader title={item?.label ?? "Module"} />
        <EmptyState
          icon={(item?.icon as any) ?? "grid"}
          title={`${item?.label ?? "This module"} — coming up`}
          message="Its data already lives in your CRM; the native screen is next on the build list."
        />
      </View>
    );
  }

  return (
    <ModuleList<any>
      title={cfg.title}
      unit={cfg.unit}
      chips={cfg.chips}
      useData={() => useModuleList(module, cfg.endpoint, cfg.envelope)}
      filterFn={(item, q, f) => defaultFilter(cfg, item, q, f)}
      renderCard={(item, open) => {
        const c = cfg.card(item);
        return (
          <GenericCard
            icon={c.icon as any}
            iconTone={c.iconTone}
            title={c.title}
            subtitle={c.subtitle}
            badge={c.badge}
            badge2={c.badge2}
            rightLabel={c.rightLabel}
            rightValue={c.rightValue}
            onPress={open}
          />
        );
      }}
      hrefFor={(item) => `/m/${module}/${item.id}`}
      searchPlaceholder={cfg.searchPlaceholder}
      emptyIcon={cfg.emptyIcon as any}
      emptyTitle={cfg.emptyTitle ?? "Nothing here"}
      emptyMessage={cfg.emptyMessage}
    />
  );
}
