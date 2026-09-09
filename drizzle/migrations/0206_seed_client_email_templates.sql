-- 0206_seed_client_email_templates.sql
--
-- Puts the three client-facing emails into EVERY firm's Templates list:
--   risk_profile_result  — the client's risk score + a link to redo it
--   feedback_nps         — the 0-10 feedback form
--   suitability_review   — holdings sitting outside the client's risk band
--
-- They already shipped as designer STARTERS, but a starter is only a gallery
-- entry you pick when creating a template — it is not a row, so Templates read
-- "No templates yet" and nothing could actually be sent. This seeds the rows.
--
-- Bodies are generated from src/lib/email-designer/starters.ts (see
-- scratch/gen-provision-migration.mts) so the SQL cannot drift from the TS.
--
-- Idempotent per (tenant, key): a firm that already has the key is skipped, so
-- re-running never duplicates and never overwrites a firm's own edits. New
-- tenants get these from the signup seed, not from here.
--
-- Seeded as status='approved' / approval_status='approved_internal': these are
-- vendor-provided and compliance-reviewed, and the 11-rule compliance gate
-- still runs on every individual send.

DO $$
DECLARE
  t record;
  tpl_id uuid;
  ver_id uuid;
  seeded int := 0;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP

    -- risk_profile_result — Risk Profile — Your Result
    IF NOT EXISTS (
      SELECT 1 FROM templates
      WHERE tenant_id = t.id AND key = 'risk_profile_result' AND channel = 'email' AND locale = 'en-IN'
    ) THEN
      tpl_id := gen_random_uuid();
      ver_id := gen_random_uuid();

      INSERT INTO templates (id, tenant_id, key, channel, name, description, category, locale, status, current_version_id)
      VALUES (tpl_id, t.id, 'risk_profile_result', 'email', 'Risk Profile — Your Result', 'Sent after the questionnaire is completed: the client''s score, what the category means, and a link to redo it if anything has changed.', 'utility', 'en-IN', 'approved', ver_id);

      INSERT INTO template_versions (id, template_id, tenant_id, version_number, body, variables, attachments, approval_status, approved_at)
      VALUES (ver_id, tpl_id, t.id, 1, '{"subject":"Your risk profile result: {{risk.category}}","preheader":"Your score, what it means, and how to change it if it no longer fits.","mode":"designer","blocks":[{"id":"s56","type":"logo"},{"id":"s57","type":"heading","text":"Your risk profile is complete","level":"h2","align":"left"},{"id":"s58","type":"text","html":"Dear {{investor.name}},<br><br>Thank you for completing your risk profiling questionnaire. Based on your answers, your risk category is <b>{{risk.category}}</b>.","align":"left"},{"id":"s59","type":"data_table","caption":"Your result","rows":[{"label":"Risk category","value":"{{risk.category}}"},{"label":"Your score","value":"{{risk.score_display}}"},{"label":"Profiled on","value":"{{risk.profiled_on}}"},{"label":"Next review due","value":"{{risk.review_due}}"}]},{"id":"s60","type":"heading","text":"What this means for you","level":"h3","align":"left"},{"id":"s61","type":"text","html":"{{risk.meaning}}<br><br>Your risk category is how we judge whether a scheme is suitable for you before we recommend it. It reflects the time you plan to stay invested, how much of your money is at stake, and how you told us you would react if markets fell sharply. A higher score means you are comfortable with larger ups and downs in exchange for higher potential long-term growth; a lower score means we prioritise protecting your capital over chasing returns.","align":"left"},{"id":"s62","type":"heading","text":"If this no longer fits you","level":"h3","align":"left"},{"id":"s63","type":"text","html":"Your answers were a snapshot of the day you filled the form. A new job, a home loan, a change in family responsibilities or simply a change of mind can all move your risk appetite. If any answer no longer reflects your situation, you can redo the questionnaire yourself using the button below — it takes about three minutes, and your profile updates as soon as you submit it.","align":"left"},{"id":"s64","type":"button","label":"Review or change my answers","url":"{{link.risk_profile}}","align":"center","style":"solid","fullWidth":false},{"id":"s65","type":"text","html":"<span style=\"font-size:13px;color:#6b7280\">The link above is personal to you. Prefer to talk it through? Just reply to this email and {{investor.rm_name}} will call you.</span>","align":"left"},{"id":"s66","type":"signature","closing":"Warm regards,","showSignatureImage":true,"signatureHeight":56,"showDesignation":true,"showContact":true,"showFirm":true,"align":"left"},{"id":"s67","type":"text","html":"Mutual fund investments are subject to market risks. Read all scheme related documents carefully. Past performance is not indicative of future returns.","align":"left"}],"footer":{"includeArn":true,"includeAddress":true,"includeUnsubscribe":true}}'::jsonb, '[]'::jsonb, '[]'::jsonb, 'approved_internal', now());

      seeded := seeded + 1;
    END IF;

    -- feedback_nps — Feedback / NPS Survey
    IF NOT EXISTS (
      SELECT 1 FROM templates
      WHERE tenant_id = t.id AND key = 'feedback_nps' AND channel = 'email' AND locale = 'en-IN'
    ) THEN
      tpl_id := gen_random_uuid();
      ver_id := gen_random_uuid();

      INSERT INTO templates (id, tenant_id, key, channel, name, description, category, locale, status, current_version_id)
      VALUES (tpl_id, t.id, 'feedback_nps', 'email', 'Feedback / NPS Survey', 'Asks the client to rate the firm 0-10 with an optional comment. The response is filed in the CRM as a feedback ticket.', 'utility', 'en-IN', 'approved', ver_id);

      INSERT INTO template_versions (id, template_id, tenant_id, version_number, body, variables, attachments, approval_status, approved_at)
      VALUES (ver_id, tpl_id, t.id, 1, '{"subject":"{{investor.first_name}}, how are we doing?","preheader":"One question, about a minute — it genuinely shapes how we work.","mode":"designer","blocks":[{"id":"s300","type":"logo"},{"id":"s301","type":"heading","text":"How are we doing?","level":"h2","align":"left"},{"id":"s302","type":"text","html":"Dear {{investor.name}},<br><br>We would like to hear from you. On a scale of 0 to 10, how likely are you to recommend {{tenant.displayName}} to a friend or colleague?","align":"left"},{"id":"s303","type":"button","label":"Give my feedback","url":"{{link.feedback}}","align":"center","style":"solid","fullWidth":false},{"id":"s304","type":"text","html":"It is one question and an optional comment box, so it should take about a minute. You do not need to log in anywhere.","align":"left"},{"id":"s305","type":"text","html":"We read every response. If something has not gone the way you expected, please say so plainly — that is the feedback we most need, and {{investor.rm_name}} will follow up personally.","align":"left"},{"id":"s306","type":"text","html":"Thank you for your time.","align":"left"},{"id":"s307","type":"signature","closing":"Warm regards,","showSignatureImage":true,"signatureHeight":56,"showDesignation":true,"showContact":true,"showFirm":true,"align":"left"},{"id":"s308","type":"text","html":"Mutual fund investments are subject to market risks. Read all scheme related documents carefully. Past performance is not indicative of future returns.","align":"left"}],"footer":{"includeArn":true,"includeAddress":true,"includeUnsubscribe":true}}'::jsonb, '[]'::jsonb, '[]'::jsonb, 'approved_internal', now());

      seeded := seeded + 1;
    END IF;

    -- suitability_review — Portfolio vs Risk Profile — Suitability Note
    IF NOT EXISTS (
      SELECT 1 FROM templates
      WHERE tenant_id = t.id AND key = 'suitability_review' AND channel = 'email' AND locale = 'en-IN'
    ) THEN
      tpl_id := gen_random_uuid();
      ver_id := gen_random_uuid();

      INSERT INTO templates (id, tenant_id, key, channel, name, description, category, locale, status, current_version_id)
      VALUES (tpl_id, t.id, 'suitability_review', 'email', 'Portfolio vs Risk Profile — Suitability Note', 'For clients holding schemes that sit outside their risk profile''s comfort band. Explains why it was recommended, and invites them to raise any concern.', 'utility', 'en-IN', 'approved', ver_id);

      INSERT INTO template_versions (id, template_id, tenant_id, version_number, body, variables, attachments, approval_status, approved_at)
      VALUES (ver_id, tpl_id, t.id, 1, '{"subject":"A quick note on your portfolio and your risk profile","preheader":"Why you hold what you hold — and how to tell us if it no longer suits you.","mode":"designer","blocks":[{"id":"s309","type":"logo"},{"id":"s310","type":"heading","text":"Your portfolio and your risk profile","level":"h2","align":"left"},{"id":"s311","type":"text","html":"Dear {{investor.name}},<br><br>As part of our regular review we compare what you hold against the risk profile you signed with us. Your profile is <b>{{risk.category}}</b>, and some of your current holdings sit outside the range that profile normally implies. We would rather tell you plainly than leave it unsaid.","align":"left"},{"id":"s312","type":"data_table","caption":"What we compared","rows":[{"label":"Your risk category","value":"{{risk.category}}"},{"label":"Equity exposure today","value":"{{suitability.equity_pct}}%"},{"label":"Usual range for this profile","value":"{{suitability.band}}"},{"label":"Profiled on","value":"{{risk.profiled_on}}"}]},{"id":"s313","type":"heading","text":"The schemes this relates to","level":"h3","align":"left"},{"id":"s314","type":"text","html":"<b>{{suitability.scheme_list}}</b>","align":"left"},{"id":"s315","type":"heading","text":"Why these were recommended","level":"h3","align":"left"},{"id":"s316","type":"text","html":"These schemes were suggested for your convenience and to suit the requirement you described at the time — typically a specific goal, a time horizon longer than the rest of your portfolio, or a tax consideration. A holding sitting outside the usual band is not automatically wrong, and this note is not a recommendation to sell. Markets move too: a strong run in equity can lift your exposure above the band without you having bought anything.","align":"left"},{"id":"s317","type":"heading","text":"If you have any concern","level":"h3","align":"left"},{"id":"s318","type":"text","html":"If you are not comfortable with this, please do reach out to us — reply to this email or call {{investor.rm_name}}, and we will walk through the options with you. Those usually include rebalancing towards your band, leaving the holding in place with your explicit consent, or updating your risk profile if your appetite has genuinely changed.","align":"left"},{"id":"s319","type":"button","label":"Update my risk profile","url":"{{link.risk_profile}}","align":"center","style":"outline","fullWidth":false},{"id":"s320","type":"signature","closing":"Warm regards,","showSignatureImage":true,"signatureHeight":56,"showDesignation":true,"showContact":true,"showFirm":true,"align":"left"},{"id":"s321","type":"text","html":"Mutual fund investments are subject to market risks. Read all scheme related documents carefully. Past performance is not indicative of future returns.","align":"left"}],"footer":{"includeArn":true,"includeAddress":true,"includeUnsubscribe":true}}'::jsonb, '[]'::jsonb, '[]'::jsonb, 'approved_internal', now());

      seeded := seeded + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'seeded % client email template(s)', seeded;
END $$;
