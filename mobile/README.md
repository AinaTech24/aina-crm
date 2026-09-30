# Aina CRM mobile

Native Expo Router / React Native field-team app for Owner, Branch Head, RM and Operations. The five tabs are Home, Leads, Clients, Activities and More. It connects to https://crm.ainatech.in with existing CRM accounts. Some secondary web modules retain a WebView fallback.

See [the interview requirements](../docs/AINA-MOBILE-REQUIREMENTS.md) for the agreed scope and [the test handover](../docs/AINA-MOBILE-HANDOVER.md) for limitations and phone checks.

## Development

The current dependencies target Expo SDK 57, React Native 0.86 and React 19.2.3. Use Node 22.13 or newer and the exact lockfile.

```sh
cd mobile
npm ci
npm run typecheck
npm test -- --runInBand
npm start
```

The native app uses the production backend by default. The browser preview uses localhost:3000. Read `src/config.ts` before changing environments. Use a development build or signed APK to test the local Android call-log module; Expo Go cannot load that module.

## Android APK

The project is already linked to `@ainatech-services-llp/growth-os-mobile`. Preserve its project ID, Android package and signing key so installed apps can update in place.

```sh
eas build --platform android --profile preview
```

The preview profile produces an internally distributed signed APK. Production produces a Play Store AAB and sets `AINA_STORE_BUILD=1`, removing call-log access through `app.config.ts`. The runtime uses Expo's fingerprint policy to prevent updates crossing incompatible native builds.

## Main flows

- Sign in, optional configured two-factor authentication, secure session storage and biometric unlock.
- Leads, clients, activities, tasks, follow-ups and meetings.
- More → Business entries: Operations enters business; authorized staff view their scope.
- More → Targets & achievement: monthly meeting, mutual-fund and insurance measures; Owner/Branch Head set targets.
- Cached reads and an account-isolated offline queue for supported lead, activity and task changes. Server idempotency keys prevent duplicate queued writes.
- Settings → automatic SIM call logging: per-account/device opt-in, permission required. Imports metadata only for uniquely matched CRM numbers while the app is open or when it resumes. Manual call notes remain available when Android does not grant access.
- Call detail → Call summary: confirm participants agreed to recording and AI processing, choose an existing recording, review and save the English draft. Supports English, Hindi and Gujarati speech through the configured audio-capable Gemini service. The app does not capture SIM call audio.

## Push setup still required

Expo project linkage alone does not enable Android push. Configure the Firebase Android app for `in.ainatech.growthos`, provide its `google-services.json` to the native build, configure FCM v1 credentials in EAS, then rebuild and test on a phone. Keep service-account private keys out of source control.

Device registration and the backend `send_push` workflow action exist. Task assignments, reminders, overdue alerts, branch escalations and meetings starting within 15 minutes now queue mobile alerts alongside durable in-app notifications. The task scanner claims each delivery before sending to avoid duplicate worker retries; pushes are best-effort and uncertain deliveries are not automatically resent. Firebase setup and physical-phone delivery checks remain required.

## Backend

Call summaries can use `GEMINI_AUDIO_API_KEY` and `GEMINI_AUDIO_MODEL` in the server's secure environment without changing the existing text-AI provider. Both are required for the dedicated configuration. Alternatively, the global Gemini configuration is reused. Never put AI keys in the APK or source control.

Mobile Bearer sessions apply branch/assignment restrictions to leads, clients, activities, tasks and meetings, including task child routes. All new endpoints use tenant-scoped transactions:

- `/api/mobile/call-contacts`
- `/api/mobile/call-summary`
- `/api/mobile/business`
- `/api/mobile/targets`

The backend additions must be deployed before their screens are usable against production. An APK build confirms compilation, not physical-device permissions or end-to-end behavior.
