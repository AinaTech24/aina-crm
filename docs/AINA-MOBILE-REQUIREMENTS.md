# Aina CRM Android requirements

Interview agreed 28 September 2026. Backend: https://crm.ainatech.in; existing CRM accounts. English interface and English AI summaries of English, Hindi or Gujarati conversations. Deliver an internally distributed Android APK.

## Access and daily work

- Owner: firm; Branch Head: assigned branch; RM: assigned leads/clients; Operations: firm.
- All four roles create/assign leads and tasks within their access.
- Leads: New → Contacted → Meeting Scheduled → Follow-up → Converted / Lost. Preserve existing server blueprint transitions and historical stages.
- Manage clients, follow-ups, calls, meetings and tasks. Home, Leads, Clients, Activities and More navigation.
- Operations enters business; Owner, Branch Head and RM view within scope. SIP, lumpsum, life/health/motor insurance and other products.
- Owner and Branch Head set targets: completed new/review meetings, MF business, SIP monthly instalment value, lumpsum investment, insurance premium and policy count. Compare achievement with targets by RM/branch.
- Push reminders for assignments, meetings, due/overdue follow-ups/tasks; overdue escalation to Branch Head.
- Cached records and durable offline creation of leads, notes and follow-ups; sync with idempotency, account isolation and server permission revalidation.

## Calls

- Regular SIM calls, not a paid business-calling provider.
- Per-phone opt-in, off by default. Only CRM-linked numbers; exclude unmatched and ambiguous contacts from automatic upload.
- Read actual Android incoming/outgoing/missed call metadata with runtime permission. Catch up when opened/resumed; no promise of continuous background sync or permission availability on every device.
- Never infer connected status or call duration from time spent in the dialer.
- Android does not grant an ordinary CRM app reliable two-sided SIM audio capture. Users select an existing recording only after the participants agreed to recording and AI processing. No covert recording.
- English summary: discussion, needs, products, objections and next steps. Employee reviews the draft before saving or scheduling follow-up. No invented facts from call metadata.
- Audio summarization requires a configured audio-capable AI service and deployed backend endpoint; no fabricated summary when unavailable.

## Release checks

Type check, mobile tests, Android bundle, signed cloud APK build. Physical-device verification still required for permissions, incoming/outgoing/missed calls, recorded Hindi/Gujarati speech, notifications and offline reconciliation. Backend additions require deployment before their production-dependent features work. Do not represent an APK build as proof of end-to-end functionality.
