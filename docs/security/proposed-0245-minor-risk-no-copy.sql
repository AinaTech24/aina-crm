-- PROPOSED MIGRATION — FOR SEPARATE REVIEW. NOT APPLIED, NOT IN drizzle/migrations.
-- G-1 follow-up (2026-10-14): stop copying a guardian's risk profile onto a minor.
--
-- Why (docs/security/G1_GUARDIAN_HOTFIX.md §8): migration 0234 makes the
-- minor's own `investors` row carry ANOTHER client's risk category, score,
-- signed date and provisional flag. On the row the copy is indistinguishable
-- from an assessment of the minor's account, every reader of those columns
-- receives the guardian's information (the hotfix has to blank it on each
-- read path for a viewer who may not open the guardian), the copy survives
-- an unlink done by any writer the application does not control, and a
-- change of guardian silently replaces the "signed" date the minor appears to
-- have. The guardian's profile can be read through the relationship instead,
-- with the viewer's access (`guardianForViewer`), which needs no copy.
--
-- What this does: removes the two triggers and their functions. Nothing else.
--   * No row is changed. The copies already on minors' rows are left as they
--     are; clearing them is a separate, reviewed, dry-run-first remediation
--     (§8.4 of the hotfix document) run under the production change lock.
--   * 0234 itself is not edited (migrations are immutable).
--
-- Business decision needed first: the firm's rule of 2026-10-13 ("a minor's
-- risk profile IS the guardian's") changes to "a minor's risk profile is the
-- assessment recorded for the minor's account; the guardian's profile is shown
-- beside it". Owner and compliance sign-off required (decision note §9).
--
-- Numbering: main and the RTA release share 0233/0234; new migrations are
-- numbered from 0245 (CLAUDE.md "Fresh databases and the migration chain").
--
-- Rollback: re-create the two triggers exactly as 0234 defines them (the
-- functions' bodies are in 0234); no data to restore.

DROP TRIGGER IF EXISTS investors_guardian_risk_to_minors ON investors;
DROP TRIGGER IF EXISTS investors_minor_risk_from_guardian ON investors;
DROP FUNCTION IF EXISTS guardian_risk_to_minors();
DROP FUNCTION IF EXISTS minor_risk_from_guardian();
