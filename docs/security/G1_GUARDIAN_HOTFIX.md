# G-1 — Guardian-PAN link: security hotfix (development only)

**Status (2026-10-14): fixed and tested in development on `claude/g1-guardian-hotfix`
— the first fix (`0c4f9e7e`, typed in `ea287acf`, on `main` `b795fdba` at
`c046ecfc`) plus the **final hardening** of §8 (every read path, removal of a
link, refused typed PANs, the client history route). Not merged to `main`, not
deployed, nothing run against production.** Pushing this branch to `main`
deploys it: that needs the owner's separate, explicit authorization (§6). The
business decision the hardening leaves open is in §9.

## 1. Root cause

`main`'s Client Master (since `f563e7ac`, 2026-10-13) links a minor to a
guardian's client record (`investors.guardian_investor_id`) in two places:

- `POST /api/investors` (Create Client) and `PATCH /api/investors/[id]` (Edit
  Client) accepted a picked `guardianInvestorId` if it was **any non-deleted
  record in the firm**, or looked the typed guardian PAN up with
  `SELECT id … WHERE pan = $1 … ORDER BY dedup_pan DESC LIMIT 1`.
- Neither applied the user's client scope (the firm's data wall,
  `investorScopeSql`), excluded a merged record (picked id) or a minor / HUF /
  entity, nor refused a PAN that two live records share.

Migration `0234_minor_risk_from_guardian` then copies the linked record's risk
category, score, signed date and provisional flag onto the minor; the Edit
page read the guardian's name and risk with no scope check, and the Risk
Profiles page and export printed the guardian's name. So an RM limited to
their own book could type any PAN on their own minor and learn that client's
name and risk profile; PAN twins were linked by sort order (non-deterministic
on a tie); a merged record could be linked and its frozen profile copied.
Separately, the suitability gates (MF proposal gate, opportunity journey) read
the minor's row, so the guardian's copy satisfied them as if the minor's
account had been assessed. Within one firm only — RLS and the tenant filter
held; no cross-firm exposure was possible or found.

## 2. The patch

| File | Change |
|---|---|
| `src/lib/investors/guardian-link.ts` (new) | One rule for every writer: a guardian is a live, non-merged **adult individual** (individual / NRI / sole proprietor, not a minor, ≥ 18 when a DOB is on record, an individual's PAN — 4th letter P — when a PAN is on record); a typed PAN resolves only when **exactly one** live record in the firm holds it; the user must be able to open that record (`investorScopeSql`); a picked id passes the same checks. Every refusal is the same `null` / one message. `auditGuardianChange` (ids only), `auditGuardianNotLinked`, `guardianForViewer`, `withMinorOwnRisk` (§8). |
| `src/app/api/investors/route.ts` | Create: picked id → `resolveGuardian`, refused → 400 with one message; typed PAN → `resolveGuardian`, refused → created unlinked. Response says only `guardianLinked: true/false`. Audit `investor.guardian_linked`. |
| `src/app/api/investors/[id]/route.ts` | Edit: same checks; re-sending the guardian already on record is a no-op (an RM can still save a minor whose existing guardian is outside their book); `null` unlinks; audit on every change. GET and PATCH responses blank a linked minor's copied risk when the viewer cannot open the guardian. |
| `src/app/dashboard/investors/[id]/edit/page.tsx`, `ClientDetailsForm.tsx`, `ClientTypeSections.tsx` | The Edit page shows "A client outside your book" and "Not shown" instead of a hidden guardian's name and risk; the minor's copied risk is blanked before it reaches the browser. |
| `src/app/dashboard/investors/[id]/page.tsx`, `ClientSummaryStrip.tsx` | The client page and summary strip blank the copied risk when the guardian is hidden. |
| `src/app/dashboard/risk-profiles/page.tsx`, `src/lib/export/modules/relationships.ts`, `src/lib/export/{run,types}.ts` | The guardian join carries the viewer's scope (the export's FROM may now depend on the viewer); hidden guardian → no name, the minor's copied category / score / date blank. |
| `src/lib/investors/merge.ts`, `src/app/api/investors/unmerge/route.ts` | Merging a guardian moves its minors' links to the survivor when the survivor can be a guardian, else removes them — recorded in `investor_merges.moved` under non-table keys and restored by un-merge; each change audited. |
| `src/lib/risk-profile/own-assessment.ts` (new), `src/lib/opportunities/journey.ts`, `src/lib/proposals/snapshot.ts`, `src/app/api/proposals/[id]/send/route.ts`, `src/lib/comms/client-links.ts` | Suitability (§3). |
| `tests/guardian-link-db.test.ts` (new), `scripts/g1-guardian-ui.mjs` (new) | Evidence (§4). |

