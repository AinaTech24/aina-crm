# Aina CRM mobile — UI, UX and function review

Reviewed 30 September 2026. Scope: current mobile screen code, navigation, forms and related API behavior. This is a source and workflow review, not a physical-phone usability test. This document records the original findings; implementation status is tracked in AINA-MOBILE-UX-IMPLEMENTATION.md. Existing uncommitted work was preserved.

## Recommended direction

Make daily work the first thing people see: overdue follow-ups, the next meeting and the next action. Keep the existing brand, shared components, search, loading states and offline queue. Improve task visibility and save reliability before adding more dashboard cards.

## 1. Fix these functional problems first

| Priority | Finding and evidence | Recommended change | Acceptance check |
|---|---|---|---|
| High | Switching the selected day retains the previous day's data through `placeholderData` in `mobile/src/features/dashboard/api.ts:84`. Home changes the heading without guarding those actionable rows. | Show a date-specific loading state, or clearly retain the old date and disable its actions until the selected day's data arrives. | With a slow connection, switch dates repeatedly; no task or meeting appears under the wrong date. |
| High | `LogActivitySheet` resets its note and follow-up immediately after invoking the asynchronous save (`mobile/app/(app)/m/leads/[id].tsx:327`). A failed save can therefore erase the user's text. | Reset only after confirmed server save or durable local queue storage. Keep the draft and show a retry on failure. | Fail a save, then retry without retyping the note. |
| High | Overdue tasks are excluded from both the detailed urgent group and today's task list (`mobile/app/(app)/(tabs)/home.tsx:65`, `:111`). The empty plan can say the user is clear while overdue work remains. Count chips do not replace an actionable backlog. | Add a visible Overdue section; show an all-clear only when no relevant overdue or due work remains. | A user with only overdue tasks sees those tasks and no all-clear message. |
| High | Offline banner says all work is saved even with no queued changes (`mobile/src/components/ui/OfflineBanner.tsx:25`), while generic forms only queue selected endpoints. Home also says “Task completed” after a queued write. | Distinguish Saved, Saved on this phone / pending sync, and Needs attention. Keep pending/failed status visible after connectivity returns. Mark online-only actions accurately. | Offline save, reconnect, server rejection and retry each produce truthful status. Unsaved form text is never described as synced. |
| High | Targets save one metric at a time (`mobile/app/(app)/m/mobile-targets/index.tsx:22`). A later error can leave earlier metrics saved with only a generic error. | Validate every edited value before writing, then use an atomic batch or explicit per-metric save results. | Fail the second write; users can identify exactly what saved and recover safely. |
| Medium | Home's `today` is memoized once (`mobile/app/(app)/(tabs)/home.tsx:74`). | Refresh the day on app resume and midnight rollover. | Leave the app open overnight and resume; Today and the selected schedule remain correct. |

## 2. Give each role a useful home screen

The current Home uses a largely shared layout. Attendance and planning banners, quick actions and the AUM summary precede much of the daily schedule. Keep a compact greeting and search, then prioritize by role:

| Role | First screen content | Main actions |
|---|---|---|
| Relationship Manager | Overdue and today's follow-ups; next meeting; leads needing action; compact personal target progress | Call, log outcome, schedule follow-up, quick lead |
| Owner | Firm business and targets; branch comparison; important exceptions; team performance | Drill into a branch/RM, set targets, assign work |
| Branch Head | Branch targets; overdue team work; meeting pipeline; workload distribution | Assign/reassign, inspect an RM's queue, set targets |
| Operations | Business entry; incomplete records; service and reconciliation work relevant to their permissions | Enter business, resolve missing details, open the work queue |

Suggested RM order: greeting/search → overdue and next meeting → Call / Lead / Task / Meeting actions → today's agenda → compact target progress → collapsible secondary information. Keep attendance compact when it needs action. Place AUM and birthday/recently-viewed sections below immediate work.

## 3. Simplify navigation and record layouts

