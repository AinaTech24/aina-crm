import React from "react";
import { View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { Screen } from "../../src/components/ui/Screen";
import { Card } from "../../src/components/ui/Card";
import { Text } from "../../src/components/ui/Text";
import { Button } from "../../src/components/ui/Button";
import { useOfflineQueue } from "../../src/lib/offlineQueue";
import { confirmDelete } from "../../src/lib/confirm";
import { toast } from "../../src/lib/toast";
import { spacing } from "../../src/theme/tokens";

export default function SyncScreen() {
  const router = useRouter();
  const { items, flushing, storageError, legacyPending, retry, discard, flush } = useOfflineQueue();
  const run = (action: () => Promise<unknown>) => { void action().catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Sync failed")); };
  return <>
    <Stack.Screen options={{ headerShown: true, title: "Sync" }} />
    <Screen padded scroll contentStyle={{ paddingVertical: spacing.lg, gap: spacing.md }}>
      <Text variant="title">{items.length} saved {items.length === 1 ? "change" : "changes"}</Text>
      <Text tone="muted">These changes belong to this account. They remain on this device until the server confirms they were saved. Failed changes need your review.</Text>
      {storageError ? <Text tone="danger">{storageError}</Text> : null}
      {legacyPending ? <Text tone="muted">This device has changes from an older app version without an account identity. They are preserved and will not sync automatically. Contact your administrator for recovery.</Text> : null}
      <Button label={flushing ? "Syncing…" : "Sync now"} disabled={flushing} onPress={() => run(flush)} />
      {items.map((item) => <Card key={item.id} style={{ gap: spacing.sm }}>
        <Text variant="label">{item.label}</Text>
        <Text variant="caption" tone="muted">{new Date(item.at).toLocaleString()} · {item.status === "failed" ? "Needs review" : item.attempts ? "Waiting to retry" : "Pending"}</Text>
        {item.error ? <Text tone="danger">{item.error}</Text> : null}
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <Button label="Retry" variant="secondary" disabled={flushing} onPress={() => run(() => retry(item.id))} />
          <Button label="Discard" variant="secondary" disabled={flushing} onPress={() => confirmDelete({ title: "Discard saved change?", message: "This removes the change from this device. If an earlier request reached the server, its saved record will remain there.", confirmLabel: "Discard" }, () => discard(item.id))} />
        </View>
      </Card>)}
      {!items.length ? <Text tone="muted">No changes waiting to sync.</Text> : null}
      <Button label="Back" variant="secondary" onPress={() => router.back()} />
    </Screen>
  </>;
}
