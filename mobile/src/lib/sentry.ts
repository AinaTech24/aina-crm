/**
 * Crash reporting. A render crash used to be invisible: the user saw the
 * error boundary, nobody else heard about it. With a DSN configured every
 * uncaught JS error, native crash and boundary-caught error is reported with
 * release + device context.
 *
 * Configuration is env-only so no DSN is committed:
 *   EXPO_PUBLIC_SENTRY_DSN     — from Sentry → Project → Client Keys. Without
 *                                it every function here is a no-op.
 *   EXPO_PUBLIC_SENTRY_IN_DEV  — "1" to also report from `expo start` sessions
 *                                (off by default: dev red-boxes are noise).
 * Source-map upload at build time additionally wants SENTRY_ORG / SENTRY_PROJECT
 * / SENTRY_AUTH_TOKEN as EAS secrets (the config plugin reads them).
 *
 * PII: `sendDefaultPii` stays off and we set only the user *id* — client names,
 * phones and emails never leave the device through this channel.
 */

import * as Sentry from "@sentry/react-native";
import Constants from "expo-constants";

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
const IN_DEV = process.env.EXPO_PUBLIC_SENTRY_IN_DEV === "1";

export const sentryEnabled = !!DSN && (!__DEV__ || IN_DEV);

export function initSentry(): void {
  if (!sentryEnabled) return;
  Sentry.init({
    dsn: DSN,
    environment: __DEV__ ? "development" : "production",
    release: `aina-crm-mobile@${Constants.expoConfig?.version ?? "0.0.0"}`,
    sendDefaultPii: false,
    // Keep performance sampling light — errors are the point here.
    tracesSampleRate: 0.1,
    enableAutoSessionTracking: true,
  });
}

export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!sentryEnabled) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
}

/** Identify the session by opaque user id only (see PII note above). */
export function setSentryUser(id: string | null): void {
  if (!sentryEnabled) return;
  Sentry.setUser(id ? { id } : null);
}

/** Wraps the root component for native crash + touch-event context. */
export function withSentry<C extends React.ComponentType<any>>(component: C): C {
  return sentryEnabled ? (Sentry.wrap(component as any) as unknown as C) : component;
}