**No migration. No data change.** Migration 0234's triggers are untouched
(changing them would be a migration): links that are valid keep copying the
guardian's profile for display, exactly as the firm asked on 2026-10-13.

## 3. Risk profile and suitability (Task 2)

| Question | Finding |
|---|---|
| Which suitability policy authorizes copying? | None in the code or the docs. The only basis is the product decision recorded in migration 0234 / commit `f563e7ac` ("A minor's risk profile IS the guardian's", the firm's client-master list of 2026-10-13) — a display rule. No SEBI / AMFI suitability rule or firm policy document is cited for treating it as the minor account's assessment. **Owner / compliance to confirm.** |
| Is the copy distinguishable from an independent assessment? | **Not on the minor's row**: same columns, `provisional` false, the guardian's signing date. Only by inference: the minor has `guardian_investor_id` and no `risk_profile_responses` row of its own. |
| Was the minor's proposal suitability marked approved incorrectly? | **Yes, it could be.** The MF proposal send gate (`loadProposalSnapshot` → status "Completed") and the opportunity journey's "client-confirmed risk profile signed in the last 12 months" gate both passed on the copy; the alignment check compared schemes with the guardian's category. |
| Do guardian-link changes invalidate earlier suitability? | Yes: changing the link replaced the minor's profile (trigger) with no audit and no flag on earlier proposals. Links now leave an audit row; proposals sent while a minor carried only a copy are counted by `g1-guardian-impact.sql` §3. |
| Do proposals / communications contain inherited details? | Yes, possibly: `risk.*` / `suitability.*` merge tokens fell back to the minor's row, so a message to the minor could state the guardian's category as the minor's. Counted by §3 of the impact SQL. |

**Interim rule implemented (until the firm confirms a policy):** for a minor
linked to a guardian, every suitability gate and every client message reads
**only an assessment recorded for the minor's own account** (the latest
`risk_profile_responses` row for the minor); none → "not profiled", the gate
stays closed and `risk.*` tokens stay unset. Everyone else reads exactly as
before. Existing profiles and audit history are untouched; nothing is
rewritten.

## 4. Evidence (development)