- Evaluate **Home · Leads · Clients · Work · More**. Work can group Follow-ups, Tasks, Meetings and Calls with a selected subtab; this removes the current split where Activities has a bottom tab but Tasks sits inside More. Validate the naming with actual staff before changing routes.
- Alert chips should open the matching filtered queue. The home API currently sends overdue and due-today task chips to the same generic task destination (`src/app/api/dashboard/home/route.ts`).
- Lead/client cards should emphasize name, next action and one important status. Move secondary segmentation, numerous badges and full identifiers into detail views. Existing cards have small badges and several competing metadata fields; actual clipping needs device verification.
- Add a visible overflow menu for secondary record actions instead of relying on discovery of long press. Offer a direct Call action and easy Schedule follow-up access without filling each card with buttons.
- Separate Personal settings from Firm administration. Filter admin menu entries by capabilities; `mobile/app/(app)/(tabs)/settings.tsx:55` currently renders every section. This is a navigation finding, not evidence of a server authorization bypass.

## 4. Make forms faster and safer

| Flow | Proposed improvement |
|---|---|
| Create lead | Start with name, phone, source and next follow-up; tuck optional profile details into More details. Preserve the draft when interrupted. Make assignment help reflect the user's role. |
| Log call/activity | Outcome chips, notes, next action, follow-up date **and time**. The lead activity sheet currently assigns 09:00 automatically. Offer Today, Tomorrow and Choose date/time. |
| Business entry | Replace the long bottom sheet with a full screen: Client/RM → Product and amount → Review. Use a date picker, field-level errors, formatted INR and a pinned Save action. After saving, show Done / Add another and make retained fields explicit. |
| Targets | Use a month picker and separate View/Edit modes. Show Actual, Target, Remaining and achievement percentage; let users drill into contributing records. |
| Failed sync | Let users inspect and correct failed records where supported, rather than only retrying the same data or discarding it. |

Business history also needs search, date/product/RM filters and pagination. The API currently limits history to 300 entries (`src/app/api/mobile/business/route.ts:32`) without an older-records control in the mobile list.

There are separate “Targets & achievement” and “Targets & quota” destinations, plus Home's My Numbers. Clearly distinguish monthly commitments from annual quotas and reconcile metric definitions and periods. Do not silently combine their storage or overwrite existing targets.

## 5. Improve the call workflow

- Show call-logging readiness: enabled/disabled, phone permission, last successful sync, imported count and actionable errors. Replace the generic “Call sync checked” toast (`mobile/src/features/settings/PreferencesSettings.tsx:117`).
- Explain supported behavior at setup: SIM call metadata and a consented recording summary are separate capabilities. Do not present audio capture as available just because metadata logging is enabled.
- Show summary-service readiness before the user selects a file. Keep participant consent explicit and the English summary editable, including for Hindi and Gujarati recordings.
- Turn a reviewed next step into a prefilled follow-up or meeting with user confirmation. Link it to the original call and lead/client so staff do not enter the same details twice.
- Use a short setup checklist for notifications and call logging, with a clear recovery path when permission is denied.

## 6. Visual and device checks

Use stronger text hierarchy, fewer competing badges, consistent spacing and larger readable secondary labels. Retain the red brand accent mainly for key actions and selected states; reserve clear status treatments for overdue/error conditions.

Audit effective touch areas, including hitSlop, against Android's recommended 48 × 48 dp minimum. Check small-text contrast against 4.5:1. These recommendations come from [Android's accessibility guidance](https://developer.android.com/guide/topics/ui/accessibility/apps); source dimensions alone do not prove an inaccessible rendered control.

Before signing off on layout, test on a small Android phone and a larger phone with enlarged text, TalkBack, gesture navigation and three-button navigation. Verify keyboards and bottom sheets, the fixed-height tab bar, long client names, large INR amounts, denied permissions and slow/offline connections. No claim of passing these physical-device checks is made here.

## Suggested delivery order

1. Correct date switching, lost activity drafts, overdue visibility, save/sync messages and partial target saves.
2. Introduce role-based Home priorities and a unified Work area; simplify record cards and filtered navigation.
3. Improve quick lead, business entry, targets and call readiness; add history filters and pagination.
4. Validate the complete daily journeys with one user from each role on real Android devices before generating the next release APK.

Success measures to collect: time to create a lead, time to log a call and next follow-up, number of taps to today's overdue work, business-entry correction rate, and unresolved sync failures. Establish current baselines before setting numerical improvement targets.
