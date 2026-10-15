# G-1 — Guardian-PAN link: security hotfix (development only)

**Status (2026-10-15): release candidate for the owner's explicit
authorization — `claude/g1-guardian-hotfix` at `00e07718` (code) + the docs
commit that follows it, on top of `main` `74dc6c6e` (what production runs —
deploy run 299; `origin/main` re-fetched 2026-10-15 and unchanged).** It holds
the first fix (`0c4f9e7e`, `ea287acf`), the final hardening of §8 and the
incomplete-onboarding controls of §10. Not merged to `main`, not deployed,
nothing run against production, no migration. Pushing to `main` deploys
(§13.6); that needs the owner's separate, explicit authorization (§13.10).
Acceptance matrix: §14. Interim minor-suitability policy for decision: §12.
Proposed 0245: assessed in §11, not applied. §6 is superseded by §13.

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

## 6. Production rollout — SUPERSEDED by §13 (kept for the record)

Independent of the RTA Import Engine: the branch is `main` (`74dc6c6e` when
verified) + this patch only (no RTA-engine file, no migration).

1. **Approve**: owner authorizes the hotfix deployment in writing; reviewer reads the diff (22 files) and this document.
2. **CI**: open a pull request `claude/g1-guardian-hotfix` → `main`; GitHub CI green (`ci.yml`'s three jobs). Re-check that `main` has not moved (else merge it in, re-run).
3. **Pre-deploy read-only snapshot**: DBA runs `g1-guardian-impact.sql` and keeps the output (baseline for §5).
4. **Change lock**: `bash scripts/prod-change.sh status`, then `acquire "G-1 guardian hotfix" "<session>"` (stop on exit 3).
5. **Deploy**: merging the pull request deploys `main` (the "Deploy to AWS (EC2)" workflow; blue-green, health-gated). No migration runs (the ledger stays at 272: verify `SELECT count(*) FROM _applied_migrations` = 272 after).
6. **Verify** (production, as the operator, no client data copied out): `GET /api/health` 200; with a designated **test firm** and two test RM users created for verification: a minor in RM A's book, a guardian in RM B's book → typing the guardian's PAN on the minor does not link; picking it answers the generic 400; the Edit page shows "A client outside your book"; the owner can link it; `investor.guardian_linked` audit row written. Then re-run §2 of the impact SQL with `made_at` after the deploy time: `guardian_outside_actor_book_today` must be **0**.
7. **Release the lock** with the result: `release "<session>" "PASS: …"`.

**Rollback**: code only (no migration, no data change) — `bash scripts/rollback-bluegreen.sh` to the previous colour, or redeploy the `main` commit that was serving before (`74dc6c6e` when verified — confirm in PR-3) with `scripts/manual-deploy.sh <sha>` under the change lock. Audit rows written by the hotfix stay (harmless). Links made under the hotfix are valid under the old code too.

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

### 8.5 Evidence (hardening commit `00b2f7a9`, local; GitHub CI in §8.6 once run)

| Check | Result |
|---|---|
| `tests/guardian-exposure-db.test.ts` (new) — real PostgreSQL, restricted role `mfd_app`, data wall on, real route handlers | **12 / 12**: refused typed PAN on Create / Edit (one notice, never why; audited without a reason; a linking PAN gives no notice); a re-typed PAN moves the link or removes link + copy; unlink writes back the minor's own assessment or nothing; turning adult removes link + copy (audited); merge into an HUF survivor clears the copy, un-merge restores link + copy; purging a guardian clears its minors' copy; `GET /api/audit`: another book's client 404, a minor's history carries no copied risk although the stored rows do, the guardian's RM reads it; Clients list API (RM and owner), Excel export and clients export: the minor's risk is its own; Risk Profiles bucket = not profiled and a risk filter does not match the minor on a copy; a stale copy on an unlinked minor satisfies nothing; proposal PDF risk line is the minor's own; message tokens / workflow subject read the minor's own; QRR AI route 404 outside the book before any model call |
| The same 12 against the code BEFORE this round (`e5942b59`) | **12 / 12 fail** — 11 on the defect itself (the copy or the guardian's `very_aggressive` came back, the history route answered with the secret, the AI route answered 200 and called the model, the bucket said "current", the stale copy said "moderate" …); 1 (messages) fails on a missing export, so it proves nothing about the old code |
| `tests/guardian-link-db.test.ts` (updated to the rule) | **16 / 16** |
| `tests/minor-risk-sql.test.ts` (new, pure) | **2 / 2** — the filter catalog's string equals `clientRiskSql("inv").category`; every expression reads the minor's own assessment and the row for others |
| Browser `scripts/g1-guardian-ui.mjs` (Chromium, real Next dev server, licensed firm, data wall on, a pre-fix cross-book link) | **31 / 31** — Edit page, client page, Risk Profiles list (row risk null AND no guardian's profile beside it), Clients list page: raw HTML + RSC payload and live DOM carry no hidden guardian name / risk; minor API null; guardian 404; guardian's history 404; minor's history clean; `GET /api/investors` clean; refused pick 400; in-book guardian still named; the owner sees the guardian's name, the minor's own (empty) risk, and the guardian's profile labelled as the guardian's |
| Static checks on the hotfix tree | `tsc`, `lint`, `check:rbac`, `check:migrations`, `check:colors`, `check:asany` (≤ 3429), `check:mathimports`, `check:labels`, `check:sql`, `check:calc`, `check:finance`, `check:spine` — all pass |
| Unit (no DB) | **505 passed** / 54 DB-only skipped |
| Full DB suite on the 272-migration database as `mfd_app` (RLS on) | **559 / 559** |
| Impact SQL (`g1-guardian-impact.sql`, incl. new §5) | runs read-only (`default_transaction_read_only=on`) without error on the test database |
| GitHub CI on `7b283e61` (run 326, `main`'s `ci.yml`) | all three jobs green; DB job 559 / 559 incl. guardian-link 16, guardian-exposure 12, minor-risk-sql 2 (as the superuser — `main`'s CI does not enforce RLS; the local runs above do) |
| After merging `main` `74dc6c6e` (`cec1ae7e`): 7 conflicts, all where both sides edited a reader — imports kept both; the RM-desk data gaps and the completeness checklist keep main's type rules with the minor's own risk; main's new code adds no risk reader (sweep identical) | all static checks pass; unit **513** passed / 54 DB-only skipped; full DB **567 / 567** (`mfd_app`, RLS on); browser **31 / 31** |

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

> §9 is answered for the interim by §12 (the owner's proposed interim control
> of 2026-10-15); its options remain the long-term question.

## 10. Incomplete minor onboarding — a refused typed guardian PAN (2026-10-15)

A typed guardian PAN that links nobody still saves the minor — the guardian
may simply not be a client, and refusing would tell the user why (shared PAN,
another RM's client). It can no longer pass for complete.

| Owner's requirement | How it is met | Evidence |
|---|---|---|
| 1. Explicit warning | Create and Edit answer `guardianLinked: false` + `guardianNotice`: "Saved — but the guardian is not linked to a client record, so the guardian is NOT VERIFIED … No mutual fund proposal can go to this minor until the guardian is linked or the owner or compliance confirms them …" — shown as a warning toast. | `guardian-verification-db` #1, `guardian-exposure-db` #1 |
| 2. Clearly incomplete | A status DERIVED from the record and its audit trail (`lib/investors/guardian-verification.ts`; no table, no migration): **linked** (guardian client on record) · **confirmed** (owner / compliance verified it, after the last refusal) · **pending** (latest guardian event is a refused typed PAN, a removed link, or a link the row no longer carries) · **not_recorded** (no guardian event — saved before this rule). The client page shows "Guardian not verified" for pending. `GET /api/investors/[id]/guardian-verification`. | DB #1, #4; browser (RM A and owner) |
| 3. Guardian-dependent workflows not "verified" | The status is the only "verified" signal; nothing else treats an unlinked guardian as verified. | — |
| 4. MF gates cannot pass | Journey gate for **proposal** (MF) and **MF transaction** adds "The minor's guardian verified" (unsatisfied while pending); `POST /api/proposals/[id]/send` answers **412** `field: "guardian"`. Both apply even when the minor's OWN assessment is current; neither can be satisfied by the guardian's profile or the 0234 copy (§8). | DB #1, #3; mutation: removing either gate fails the test |
| 5. No duplicate on retry | The minor's key is `MINOR:<own PAN>` or `MINOR:<guardian PAN>:<NAME>`; the unique index refuses a second record. **Defect found and fixed:** the create route detected the violation from `err.message`, which Drizzle wraps — a retry answered **500** (still no second record). It now reads `.cause` as the PATCH route does and answers **409**. | DB #2 (two retries, one record, one refusal in history); mutation: the old check fails it |
| 6. Audited resolution | (a) Link the guardian's client record in the Guardian section (`investor.guardian_linked`), or (b) owner / compliance (`compliance.approve`) "Confirm guardian" with a note of what was checked → `POST …/guardian-verification`, written straight to `audit_log` as `investor.guardian_verified` (actor, note, before/after) — the status IS that row, so an unrecorded confirmation never takes effect. An RM gets 403; a second confirmation 409; a later refused PAN makes it pending again. | DB #3, #4; browser |
| 7. No leak in messages | The refusal, the notice, the 412 and the 409 are fixed sentences: no name, PAN, guardian, RM or "exists in another book". A user who cannot open the minor gets 404 on the status route. | DB #1–#4 assert no hidden name / PAN / risk in any response |

**Limitations (explicit):**

- **`not_recorded` is not blocked.** Minors saved before this rule with no
  guardian link and no guardian event (e.g. the RTA import, or a typed PAN
  before 2026-10-14) are not treated as pending: blocking them is a policy
  change for the firm (§12, decision 5). Impact SQL §7 counts them.
- **The 409 is an existence oracle, as for every client.** Retrying with the
  same name and guardian PAN says "a client with these details is already on
  record" — the same as the PAN dedup check every client create has always
  had. It names nobody. A retry with a differently spelled name creates a
  second minor (the key includes the name); Merge Clients resolves it.
- **Confirmation is one person.** The owner or a compliance user confirms
  alone; there is no two-person rule and the confirmer may be the creator.
- **The note is free text** visible in the client's history to whoever can
  open the client — staff should record what was seen, not copy documents.

## 11. Proposed migration 0245 (stop the 0234 copy) — assessment, not applied

Tested only on disposable local copies (`mfd_p245`, `mfd_p245r`, created from
the hotfix test database), never on any shared database.

| Question | Finding |
|---|---|
| Does anything else depend on the copy? | `pg_depend`: the two functions are used only by their two triggers; no other function body names them. The application reads no minor's row risk since §8 (sweep re-run 2026-10-15). The RTA candidate (`44468322`) reads `guardian_investor_id` (`isGuardianOf`) but never the copied fields and never names the triggers. The index `investors_guardian_idx` from 0234 is kept (0245 does not drop it). |
| Full suite with 0245 applied | **561 / 573 pass.** The 12 failures are all one kind: a test PRECONDITION asserting the copy exists on the row (e.g. `expect(row.risk_profile).toBe("moderate") // 0234's copy`). With those 16 copy-only assertions removed in scratch copies (not committed), all **28** guardian-link / exposure tests pass, plus the 6 onboarding tests — linking, re-typing, unlinking, turning adult, merge (incl. into an ineligible survivor), **un-merge restoring the link**, purge, history, filters and gates behave the same. |
| Historical records intact | Forward: a hash of every investor row's risk columns + link, the `risk_profile_responses` count and the `audit_log` count are **identical** before and after; re-applying is a no-op. Copies already on rows stay (a separate, reviewed clean-up). |
| Merge / un-merge / minor → major | Unaffected (above): they move or clear the LINK in application code; G-1 writes back the minor's own assessment or nothing on unlink. |
| Existing copies | Need a separately approved, dry-run-first review (impact SQL §5 sizes them). 0245 changes none. |
| Rollback | `docs/security/proposed-0245-rollback.sql` = 0234's function and trigger definitions verbatim, **without** 0234's closing backfill UPDATE, so a rollback changes no row. Tested forward → rollback: data hash unchanged throughout; `pg_get_triggerdef` and function bodies identical to 0234's; a newly linked minor is copied again. In the chain a rollback ships as a new forward migration. |
| Numbering | `main` (`74dc6c6e`) ends at 0234; the RTA candidate (`44468322`) at 0244; 0245 is free on both. On the RTA branch the new file must be added to `checksums.lock.json` (a new file, which the immutability check allows). |

**Risk assessment:** low technical risk (no data change, dependency-free,
tested rollback). The real change is behavioural — a guardian's later profile
change no longer reaches the minor's row — which the application already
ignores. Prerequisite: the policy decision of §12 (it formally retires the
firm's 2026-10-13 rule). Recommended ordering: deploy the hotfix (it does not
need 0245) → decide §12 → review and schedule 0245 as its own change under
the change lock → then the separately approved clean-up of stored copies.
**Not run, not merged.**

## 12. Interim minor-suitability control and the decision note

**Proposed interim control (the owner's wording, 2026-10-15):**
"A minor investment account requires its own explicitly verified
account-specific suitability assessment, recorded through the authorized
guardian where appropriate. A guardian's personal risk profile is supporting
context only and is not automatically the minor account's suitability
assessment."

**What the CRM enforces today (verified, §8 + §10):**

- Every suitability reader (proposal send gate, journey gate, snapshot,
  appetite, PDF, client links, messages, AI) uses only the minor's own latest
  `risk_profile_responses` row — never the 0234 copy and never the guardian's
  profile. Tests: `guardian-link-db` "suitability …", `guardian-exposure-db`
  "stale copy … satisfies nothing", `guardian-verification-db` #1.
- A confirmed, non-provisional assessment of the minor's account signed in the
  last 12 months is required for an MF proposal (unchanged rule, now applied to
  the minor's own record).
- A minor whose guardian is pending verification cannot get an MF proposal
  even with its own assessment (§10).
- The guardian's own profile is shown only as "Guardian's own risk profile —
  not this account's", to staff who may open the guardian.
- Nothing rewrites, deletes or re-dates existing suitability history.

**What the CRM does NOT yet enforce (the control's gaps — for decision, not
built):** it does not record WHO attested the minor's assessment (the
questionnaire records `signed_by_name` and an OTP / RM-entry method, not "as
guardian of"); an RM can still record a category directly ("rm_entry", the
same as for adults) and that counts as the minor's own assessment; it does not
force reassessment on a change of guardian or at 18.

**Decisions needed (owner + compliance; nothing here is a regulatory claim):**

1. **Who completes and attests** the minor's assessment — the guardian on
   record only (link or confirmed), or also the RM entering it? Should an
   RM-entered category count for a minor at all?
2. **Whose assessment it is** — recorded against the minor's account (the
   CRM's behaviour now) with the attesting guardian named, or treated as the
   guardian's?
3. **When reassessment is required** — the current 12-month rule only, or also
   on a material change (goal, horizon)?
4. **Change of guardian** — does a new guardian invalidate the existing
   assessment (block MF proposals until re-attested), or carry it?
5. **Minor becomes major** — the CRM now drops the guardian link and keeps the
   account's own assessment. Should turning 18 force a fresh assessment by the
   (now adult) client before the next recommendation? And should older minors
   with no guardian event (`not_recorded`, §10) be blocked like `pending`?
6. **Existing assessments and historical proposals** — impact SQL §3 / §6 list
   minors whose proposals may have rested on a copy. Review case by case; the
   CRM changes no history. Does each need a fresh assessment of the minor's
   account before the next recommendation?

Each answer that adds a rule is a separate, small change after this hotfix.

## 13. Release plan for the production hotfix (NOT executed)

### 13.1 Exact release
- **Branch** `claude/g1-guardian-hotfix`; **code commit `00e07718`**, plus the
  docs-only commit that records this plan (the head when authorized; nothing
  but `docs/` and `CLAUDE.md` after `00e07718`).
- **Base**: `main` `74dc6c6e` (production). `origin/main` re-fetched
  2026-10-15: still `74dc6c6e` → compatible, no integration needed. **If
  `main` has moved when the release is authorized, stop and request review
  before merging it in.**
- **Changed vs `74dc6c6e`**: 84 files — 72 under `src/` (17 API routes, 10
  dashboard pages, 9 `lib/investors`, 5 investor components, 4 exports, 4
  dashboard loaders, 3 `lib/risk-profile`, 3 families, 2 metrics, 2 comms, 1
  each in workflow, workflow-rules, reports, proposals, proposal, opportunities,
  nba, filter, discovery, command-center, portal and two workers), 6 test
  files, 1 browser script, `CLAUDE.md`, 4 files in `docs/security/`. Full list:
  `git diff --name-status 74dc6c6e <head>`.

### 13.2 Evidence (2026-10-15, on `00e07718`)
| Check | Result |
|---|---|
| Static: `lint`, `check:types`, `check:rbac`, `check:migrations`, `check:colors`, `check:asany` (≤ 3429), `check:mathimports`, `check:labels`, `check:sql`, `check:calc`, `check:finance`, `check:spine` | all pass |
| Full vitest suite against a 272-migration database as `mfd_app` (no superuser, no BYPASSRLS — RLS enforced) | **573 / 573** |
| Unit only (no DB) | **514** passed, 59 DB-only skipped |
| Guardian suites | link 16, exposure 12, verification 6, minor-risk-sql 2 |
| Mutation checks this round | removing the send-route gate, the journey gate or the `.cause` 409 each fails `guardian-verification-db` |
| Browser (`scripts/g1-guardian-ui.mjs`, Chromium, real Next server, data wall on, a pre-fix cross-book link with the guardian's `very_aggressive` copy on the minor's row) | **51 / 51** (§14) |
| Impact SQL | runs read-only without error; §6 exercised with a seeded proposal on a throwaway copy |
| GitHub CI | to be read on the pushed head (`main`'s `ci.yml`; its DB job runs as the superuser, so the RLS evidence is the local run above) |

### 13.3 Database changes
**None.** No migration, no data change; the ledger stays at 272. 0245 is NOT
part of this release (§11).

### 13.4 Change lock
`bash scripts/prod-change.sh status` → `acquire "G-1 guardian hotfix" "<session>"`
(exit 3 = someone else holds it: stop and wait) → deploy → checks →
`release "<session>" "PASS: …"`. One change at a time; no other production
change during the window.

### 13.5 Backup / recovery prerequisites
No schema or data change, so recovery is a code rollback. Before deploying,
confirm (read-only, `--profile aina-ops`) that the latest RDS automated
snapshot is from the last 24 h and point-in-time restore is enabled — the
standing safety net, not a step this release needs. Run impact SQL §1–§8
read-only and keep the output (the "before" baseline).

### 13.6 Deployment trigger
`deploy.yml` runs on **any push to `main` or `deploy/aws`** (and manual
dispatch): merging the pull request IS the deploy (blue-green via SSM,
health-gated; the migrate step finds nothing to apply). Therefore: open a PR
`claude/g1-guardian-hotfix` → `main` only when authorized; CI green on the PR
head; merge only inside the change-lock window. Never push `deploy/aws`.

### 13.7 Post-deploy tests (production, operator, designated test firm; no client data copied out)
1. `GET /api/health` 200; `SELECT count(*) FROM _applied_migrations` = 272.
2. Test firm, data wall on, two test RMs: guardian in RM B's book. RM A types
   that PAN on a new minor → 201 with the "NOT VERIFIED" notice; client page
   shows "Guardian not verified"; MF proposal send → 412; RM A "Confirm" → 403.
3. Same minor retried → 409, one record.
4. Owner confirms with a note → "Guardian verified"; `investor.guardian_verified` row exists.
5. RM A: `GET /api/audit?entityType=investor&entityId=<RM B's client>` → 404.
6. A linked minor: client page / Risk Profiles / export show the minor's own
   risk (none) — never the guardian's.
7. Impact SQL §2 for links made after the deploy: `guardian_outside_actor_book_today` = 0.

### 13.8 Monitoring and incident response (14 days)
Daily: impact SQL §2 (post-deploy links outside the actor's book: expect 0) and
§7 (pending count, so stuck minors are seen); 5xx on `/api/investors*`,
`/api/proposals/*/send`, `/api/audit` (expect none — the 409 fix removes the
duplicate-create 500); 412 `field: "guardian"` volume (expected, each a minor
awaiting confirmation). Any sign of a guardian's name or risk shown outside the
guardian's book is a security incident: take the change lock, roll back
(13.9) if the cause is the release, and notify the privacy / compliance
reviewer.

### 13.9 Containment and rollback
Code only: `bash scripts/rollback-bluegreen.sh` (previous colour) or
`scripts/manual-deploy.sh 74dc6c6e` under the lock. Nothing to undo in the
database: audit rows written by the release (`guardian_linked`,
`guardian_not_linked`, `guardian_verified`) are harmless to the old code.
**Rolling back re-opens G-1** (the old code links cross-book and reads the
copy) — use only for a release defect, and re-instate the interim
containment (staff not to type guardian PANs; daily §2 review).

### 13.10 Approval checkpoints
1. Owner: written authorization to release `<head>` (this plan).
2. Reviewer: reads the diff and §8 / §10 / §14; confirms `main` unchanged.
3. CI green on the PR head.
4. DBA: pre-deploy impact SQL run read-only and stored.
5. Change lock acquired.
6. Merge (= deploy).
7. Post-deploy tests 13.7 pass → lock released with the result.
8. Compliance: receives the impact output (§13.11) and the §12 decisions.
Separately and later: 0245 (§11), the copy clean-up, the §12 rules.

### 13.11 Production impact check (for the authorized DBA; read-only)
`PGOPTIONS='-c default_transaction_read_only=on' psql "$PROD_RO" -f docs/security/g1-guardian-impact.sql`
(a read-only role; never the master; under no write transaction). It prints
aggregates and masked ids (last 6 characters) only — never a PAN, name,
contact or portfolio figure:

| Owner's question | Section |
|---|---|
| Links to merged / deleted / minor / non-person / under-18 / non-individual-PAN records | §1, §4 |
| Duplicate-PAN links | §1 `guardian_pan_shared`, §4 |
| Links outside the creator's book | §2 (Client-Master links, judged against today's book) |
| Inherited risk | §1 `risk_not_guardians`, §3, §5 |
| Affected MF proposals | §3 (counts), §6 (one masked row per proposal: sent date, linked, guardian in another RM's book, whether the minor's OWN assessment existed at send, owner override) |
| Incomplete onboarding | §7 (linked / confirmed / pending / not_recorded) |
| Disclosure through the previously unscoped routes | §8 sizes it (client histories per firm; cross-book minors' histories). WHO read them is not in the database: search the web access logs for `GET /api/audit?entityType=investor` and `POST /api/ai/qrr-commentary/` before the deploy, join each request's session user to the client's RM / branch, and pass every read outside the reader's book to the privacy / compliance reviewer as a suspected disclosure. |

Nothing is repaired. Every non-zero count is a list for a person.

## 14. Final acceptance matrix (2026-10-15, `00e07718`, restricted `mfd_app`, RLS on)

"Hidden" = a guardian in another RM's book with `very_aggressive`, linked to a
minor in RM A's book before the fix, the copy still on the minor's row.

| Surface | Verified by | Result |
|---|---|---|
| Create Client (typed PAN, picked id) | link-db create ×7; exposure #1; verification #1–#2 | out-of-book / ineligible / shared / other-firm never link; one notice / one 400, never why; audited |
| Edit Client | link-db edit ×3; exposure #2; browser edit page | same rules; re-typed PAN moves or removes link + copy; hidden guardian not named |
| Guardian PAN lookup + direct-id linking | link-db (PAN, id, other firm, merged, HUF, minor, under 18) | refused identically |
| Restricted RM books (data wall) | all DB suites with `restrict_user_data_scope = true`; browser | no hidden name / risk |
| Client list + Client 360 | exposure "client list API"; browser client list + client page (raw HTML + RSC + DOM) | minor's own risk only |
| RM Dashboard | browser (raw + RSC + DOM) | none |
| Branch Head Dashboard | browser, branch head of the minor's branch (hidden guardian in another branch) | none |
| Risk Profiles | exposure "tabs and filters"; link-db export; browser list | copy = not profiled; no filter match; guardian named only to their RM |
| MF proposals + suitability | link-db suitability; exposure stale copy + PDF; verification #1, #3; browser new-proposal form | copy satisfies nothing; pending guardian blocks |
| Client exports | exposure (Excel export, clients module); link-db risk-profiles export | minor's own risk; hidden guardian never named |
| Emails / WhatsApp / automation merge fields | exposure "client messages and automations" (merge tokens, workflow subject, outbox event) | minor's own risk |
| AI and public responses | exposure "AI QRR … 404 before any model call"; client-brief scoped (§8.1); public proposal page / approval use the snapshot (own risk); portal no longer selects risk | none |
| Server-rendered payloads | browser raw document = HTML + RSC payload, every page above | none |
| Client history / audit routes | exposure "history"; browser guardian history 404, minor history clean | out-of-book 404; minors' copied risk stripped |

**Limitations:** (1) `main`'s GitHub CI runs the DB suite as the superuser,
so RLS is proven by the local `mfd_app` runs, not CI. (2) The browser check
covers the pages listed, not every one of the CRM's pages; the remaining
readers are covered by the SQL sweep + helper tests (§8.1). (3) Who read
client histories before the fix is not in the database (§13.11). (4) Copies
remain stored on rows until 0245 + a reviewed clean-up (§11). (5) §10's
`not_recorded` minors are not blocked pending the §12 decision.
