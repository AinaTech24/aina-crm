/**
 * Storage for LARGE, non-secret payloads (the offline write queue).
 *
 * `storage.ts` is backed by SecureStore, which caps a value at 2,048 bytes and
 * only warns past that ("may not be stored successfully") — a handful of queued
 * call logs exceeds it, so the queue could silently fail to persist and be lost
 * when the app is killed. AsyncStorage has no practical per-value limit.
 *
 * Keep secrets (session token, push token) in `storage.ts`. This data stays in
 * the app sandbox; `android.allowBackup` is false so it is not copied into the
 * user's Google Drive backup.
 */

import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const web = Platform.OS === "web";

export async function bulkGet(key: string): Promise<string | null> {
  if (web) return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
  return AsyncStorage.getItem(key);
}

export async function bulkSet(key: string, value: string): Promise<void> {
  if (web) {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
    return;
  }
  await AsyncStorage.setItem(key, value);
}

export async function bulkDelete(key: string): Promise<void> {
  if (web) {
    if (typeof localStorage !== "undefined") localStorage.removeItem(key);
    return;
  }
  await AsyncStorage.removeItem(key);
}
