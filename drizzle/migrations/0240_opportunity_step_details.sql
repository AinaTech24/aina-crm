-- Opportunity step actions (lib/opportunities/steps.ts): each step of the
-- journey asks for what it needs, as the lead journey does.
--
--   meeting_id    the meeting scheduled from the opportunity, so "Meeting done"
--                 completes that meeting and completing the meeting in the
--                 Meetings module moves the opportunity on.
--   step_details  what each step recorded, by stage key: the call date and
--                 outcome, the UCC number, the mandate reference, the order
--                 placed, the policy number …
--
-- Additive: two nullable / defaulted columns; no RLS change (same table).

ALTER TABLE client_opportunities
  ADD COLUMN IF NOT EXISTS meeting_id uuid REFERENCES review_meetings(id) ON DELETE SET NULL;
ALTER TABLE client_opportunities
  ADD COLUMN IF NOT EXISTS step_details jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS client_opportunities_meeting_idx
  ON client_opportunities (meeting_id) WHERE meeting_id IS NOT NULL;
