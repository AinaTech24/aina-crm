# Aina CRM — calls and mobile improvements

## Agreed calling experience

On 12 October 2026 the user chose **regular SIM calls with summaries generated from recordings after the call**. Aina CRM imports metadata for uniquely matched leads and clients after the user's device/account opt-in. Participants must agree to recording and AI processing before a recording is uploaded.

Ordinary Android applications cannot capture both sides of a SIM call using `VOICE_CALL`; that source requires a system-only permission. See [Android's audio source documentation](https://developer.android.com/reference/android/media/MediaRecorder.AudioSource) and [audio-input sharing rules](https://developer.android.com/media/platform/sharing-audio-input). This implementation therefore uses an existing recording selected by the employee. It does not provide live SIM-call audio transcription.

## Applied improvements

- **Calls workspace:** opens with calls selected; incoming, outgoing, not-answered and needs-notes filters; visible logging/permission status, enable/sync controls and a link to queued call writes. General activity/visit controls remain available in the standalone Activities screen. Call-back controls have larger touch targets and use the CRM logging flow.
- **Reliable metadata import:** revisit up to 24 hours before the sync cursor, bounded by opt-in, to catch calls Android writes after they end. Durable imported-ID state prevents repeated local enqueueing. Queue errors preserve the scan position. Large pages have a continuation position; an unresolvable same-time page stops with an actionable error. Old installations migrate with a conservative consent boundary. Unknown/ambiguous calls remain on the phone; new CRM contacts can become eligible during the recheck window. Contact refreshes on misses are spaced at least one minute apart.
- **Manual fallback:** permission denial restores the return-to-app manual prompt; actual outcome and duration are entered by the employee. No duration is inferred from time spent away. Failed dialer launches show an error; pending call intents are cleared on account changes. Offline manual logs are explicitly described as awaiting sync.
- **After-call summary:** choose a recording, inspect its filename/size and select auto/mixed, English, Hindi or Gujarati speech, then confirm participant agreement. Generate an English draft with discussion, requirements, products, objections and proposed next steps. Edited drafts are stored by account and call on the phone; consent and audio-file selection are not restored automatically.
- **Review/save:** saves require a connection and merge with fresh notes. A locked server-side notes comparison rejects a concurrent edit instead of overwriting it. Uncertain requests reuse their identity/payload, and the pending draft is locked until retry resolves. A confirmed identical summary is recognized after a lost response. The app checks server support for safe summary saving before sending a save. Follow-up task preparation becomes available after confirmed saving; the employee reviews and confirms the task.
- **Audio service:** dedicated key and model must be configured together. A partial configuration cannot borrow credentials/model settings from another AI account. Malformed or excessively long model output returns a safe error, and the selected language is validated before processing. The audit records consent, audio hash and language selection.

## Suggested next improvements

1. Enable and verify assignment/follow-up push reminders on real phones after Firebase setup; keep the in-app reminder available as fallback.
2. Add pagination to the activity feed for large books. Current server filtering happens before the existing 300-row limit, but the complete feed still needs pagination.
3. Add a dedicated callback queue with employee-selected due times for missed/not-answered calls, linked to tasks and the client timeline.
4. Add employee-recorded voice notes after calls as an optional alternative when the phone cannot produce a usable recording.
5. Run small-screen, enlarged-text, TalkBack and keyboard acceptance checks, then measure common flows: create lead, log call, review summary and plan follow-up.

## Deployment and acceptance

Verification completed before delivery:

- Mobile TypeScript: passed after the final source changes.
- Backend TypeScript: passed after the final source changes.
- Mobile Jest: **12 suites / 60 tests passed**, including the recording/consent/review controller, durable call-import behavior and existing offline/account tests. The cold native-controller test uses a 30-second timeout on Windows; network transport is mocked.
- Backend Vitest: **4 suites / 25 tests passed**, covering consent, language selection, malformed output, partial credential configuration, scoped filters, concurrent notes, role access and mobile record boundaries.
- Android JavaScript/Hermes bundle: passed, **2,626 modules / 47 assets**, recorded in `artifacts/mobile-calls-android-bundle/metadata.json`.
- `git diff --check`: passed for the touched areas.

These are local source changes. The Android release is being packaged as **1.3.0**; its final build status, URL and integrity checks are recorded in `artifacts/Aina-CRM-1.3.0.release.json` when available.

Deploy these matching server routes before using the new APK features:

- `src/app/api/activities/route.ts`: call filters.
- `src/app/api/activities/[id]/route.ts`: optional expected-notes comparison under a row lock.
- `src/app/api/mobile/call-summary/route.ts`: supported save capability, bounded language hint, audio configuration and output validation.

The earlier 1.2.0 mobile backend changes also remain required unless already deployed by another authorized task. This task does not claim a production deployment. Configure `GEMINI_AUDIO_API_KEY` and `GEMINI_AUDIO_MODEL` on the server, or use the existing global Gemini key/model configuration. Keep provider credentials out of the APK.

Real-device acceptance must check incoming/outgoing/missed/rejected calls from inside and outside Aina CRM, a long call while the app was open, denied/revoked permission, opt-out and account switching, offline queue recovery, and participant-consented English/Hindi/Gujarati recordings. AI amount/date accuracy and phone-specific recording availability remain unverified until those checks pass.
