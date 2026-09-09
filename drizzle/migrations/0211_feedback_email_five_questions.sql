-- The feedback email promised "one question"; the form now asks five.
--
-- Every firm already has this template as a ROW (seeded by 0206 / the signup
-- installer), so editing the starter definition only helps firms created from
-- here on. This corrects the copy already in the field.
--
-- It replaces the stale SENTENCES inside the stored body rather than
-- overwriting the whole body, so a firm that has reworded or restyled anything
-- else keeps its version — only the sentences that are now factually wrong
-- change. Bodies are edited as text and cast back to jsonb; none of the
-- replaced strings contain JSON metacharacters.
--
-- TWO wordings of the "one question" line are in the field: the one 0206
-- seeded, and a shorter one from the later design pass that reached firms
-- created after it. Both are handled — a replace() that does not match is a
-- no-op, so listing both is safe.
--
-- Guarded by a LIKE on the stale phrase, so it is idempotent and skips any firm
-- that has already rewritten that line themselves.

UPDATE template_versions tv
SET body = replace(
             replace(
               replace(
                 replace(
                   tv.body::text,
                   'One question, about a minute',
                   'Five quick questions, about a minute'
                 ),
                 'We would like to hear from you. On a scale of 0 to 10, how likely are you to recommend {{tenant.displayName}} to a friend or colleague?',
                 'We would like to hear from you. It is five short questions about how we are doing — your reviews, how quickly we respond, how clearly we explain things, and whether you would recommend us. Each one is a simple 0 to 10 rating.'
               ),
               -- Wording seeded by migration 0206.
               'It is one question and an optional comment box, so it should take about a minute. You do not need to log in anywhere.',
               'About a minute in total, with an optional comment box at the end. No login needed.'
             ),
             -- Shorter wording from the later email-design pass.
             'It is one question and an optional comment box - about a minute, with no login needed.',
             'About a minute in total, with an optional comment box at the end. No login needed.'
           )::jsonb
FROM templates t
WHERE t.id = tv.template_id
  AND t.key = 'feedback_nps'
  AND t.channel = 'email'
  AND tv.body::text LIKE '%It is one question and an optional comment box%';
