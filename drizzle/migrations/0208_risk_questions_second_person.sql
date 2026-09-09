-- The risk questionnaire addressed the RM, not the investor.
--
-- Every question read "What is the client's age?", "How long does the client
-- plan to stay invested?" — fine while only an RM saw them, absurd once the
-- client fills the form themselves at /r/<token>: they were asked about "the
-- client", in the third person, about themselves.
--
-- The defaults now live in src/lib/risk-profile/questions.ts in the second
-- person, which covers every firm that never published its own template (those
-- resolve the default at runtime). This migration updates the firms that DID
-- publish one.
--
-- Matching is EXACT and per JSON field — a label, helperText or option label is
-- replaced only when it is character-for-character the string we shipped. A
-- firm that rewrote a question in its own words keeps it, and a substring like
-- "Regular income" inside a firm's own longer sentence is never mangled (which
-- a naive text replace over the whole JSON would have done).
--
-- Question keys, option values and scores are untouched, so no stored response
-- is reinterpreted — only the words on screen change.

DO $$
DECLARE
  -- old (exactly as shipped)  →  new (second person, plain English)
  m jsonb := jsonb_build_object(
    'What is the client''s age?',                                              'What is your age?',
    'How long does the client plan to stay invested?',                         'How long do you plan to stay invested?',
    'How stable is the client''s income?',                                     'How steady is your income?',
    'What % of total assets is being invested?',                               'How much of your total savings are you investing here?',
    'If the portfolio dropped 20 % in 6 months, what would the client do?',    'If your investment fell 20% in six months, what would you do?',
    'What is the primary investment objective?',                               'What are you mainly investing for?',
    'How much experience does the client have with mutual funds?',             'How much experience do you have with mutual funds?',
    'What is the client''s approximate net worth?',                            'Roughly what are your total savings and investments worth?',
    'Younger investors generally have higher risk capacity (longer time to recover).',
                                                                               'The more years you can stay invested, the more time your money has to recover from a fall.',
    'Higher concentration in this investment = lower risk capacity.',          'If most of your savings sit in one place, a fall hurts a lot more.',
    'Highly variable (freelance / commissions)',                               'It varies a lot — freelance or commission',
    'Moderately stable (some variability)',                                    'Mostly steady, with some ups and downs',
    'Stable salaried income',                                                  'A steady salary',
    'Multiple stable sources / govt / PSU',                                    'Very secure — government, PSU, or several steady sources',
    'More than 75 % of net worth',                                             'More than 75% of my savings',
    '50 – 75 %',                                                               'Between half and three quarters',
    '25 – 50 %',                                                               'Between a quarter and half',
    '10 – 25 %',                                                               'Between a tenth and a quarter',
    'Less than 10 %',                                                          'Less than a tenth',
    'Sell everything immediately',                                             'Sell everything straight away',
    'Hold and wait for recovery',                                              'Hold on and wait for it to recover',
    'Hold and gradually buy more',                                             'Hold on, and slowly invest a bit more',
    'Buy aggressively at lower prices',                                        'Invest a lot more while prices are low',
    'Capital preservation',                                                    'Keeping my money safe',
    'Regular income',                                                          'A regular income from it',
    'Balanced growth + income',                                                'A balance of growth and income',
    'Long-term capital growth',                                                'Growing my money over the long term',
    'Aggressive capital appreciation',                                         'The highest growth I can get, accepting bigger swings',
    'None — first-time investor',                                              'None — this is my first time'
  );
  r      RECORD;
  newq   jsonb;
  n      int := 0;
BEGIN
  FOR r IN SELECT id, questions FROM risk_profile_templates WHERE jsonb_typeof(questions) = 'array' LOOP
    SELECT jsonb_agg(
             q
             || CASE WHEN m ? (q ->> 'label')
                     THEN jsonb_build_object('label', m ->> (q ->> 'label')) ELSE '{}'::jsonb END
             || CASE WHEN (q ? 'helperText') AND m ? (q ->> 'helperText')
                     THEN jsonb_build_object('helperText', m ->> (q ->> 'helperText')) ELSE '{}'::jsonb END
             -- Rebuild options in order, swapping only exact matches. COALESCE
             -- keeps a question that somehow carries no options array intact.
             || COALESCE(
                  (SELECT jsonb_build_object('options', jsonb_agg(
                            o || CASE WHEN m ? (o ->> 'label')
                                      THEN jsonb_build_object('label', m ->> (o ->> 'label')) ELSE '{}'::jsonb END
                            ORDER BY o_ord))
                     FROM jsonb_array_elements(q -> 'options') WITH ORDINALITY AS opt(o, o_ord)),
                  '{}'::jsonb)
             ORDER BY q_ord)
      INTO newq
      FROM jsonb_array_elements(r.questions) WITH ORDINALITY AS qs(q, q_ord);

    IF newq IS NOT NULL AND newq IS DISTINCT FROM r.questions THEN
      UPDATE risk_profile_templates SET questions = newq WHERE id = r.id;
      n := n + 1;
    END IF;
  END LOOP;
  RAISE NOTICE '[0208] rewrote questions on % template row(s)', n;
END $$;

-- The template NAME and DESCRIPTION head the client's form. "Risk profile
-- (SEBI default)" and "Score range 8-40, mapped to Conservative / Moderate /
-- Aggressive" told the investor nothing and made a three-minute form look like
-- a compliance document. Again, only the exact strings we shipped.
UPDATE risk_profile_templates
   SET name = 'Your risk profile'
 WHERE name = 'Risk profile (SEBI default)';

UPDATE risk_profile_templates
   SET description = 'A few questions about your plans and how you feel about risk, so we only suggest investments that suit you. It takes about three minutes.'
 WHERE description = '8-question SEBI-style questionnaire. Score range 8–40, mapped to Conservative / Moderate / Aggressive.';
