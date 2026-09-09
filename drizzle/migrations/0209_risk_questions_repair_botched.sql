-- Repair four questions left in broken English by an earlier find-and-replace.
--
-- Two firms published a template in June whose questions had been through a
-- naive word swap of "client" → "you" / "client's" → "your". That produces
-- text no proofreader would pass, and it was going out to investors:
--
--     "What is the your age?"
--     "How stable is the your income?"
--     "How much experience does the you have with mutual funds?"
--     "If the portfolio dropped 20 % in 6 months, what would you do?"
--
-- Migration 0208 rewrote the questions still carrying the pristine default
-- wording, but deliberately matched exact strings — so these mangled variants
-- did not match and were left as they were. Hence this follow-up, which maps
-- the four damaged strings to the same wording 0208 produced. Every published
-- template then reads identically, whichever route it took to get here.
--
-- Same discipline as 0208: exact whole-string matches only, keys / option
-- values / scores untouched, so no stored response changes meaning.

DO $$
DECLARE
  m jsonb := jsonb_build_object(
    'What is the your age?',                                                'What is your age?',
    'How stable is the your income?',                                       'How steady is your income?',
    'How much experience does the you have with mutual funds?',             'How much experience do you have with mutual funds?',
    'If the portfolio dropped 20 % in 6 months, what would you do?',        'If your investment fell 20% in six months, what would you do?',
    -- The same swap could have hit these two; harmless when absent.
    'What is the your approximate net worth?',                              'Roughly what are your total savings and investments worth?',
    'How long does the you plan to stay invested?',                         'How long do you plan to stay invested?'
  );
  r    RECORD;
  newq jsonb;
  n    int := 0;
BEGIN
  FOR r IN SELECT id, questions FROM risk_profile_templates WHERE jsonb_typeof(questions) = 'array' LOOP
    SELECT jsonb_agg(
             q
             || CASE WHEN m ? (q ->> 'label')
                     THEN jsonb_build_object('label', m ->> (q ->> 'label')) ELSE '{}'::jsonb END
             || CASE WHEN (q ? 'helperText') AND m ? (q ->> 'helperText')
                     THEN jsonb_build_object('helperText', m ->> (q ->> 'helperText')) ELSE '{}'::jsonb END
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
      UPDATE risk_profile_templates SET questions = newq, updated_at = now() WHERE id = r.id;
      n := n + 1;
    END IF;
  END LOOP;
  RAISE NOTICE '[0209] repaired questions on % template row(s)', n;
END $$;