| Check | Result |
|---|---|
| `tests/guardian-link-db.test.ts` on a fresh database built from `main`'s 272 migrations (ledger `2ed089067e530ec25b28fb9a755cca5c` — production's expected digest), restricted role `mfd_app`, data wall on | **16 / 16** — unique PAN; two live records sharing a PAN (refused even for the owner and when one is the RM's); guardian outside / inside the RM's book; merged record; HUF PAN; minor; under-18; unknown id; another firm's id and PAN; Create and Edit; one indistinguishable 400 for every refused pick; no hidden name / risk in GET, PATCH or the edit-page data; saving other fields keeps an existing hidden link; owner and the guardian's RM still see it; audit rows (ids only, no PAN); Risk Profiles export (hidden name and copied risk blank for the RM; shown to the owner); the 0234 copy still follows an in-book guardian; suitability gate / proposal snapshot / `risk.*` tokens ignore the copy and accept the minor's own assessment; adults unchanged; merge moves links to the survivor (audited) and un-merge restores them; an HUF survivor unlinks instead |
| Same suite against the ORIGINAL route / export / gate / merge code | **12 of 16 fail** (the 4 that pass are the pure eligibility rule and behaviour the old code shared); the old code did NOT leak across firms — its cross-firm failure is a 201 where the fix answers 400 |
| Browser, `scripts/g1-guardian-ui.mjs` (Chromium, real Next dev server, licensed firm, data wall on, a pre-fix cross-book link) | **21 / 21** — the Edit page, client page and Risk Profiles list return 200 and render the real page; neither the HTML + RSC payload nor the live DOM (incl. input values and collapsed sections) carries the hidden guardian's name or risk; the Edit page says "A client outside your book"; `GET /api/investors/<minor>` has `riskProfile: null`; the RM cannot open the guardian (404); a direct `PATCH` picking the hidden guardian → 400 without detail; an in-book guardian is still named; the owner sees both |
| Locally on `c046ecfc` (main `b795fdba` + the fix) | `tsc` clean; `check:rbac`, `check:migrations`, `check:calc`, `check:colors`, `check:asany` (≤ baseline 3429, no new cast), `check:mathimports`, `lint` pass; `npm test` 503 passed / 42 DB-only skipped; full DB run against the 272-migration database as `mfd_app` (RLS enforced) **545 / 545**; the browser check re-run on this head **21 / 21** |
| GitHub CI (`ci.yml`, `main`'s workflow) on `0c4f9e7e`, `ea287acf` and `c046ecfc` (runs 312, 314, 315) | all three jobs green; the DB job ran `guardian-link-db.test.ts` 16 / 16 (528 / 528 on `0c4f9e7e`). **Note:** `main`'s CI DB job uses a service container and connects as the superuser `postgres` ("Row-Level Security is NOT enforced" in its log) — a weakness of `main`'s CI, not of this patch; the local runs above use the restricted role. The RTA release's CI (runner PostgreSQL, restricted role, no-skip guard) runs the same tests with RLS enforced: run 316 on the integrated candidate |

## 5. Existing records (read-only; no repair)

`docs/security/g1-guardian-impact.sql` — counts per firm and masked examples
(…last 6 of the minor's record id): links to missing / merged / deleted /
minor / non-person / non-individual-PAN / under-18 records; shared PANs; typed
PAN ≠ linked PAN; guardian in another RM's book or branch; the copy diverging;
who made each Client-Master link since 2026-10-13 and whether the guardian is
outside that user's book today; linked minors with no own assessment, the MF
proposals sent to them and the messages that used `risk.*` / `suitability.*`.
**Production was not accessed from development: no production figure exists
until the DBA runs it.**

Reviewed remediation procedure (each step a person's decision, in the CRM,
audited — never a bulk SQL change, never a merge):

1. The privacy / compliance reviewer receives §1–§4. Any `guardian_outside_actor_book_today` > 0 at a firm with the data wall on is a **potential unauthorized disclosure**: the reviewer records which user saw which client's name / risk category and decides on notification under the firm's privacy procedure.
2. For each flagged link, the firm's owner opens the minor: confirm the guardian (no change), re-pick the right one, or unlink (Edit page — now scope-checked and audited). A merged guardian is re-picked as the survivor.
3. For each MF proposal / message that rested on a copy: compliance decides whether the recommendation needs a fresh assessment of the minor's account; the RM records it; nothing is withdrawn automatically.
4. Re-run the SQL: the counts the decisions addressed fall to 0 or are recorded as accepted.

## 6. Production rollout (NOT executed — needs the owner's explicit authorization)

Independent of the RTA Import Engine: the branch is `main` (`b795fdba` when
verified) + this patch only (no RTA-engine file, no migration).

1. **Approve**: owner authorizes the hotfix deployment in writing; reviewer reads the diff (22 files) and this document.
2. **CI**: open a pull request `claude/g1-guardian-hotfix` → `main`; GitHub CI green (`ci.yml`'s three jobs). Re-check that `main` has not moved (else merge it in, re-run).
3. **Pre-deploy read-only snapshot**: DBA runs `g1-guardian-impact.sql` and keeps the output (baseline for §5).
4. **Change lock**: `bash scripts/prod-change.sh status`, then `acquire "G-1 guardian hotfix" "<session>"` (stop on exit 3).
5. **Deploy**: merging the pull request deploys `main` (the "Deploy to AWS (EC2)" workflow; blue-green, health-gated). No migration runs (the ledger stays at 272: verify `SELECT count(*) FROM _applied_migrations` = 272 after).
6. **Verify** (production, as the operator, no client data copied out): `GET /api/health` 200; with a designated **test firm** and two test RM users created for verification: a minor in RM A's book, a guardian in RM B's book → typing the guardian's PAN on the minor does not link; picking it answers the generic 400; the Edit page shows "A client outside your book"; the owner can link it; `investor.guardian_linked` audit row written. Then re-run §2 of the impact SQL with `made_at` after the deploy time: `guardian_outside_actor_book_today` must be **0**.
7. **Release the lock** with the result: `release "<session>" "PASS: …"`.

**Rollback**: code only (no migration, no data change) — `bash scripts/rollback-bluegreen.sh` to the previous colour, or redeploy the `main` commit that was serving before (`b795fdba` when verified — confirm in PR-3) with `scripts/manual-deploy.sh <sha>` under the change lock. Audit rows written by the hotfix stay (harmless). Links made under the hotfix are valid under the old code too.

**Monitoring for 14 days**: daily, §2 of the impact SQL for links made since the deploy (expect 0 outside the actor's book) and `SELECT count(*) FROM audit_log WHERE action LIKE 'investor.guardian_%' AND at > now() - interval '1 day'`; any 4xx spike on `/api/investors` in the web logs (a legitimate pick refused would surface as user reports of "can't be linked as this minor's guardian").

**Configuration-only containment available today: none that closes the hole.**
There is no flag for guardian linking. Hiding the `risk_profile` field in a
subscription's `allowed_fields` hides risk displays but not the link or the
name. Switching the firm data wall OFF makes things wider, not narrower.
Interim operational containment until deployment: instruct staff not to type
guardian PANs on minors (pick from their own clients), and have the
owner / compliance review §2 of the impact SQL daily.

## 7. Preserved behaviour

- A minor linked to a guardian the user can open: the link, the 0234 triggers (which keep copying and following the guardian's profile on the row) and the Edit page naming the guardian are as since 2026-10-13. **Changed by §8:** the guardian's category is shown as the guardian's ("Guardian's own risk profile — not this account's"), and every screen, export, message and gate shows the MINOR's own assessment as the minor's risk.
- The owner and anyone with the whole book can link any eligible guardian.
- One guardian may be linked to any number of minors (no one-minor rule).
- Adults' risk profiles, gates, proposals and messages read exactly as before.
- Creating a minor never fails because a typed PAN did not resolve; only an explicit pick of an ineligible record is refused.
- The legacy RTA master import's own guardian linking (`src/lib/rta/import.ts` step 6, the registrar's stated guardian PAN) is unchanged: it is a system path with no user, and the impact SQL counts its results like any other link.

## 8. Final hardening (owner's instruction of 2026-10-14, second round)

### 8.1 One rule for every reader (Task 1)

The first fix blanked the copy on five screens for a viewer who could not open
the guardian. Two read-only inventories then found **about 45 more readers**
of the copied columns: the Clients list API and page, both client exports, the
mobile 360 view, the change-history route, the Risk Profiles tabs and
"suggested" marker, the RM / branch desks, command centre, next best action,
health scores, family pages, filters and segments, the risk-drift report,
meeting prep, discovery (including the public `/fd/` link), the proposal page,
the proposal PDF (staff, emailed, public), AI prompts, client-message merge
tokens, workflow subjects and outbox events, and the expiry / drift scanners.
Blanking per viewer cannot work for most of them (a message, an automation or
a PDF has no viewer), so the rule is now:

> **For a minor, the risk fields are the minor's own latest assessment
> (`risk_profile_responses` for the minor's account), never the row's copy —
> for every reader, every viewer. For everyone else, the row, exactly as
> before.** The guardian's profile appears only as the guardian's, labelled,
> through the link, to a user who may open the guardian (`guardianForViewer`).

The minor's own assessment is the minor's information, so whoever may see the
minor may see it — no viewer check is needed, and the same value is the safe
input for suitability. Helpers in `src/lib/risk-profile/own-assessment.ts`:
`clientRiskSql(alias)` (SQL), `withOwnRiskForMinors` / `withOwnRiskForMinor`
(rows already fetched), `suitabilityProfile` (one client). Every changed site
carries the comment "A minor's risk is their own assessment, never the
guardian's copy (G-1)".

Server-side, never only in the browser: the values are replaced in the query
or before the response / RSC payload is built.

Access fixes found on the way (pre-existing, same class of defect):

| Route | Was | Now |
|---|---|---|
| `GET /api/audit?entityType=investor&entityId=` (ChangeLog drawer) | any user could read the full before / after rows of ANY client by id — e.g. the hidden guardian's id the minor's record returns | the caller must be able to open the client (`investorScopeSql`), else 404; a minor's history has the risk fields blanked (they are copies of whichever guardian was linked) |
| `POST /api/ai/qrr-commentary` | any investor id accepted (capability only) | `loadViewableInvestor`, 404 before any model call |
| Risk-drift report | managers / `reports.*` saw the whole firm regardless of the data wall | `investorScopeSql` added |
| Client Excel export | "Risk score" column ignored the licence's risk-field gate | gated like "Risk profile" |

Not changed, stated for the record: `type_details.guardian` (the guardian's
name / PAN / relation / contact TYPED on the minor's record) is part of the
minor's own account record (a registrar requires it) and is shown with the
minor; a link made before the fix may have pre-filled it from the guardian's
record — the impact SQL's `typed_pan_differs` and §2 counts point a reviewer at
those. The legacy RTA master import's guardian link (registrar-stated PAN) is
untouched (RTA code freeze); its links are read under the same rule.

### 8.2 Migration 0234 — what it does, and the smallest safe correction (Task 2)

| Question | Finding |
|---|---|
| Fields copied | `risk_profile`, `risk_profile_score`, `risk_profile_signed_at`, `risk_profile_provisional` (not `risk_profile_version`). |
| Events that refresh the copy | BEFORE INSERT / **any** UPDATE of a row with `investor_category = 'minor'` and a link (an address edit re-copies); AFTER UPDATE of the guardian's four risk columns (pushed to every linked minor). |
| Events that do NOT | Unlinking (the copy stayed and became the minor's "own"); the minor changing type (turning 18: the copy stayed as the adult's own); the guardian merged, trashed or purged (purge cleared the link, the copy stayed); `is_minor` without the category. |
| The minor's own assessment | Recorded in `risk_profile_responses`, but the row is immediately overwritten by the copy while a link exists — the row never shows it. |
| Distinguishable? | **No**, not on the row: same columns, `provisional` false, the guardian's signing date. |
| Unauthorized readers | §8.1 — about 50 sites, now on the rule. |
| Stale data after link / unlink | Yes, before this patch — now: removing a link in the application (edit, turning adult, re-typed PAN, merge into a non-guardian, purge) writes back the minor's own latest assessment or nothing (`minorOwnRiskColumns`), audited; a link removed by any other writer still leaves a stale copy, which no reader uses (§8.1) and the impact SQL counts (§5 of the SQL). |
| Misleading history after a guardian change | Yes: the copy silently replaces category and "signed" date with the new guardian's; the old values exist only in the `investor.update` audit rows. Proposals store no risk snapshot (the proposal page reads the live value — now the minor's own), so nothing stored is rewritten. |

**Smallest safe correction (proposed for separate review, NOT applied):**
`docs/security/proposed-0245-minor-risk-no-copy.sql` drops the two triggers and
their functions — no data change, rollback re-creates them from 0234. Once the
copy stops, the minor's row holds only what is recorded for the minor, and the
guardian's profile is read through the authorized relationship
(`guardianForViewer`) — no duplication of another client's data. Clearing the
copies already on minors' rows is a separate, reviewed, dry-run-first
remediation (§5 step 5) under the change lock. The application code of this
patch is correct with or without the migration (it never reads a minor's row
risk).

### 8.3 Suitability (Task 3)

| Check | Result |
|---|---|
| MF proposal generation | The builder's prefill (`loadProposalSnapshot`) reads `suitabilityProfile`: a minor with no own assessment is "Not completed". |
| Proposal send | `POST /api/proposals/[id]/send` gate reads the same snapshot; the alignment check reads `suitabilityProfile`. The proposal page's suitability panel and the proposal PDF (staff, emailed, public) now read it too — they no longer contradict the gate. |
| Opportunity journey | `loadFacts` reads `suitabilityProfile`; the "client-confirmed profile within 12 months" gate stays closed on a copy. |
| An incorrect guardian link | Cannot pass any gate: a minor's suitability never reads the row, linked or not — including a stale copy left on an unlinked minor (tested). |
| Display | Inherited and assessed are separate on the Edit page, new-client form, client summary strip, Risk Profiles page and export ("Guardian's own risk profile — not this account's"). |
| Earlier snapshots | Proposals store no risk snapshot; the stored suitability note, override reason and per-scheme reasons are untouched. Nothing stored is rewritten. |
| Provisional own assessments | An age-band suggestion recorded for the minor's account is provisional and satisfies no gate (unchanged rule). |

### 8.4 Refused typed guardian PAN (Task 4)

Creating or editing a minor with a typed guardian PAN that links nobody (no
client, a shared PAN, another RM's client, an HUF / company PAN, a teenager)
now:

- still saves the minor (with the guardian's details as typed) — the minor is
  never blocked for a typed PAN;
- answers `guardianLinked: false` plus ONE fixed notice
  (`GUARDIAN_PAN_NOT_LINKED`) that never says why, shown to the user as a
  warning ("Guardian not linked");
- records `investor.guardian_not_linked` (`{ via: "pan" }` — no reason, since
  the minor's history is visible to its RM);
- never carries a copied profile: an unlinked minor has no guardian's risk.

Re-typing the guardian PAN on a linked minor to a DIFFERENT person moves the
link to that person when they may be linked, else removes it (and its copy)
with the same notice — a record must never name one guardian and copy
another's profile.

### 8.5 Evidence

See the evidence table below (§8.6) — filled from the runs of this patch.

## 9. Decision note — minors and their guardians (for the business owner and the compliance reviewer)

**What the CRM does today (interim, until you decide):** a minor's risk
profile, for every screen, export, message and suitability gate, is ONLY an
assessment recorded for the minor's own account. The guardian's own profile is
shown beside it, labelled as the guardian's, to staff who may see the
guardian. A minor with no assessment of its own is "not profiled": no MF
proposal can be sent for it.

**The question:** for a minor's mutual fund investments, what assessment
establishes suitability?

| Option | What it means | Consequence |
|---|---|---|
| A. The minor's account is assessed on its own (interim rule) | The guardian answers the questionnaire **for the minor's account** — horizon, objective and capacity are the minor's (often long horizon, education goal); recorded and signed for the minor. | Each minor needs one assessment; nothing is shared between clients; matches how the CRM now behaves. |
| B. The guardian's own profile stands for the minor | The guardian's assessment of themselves is reused for every minor they represent. | Needs a documented policy reason; one guardian's profile change silently changes every minor's suitability; the migration in §8.2 would NOT be applied and the copy would need an explicit, visible "inherited from guardian on <date>" marker before any gate could use it. |
| C. Both | The minor's account is assessed; the guardian's profile is a cross-check (e.g. a warning if the minor's portfolio exceeds the guardian's band). | Most information; most work. |

**Please decide:**

1. Which option is the firm's suitability policy for minors (A, B or C)?
2. Should migration `proposed-0245-minor-risk-no-copy.sql` (stop copying) be
   scheduled for review? (Recommended with A or C.)
3. For minors whose MF proposals were sent while only a copy existed (impact
   SQL §3): does each need a fresh assessment of the minor's account before the
   next recommendation?
4. Privacy: for links where a user saw a client outside their book (impact SQL
   §2), the reviewer decides whether a notification is required under the
   firm's privacy procedure.
