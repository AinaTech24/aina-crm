-- 0229 — The firm's public feedback form.
--
-- One link per firm, /feedback/<token>, for the firm to put on its website or
-- in its email signature (Client Feedback → "Feedback link for website &
-- email"). Unlike a client's personal /f/<token> survey link it can be used by
-- anyone, any number of times. A response is filed as a closed `feedback`
-- service request, as the personal survey's are, so it counts towards the
-- firm's NPS — see src/lib/feedback/web-form.ts.
--
-- The token is random rather than the firm's name so the link can be replaced
-- if it is ever spammed. NULL until the firm first opens that page. Additive
-- only: a running deploy that does not know these columns ignores them.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS feedback_form_token text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS feedback_form_enabled boolean NOT NULL DEFAULT true;

-- Unique where set; Postgres treats NULLs as distinct, so firms without a link
-- do not collide.
CREATE UNIQUE INDEX IF NOT EXISTS tenants_feedback_form_token_unique
  ON tenants (feedback_form_token);
