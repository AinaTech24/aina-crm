# Aina CRM 1.2.0 — internal Android release

Build requested on 30 September 2026; the completed signed APK was downloaded and verified on 12 October 2026. Android version code: **10**. Release status and download integrity are recorded in `artifacts/Aina-CRM-1.2.0.release.json`. Copies are saved in `artifacts/Aina-CRM-1.2.0.apk` and the user's Downloads folder. Package/version, ZIP integrity and matching signing certificate were checked; local cryptographic signature validation and physical installation were not performed.

## Included changes

The release packages the UI and workflow improvements documented in [the UX implementation report](AINA-MOBILE-UX-IMPLEMENTATION.md): role-aware Home, consolidated Work navigation, simpler client and lead cards, account-scoped form drafts, reviewed business entry, business-history filters, monthly target editing, call-summary readiness, and clearer offline recovery.

Android package remains `in.ainatech.growthos`. The internal preview profile retains the optional CRM-matched SIM call-log module. It imports call metadata; it does not automatically record SIM audio. Summaries require a participant-consented recording and a configured audio service.

## Backend compatibility

This APK build does not deploy the server. Deploy the matching backend changes before team rollout:

- `/api/mobile/targets`: atomic batch saves; older single-target payloads remain supported.
- `/api/mobile/business`: search, product/RM/date filters and paginated history.
- `/api/mobile/call-summary`: audio-service readiness check.
- `/api/dashboard/home`, `/api/dashboard/my-day`, `/api/command-center`: mobile role and branch scoping and task links.

The APK connects to `https://crm.ainatech.in`. Without the matching server update, new target saves and history filtering may fail or behave incorrectly, and summary readiness may be unavailable.

## Acceptance checks

Mobile and backend TypeScript checks passed before packaging. Mobile tests: 8 suites / 40 tests; relevant backend tests: 27 tests. The Android JavaScript/Hermes export also passed. See the implementation report for details.

Real-phone acceptance is pending: install over 1.1.1, sign in with each staff role, check branch/assignment boundaries, exercise keyboard/date pickers and enlarged text, restore interrupted drafts, and reconcile an offline write. Firebase setup and phone push-delivery verification remain pending. Audio-provider setup and consented English/Hindi/Gujarati recording checks remain pending.

The earlier [1.1.1 handover](AINA-MOBILE-HANDOVER.md) records that release's server deployment and test results; it does not establish that the 1.2.0 backend changes are deployed.
