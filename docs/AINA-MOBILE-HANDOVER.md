# Aina CRM Android test handover

Use the signed internal APK with existing accounts on https://crm.ainatech.in. The app operates on the live CRM; use clearly identified test records for write checks.

## Installation

Signed APK: **Aina CRM 1.1.1**, Android version code **9**. A copy is saved in Downloads as `Aina-CRM-1.1.1.apk` and under the repository's `artifacts/` directory. Build metadata and SHA-256 are in `artifacts/Aina-CRM-1.1.1.release.json`.

1. Transfer the APK to the Android phone and open it. Allow installation from the selected browser or file manager if Android asks.
2. Open **Aina CRM** and sign in with the normal CRM account, completing two-factor authentication if enabled.
3. Use **More → Business entries** and **More → Targets & achievement** for the new business tools.
4. Automatic call logging is off initially. Enable it in Settings and allow call-log access if the phone offers it. Only calls after opt-in to matching CRM numbers are eligible.

## Verify before team rollout

- Test one account for each role: Owner, Branch Head, RM and Operations. Check a record in another branch and one assigned to a different RM; unauthorized records must be absent or denied.
- Operations creates one SIP/lumpsum or insurance entry against a test client. Confirm it appears under the selected RM and in the correct target month. Owners/Branch Heads/RMs must not see the mobile business-entry creation control.
- Owner/Branch Head sets a monthly target, then refreshes it. Compare completed new/review meetings and confirmed business with the web ledger.
- Create a test lead or activity while offline, reopen the app, reconnect and verify exactly one server record. Check the Offline sync screen for rejected entries.
- With call logging enabled, make incoming, outgoing and missed calls involving a test CRM number. Open/resume the app and check the direction, actual duration and matching contact. Calls to unrelated or ambiguous numbers should not appear. Disable logging and verify new calls stay unimported.
- With explicit participant agreement, upload one English, Hindi and Gujarati test recording. Check names, dates, rupee amounts and next steps; edit errors before saving. No AI action is executed automatically.

## Remaining limitations

- Automatic SIM audio recording is not implemented. Summaries use an existing consented recording and require an audio-capable Gemini configuration. Transcription accuracy has not been verified on real calls.
- Android call-log permission and availability vary by device and installation method. Metadata synchronization runs while open or on resume, not continuously in the background.
- Firebase setup and physical-phone push delivery tests are pending. Assignments, reminders, overdue tasks, branch escalations and upcoming meetings queue best-effort pushes. A worker claims each delivery before sending, so uncertain sends are not repeated; the in-app alert remains available if a push fails. Alerts without an eligible device expire from delivery consideration after one day.
- Physical-device sign-in, permissions, offline reconciliation and notification delivery have not been tested here. This release is for internal acceptance testing.

## Verification performed

- Mobile TypeScript check passed.
- Full backend TypeScript check passed.
- Mobile unit tests: 7 suites, 34 tests passed.
- Backend tests: 6 suites, 22 tests passed for mobile access, call-summary consent, target periods, session boundaries and push delivery claims. Access tests additionally cover RMs with broad capability grants, Branch Heads without a branch, and nested/encoded task record paths.
- Signed Android cloud build completed; downloaded APK archive and SHA-256 verified.
- Final backend deployed on 30 September 2026 at 09:09 IST. Build, type-check, migration, schema and health gates passed; the task/reminder worker started. Health returns 200 and unauthenticated mobile endpoint requests return 401.
