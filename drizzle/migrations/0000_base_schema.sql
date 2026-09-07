-- 0000_base_schema.sql
-- migrate:skip-if-table-exists tenants
--
-- The base schema, reconstructed from meta/0000_snapshot.json (tag
-- 0000_workflow_rules). The original 0000 SQL was never committed: the first
-- databases were created with `drizzle-kit push`, and every later migration
-- assumes these 59 tables already exist — so a FRESH database
-- died on 0001_sleepy_joseph.sql ("relation events_outbox does not exist") and
-- CI's "Migrate · RLS coverage" job could never build one from scratch.
--
-- Every statement is guarded (IF NOT EXISTS / duplicate_object), and the
-- pragma on line 2 makes scripts/migrate-all.ts record this file as applied
-- WITHOUT executing it when public.tenants already exists. So on production and on every existing
-- dev database this file is a no-op; only an empty database runs it.
--
-- Do not edit: later migrations alter these tables from exactly this shape.

CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"actor_type" text DEFAULT 'user' NOT NULL,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"meta" jsonb,
	"pii_accessed" jsonb,
	"reason" text,
	"ip_address" text,
	"user_agent" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"address" jsonb,
	"phone" text,
	"email" text,
	"head_user_id" text,
	"is_hq" text DEFAULT 'false',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"kind" text,
	"theme" text,
	"channel" text NOT NULL,
	"template_id" uuid,
	"template_version_id" uuid,
	"segment_id" uuid,
	"target_audience" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"content_status" text DEFAULT 'not_started',
	"compliance_check_status" text DEFAULT 'pending',
	"approval_status" text DEFAULT 'pending',
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"leads_generated" integer DEFAULT 0,
	"meetings_booked" integer DEFAULT 0,
	"clients_converted" integer DEFAULT 0,
	"campaign_cost" numeric(14, 2),
	"remarks" text,
	"throttle_per_minute" integer DEFAULT 60,
	"total_recipients" integer DEFAULT 0,
	"queued_count" integer DEFAULT 0,
	"sent_count" integer DEFAULT 0,
	"delivered_count" integer DEFAULT 0,
	"read_count" integer DEFAULT 0,
	"replied_count" integer DEFAULT 0,
	"clicked_count" integer DEFAULT 0,
	"failed_count" integer DEFAULT 0,
	"bounced_count" integer DEFAULT 0,
	"unsubscribed_count" integer DEFAULT 0,
	"variable_overrides" jsonb,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "amc_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"period" text NOT NULL,
	"amc_code" text NOT NULL,
	"scheme_code" text,
	"scheme_name" text,
	"folio_number" text,
	"pan" text,
	"payout_type" text DEFAULT 'trail' NOT NULL,
	"gross_amount" numeric(18, 2) NOT NULL,
	"tds_amount" numeric(18, 2) DEFAULT '0',
	"net_amount" numeric(18, 2) NOT NULL,
	"statement_date" date,
	"source_feed" text NOT NULL,
	"raw_row" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "commission_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"period" text NOT NULL,
	"amc_code" text NOT NULL,
	"scheme_code" text NOT NULL,
	"scheme_name" text,
	"trail_rate_pct" numeric(6, 4),
	"expected_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"received_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"variance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"variance_pct" numeric(7, 4) DEFAULT '0',
	"status" text DEFAULT 'pending' NOT NULL,
	"folio_count" text DEFAULT '0',
	"notes" text,
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "communications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"investor_id" uuid,
	"lead_id" uuid,
	"user_id" uuid,
	"channel" text NOT NULL,
	"direction" text NOT NULL,
	"template_version_id" uuid,
	"template_key" text,
	"external_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"status_reason" text,
	"payload" jsonb,
	"inbound_content" jsonb,
	"workflow_run_id" uuid,
	"workflow_run_step_id" uuid,
	"campaign_id" uuid,
	"consent_snapshot" jsonb,
	"compliance_snapshot" jsonb,
	"compliance_score" numeric(5, 2),
	"cost_paise" text,
	"queued_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"replied_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whatsapp_numbers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"phone_e164" text NOT NULL,
	"display_name" text,
	"is_default" text DEFAULT 'false',
	"aisensy_app_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compliance_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"storage_key" text NOT NULL,
	"mime_type" text,
	"size_bytes" text,
	"issued_on" date,
	"expires_on" date,
	"related_entity_type" text,
	"related_entity_id" uuid,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"uploaded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ddq_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"overall_score" numeric(5, 2),
	"breakdown" jsonb,
	"findings" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sop_acknowledgements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sop_version_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"evidence" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sop_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sop_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version_number" text NOT NULL,
	"body" jsonb NOT NULL,
	"effective_from" date,
	"published_at" timestamp with time zone,
	"published_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"category" text,
	"current_version_id" uuid,
	"required_roles" text[] DEFAULT '{}',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"investor_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"scope" text NOT NULL,
	"status" text NOT NULL,
	"granted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"source" text,
	"evidence_ref" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "content_library_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"type" text NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"file_url" text NOT NULL,
	"file_name" text,
	"file_size_bytes" text,
	"mime_type" text,
	"thumbnail_url" text,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"branding_config" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"publish_at" timestamp with time zone,
	"expire_at" timestamp with time zone,
	"uploaded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "content_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid,
	"content_date" date NOT NULL,
	"platform" text NOT NULL,
	"content_type" text DEFAULT 'image_post' NOT NULL,
	"topic" text NOT NULL,
	"caption" text,
	"creative_files" jsonb DEFAULT '[]'::jsonb,
	"compliance_checked" boolean DEFAULT false NOT NULL,
	"compliance_checked_at" timestamp with time zone,
	"compliance_checked_by_user_id" uuid,
	"compliance_notes" text,
	"approval_status" text DEFAULT 'pending' NOT NULL,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"rejection_reason" text,
	"posted_status" text DEFAULT 'not_posted' NOT NULL,
	"posted_at" timestamp with time zone,
	"post_link" text,
	"campaign_id" uuid,
	"remarks" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "families" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid,
	"head_name" text NOT NULL,
	"family_name" text,
	"primary_investor_id" uuid,
	"rm_id" uuid,
	"last_review_at" timestamp with time zone,
	"next_review_at" timestamp with time zone,
	"notes" text,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "folios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"investor_id" uuid NOT NULL,
	"folio_number" text NOT NULL,
	"amc_code" text NOT NULL,
	"amc_name" text NOT NULL,
	"rta" text,
	"opened_at" date,
	"closed_at" date,
	"aum" numeric(18, 2) DEFAULT '0',
	"schemes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"investor_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"target_amount" numeric(18, 2) NOT NULL,
	"target_date" date NOT NULL,
	"started_on" date,
	"monthly_contribution" numeric(18, 2),
	"expected_return" numeric(5, 2),
	"current_value" numeric(18, 2) DEFAULT '0',
	"progress_pct" numeric(5, 2) DEFAULT '0',
	"linked_folios" jsonb DEFAULT '[]'::jsonb,
	"linked_sips" jsonb DEFAULT '[]'::jsonb,
	"folio_allocations" jsonb DEFAULT '[]'::jsonb,
	"sip_allocations" jsonb DEFAULT '[]'::jsonb,
	"required_monthly_sip" numeric(18, 2),
	"existing_monthly_sip" numeric(18, 2),
	"gap_amount" numeric(18, 2),
	"next_review_at" timestamp with time zone,
	"remarks" text,
	"status" text DEFAULT 'not_started' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legal_name" text NOT NULL,
	"display_name" text NOT NULL,
	"arn" text NOT NULL,
	"arn_expiry_at" date,
	"principal_euin" text,
	"gst_number" text,
	"pan_number" text,
	"address" jsonb,
	"phone" text,
	"email" text,
	"website" text,
	"primary_color" text DEFAULT '#1f2937',
	"secondary_color" text DEFAULT '#0ea5e9',
	"logo_url" text,
	"favicon_url" text,
	"plan" text DEFAULT 'starter' NOT NULL,
	"plan_seats" jsonb DEFAULT '{"included":1,"addOn":0}'::jsonb,
	"status" text DEFAULT 'trial' NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"aum_range" text,
	"sip_book_range" text,
	"team_size" text,
	"current_software_used" text,
	"onboarding_notes" text,
	"public_website_slug" text,
	"is_white_label" boolean DEFAULT false,
	"dpo" jsonb,
	"ria_registered" boolean DEFAULT false,
	"feature_flags" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"password_hash" text,
	"avatar_url" text,
	"roles" text[] DEFAULT '{"rm"}' NOT NULL,
	"euin" text,
	"nism_cert_no" text,
	"nism_expiry_at" date,
	"nism_category" text,
	"territory" jsonb,
	"two_fa_enabled" boolean DEFAULT false,
	"two_fa_secret" text,
	"last_login_at" timestamp with time zone,
	"status" text DEFAULT 'invited' NOT NULL,
	"invited_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"offboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "investors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid,
	"family_id" uuid,
	"family_role" text,
	"pan" text NOT NULL,
	"name" text NOT NULL,
	"dob" date,
	"gender" text,
	"email" text,
	"phone" text,
	"alternate_phone" text,
	"whatsapp_phone" text,
	"occupation" text,
	"income_range" text,
	"employer_name" text,
	"address" jsonb,
	"investor_category" text DEFAULT 'individual' NOT NULL,
	"segment_tag" text,
	"bse_ucc_code" text,
	"nse_can_code" text,
	"mandate_status" text DEFAULT 'none',
	"mandate_ref_no" text,
	"service_tier" text,
	"service_tier_locked_at" timestamp with time zone,
	"service_tier_manual_override" boolean DEFAULT false,
	"client_types" jsonb DEFAULT '[]'::jsonb,
	"kyc_status" text DEFAULT 'pending' NOT NULL,
	"ckyc_number" text,
	"ckyc_expiry_at" date,
	"kra_name" text,
	"fatca_status" text,
	"fatca_expiry_at" date,
	"nominee_name" text,
	"nominee_relation" text,
	"nominee_dob" date,
	"bank_name" text,
	"bank_account_masked" text,
	"bank_ifsc" text,
	"risk_profile_score" integer,
	"risk_profile" text,
	"risk_profile_signed_at" timestamp with time zone,
	"risk_profile_version" integer,
	"aum" numeric(18, 2) DEFAULT '0',
	"active_sip_amount" numeric(18, 2) DEFAULT '0',
	"lifetime_inflow" numeric(18, 2) DEFAULT '0',
	"lifetime_outflow" numeric(18, 2) DEFAULT '0',
	"rm_id" uuid,
	"onboarded_at" timestamp with time zone,
	"last_transaction_at" timestamp with time zone,
	"last_contact_at" timestamp with time zone,
	"last_review_at" timestamp with time zone,
	"next_review_at" timestamp with time zone,
	"is_minor" boolean DEFAULT false,
	"guardian_investor_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"dormant_since" timestamp with time zone,
	"exited_at" timestamp with time zone,
	"redemption_risk_flagged_at" timestamp with time zone,
	"redemption_risk_reason" text,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mandates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"investor_id" uuid NOT NULL,
	"mandate_ref_no" text NOT NULL,
	"bank_account_masked" text,
	"ifsc" text,
	"amount_limit" numeric(18, 2),
	"registered_at" date,
	"expires_at" date,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"investor_id" uuid NOT NULL,
	"folio_id" uuid,
	"folio_number" text,
	"amc_code" text,
	"amc_name" text,
	"scheme_code" text,
	"scheme_name" text,
	"amount" numeric(18, 2) NOT NULL,
	"frequency" text DEFAULT 'monthly' NOT NULL,
	"sip_date" text,
	"start_date" date,
	"end_date" date,
	"next_installment_at" date,
	"mandate_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"consecutive_failures" text DEFAULT '0',
	"rm_id" uuid,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"investor_id" uuid NOT NULL,
	"folio_id" uuid,
	"folio_number" text,
	"amc_code" text,
	"amc_name" text,
	"scheme_code" text,
	"scheme_name" text,
	"scheme_category" text,
	"type" text NOT NULL,
	"direction" text NOT NULL,
	"amount" numeric(18, 2),
	"units" numeric(18, 4),
	"nav" numeric(12, 4),
	"order_id" text,
	"order_date" date,
	"settlement_date" date,
	"exchange" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason_code" text,
	"reason_description" text,
	"executed_by" uuid,
	"executed_euin" text,
	"source_feed" text,
	"raw_feed_row" jsonb,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"city" text,
	"pincode" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_campaign" text,
	"utm_params" jsonb,
	"stage" text DEFAULT 'new' NOT NULL,
	"stage_changed_at" timestamp with time zone,
	"score" text DEFAULT '0',
	"interest_products" jsonb DEFAULT '[]'::jsonb,
	"intended_amount" text,
	"referred_by_investor_id" uuid,
	"referred_by_name" text,
	"owner_id" uuid,
	"last_contact_at" timestamp with time zone,
	"last_follow_up_at" timestamp with time zone,
	"next_follow_up_at" timestamp with time zone,
	"converted_investor_id" uuid,
	"converted_at" timestamp with time zone,
	"lost_reason" text,
	"lost_at" timestamp with time zone,
	"follow_up_notes" text,
	"notes" text,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid,
	"related_investor_id" uuid,
	"related_lead_id" uuid,
	"related_service_request_id" uuid,
	"related_meeting_id" uuid,
	"department" text,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"remarks" text,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"assignee_id" uuid,
	"created_by_id" uuid,
	"due_at" timestamp with time zone,
	"sla_due_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"workflow_run_id" uuid,
	"workflow_step_id" text,
	"meta" jsonb,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"graph" jsonb NOT NULL,
	"default_templates" jsonb,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipes_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_run_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"node_type" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status" text NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"latency_ms" integer,
	"side_effects" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"triggered_by" text NOT NULL,
	"trigger_id" uuid,
	"subject_type" text,
	"subject_id" uuid,
	"variables" jsonb DEFAULT '{}'::jsonb,
	"context_snapshot" jsonb,
	"status" text DEFAULT 'queued' NOT NULL,
	"paused_until" timestamp with time zone,
	"wait_predicate" jsonb,
	"wait_node_id" text,
	"current_node_id" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error" text,
	"triggered_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_triggers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"config" jsonb NOT NULL,
	"criteria" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"cron_expression" text,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"graph" jsonb NOT NULL,
	"variables_schema" jsonb,
	"validation_report" jsonb,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'custom' NOT NULL,
	"recipe_key" text,
	"current_version_id" uuid,
	"enabled" boolean DEFAULT true NOT NULL,
	"recurrence_policy" text DEFAULT 'unlimited' NOT NULL,
	"max_runs_per_hour" integer DEFAULT 10000,
	"paused_reason" text,
	"paused_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "segment_memberships" (
	"segment_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "segment_memberships_segment_id_subject_id_pk" PRIMARY KEY("segment_id","subject_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"kind" text NOT NULL,
	"subject_type" text NOT NULL,
	"ast" jsonb,
	"refresh_cron" text DEFAULT '0 * * * *',
	"member_count" integer DEFAULT 0,
	"last_materialized_at" timestamp with time zone,
	"last_materialization_ms" integer,
	"materializer_enabled" boolean DEFAULT true,
	"view_config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "template_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_version_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"step" text NOT NULL,
	"decision" text DEFAULT 'pending' NOT NULL,
	"notes" text,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"body" jsonb NOT NULL,
	"variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"compliance_checks" jsonb,
	"compliance_score" numeric(5, 2),
	"auto_compliance_blocked" boolean DEFAULT false,
	"approval_status" text DEFAULT 'draft' NOT NULL,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"rejection_reason" text,
	"external_ref" text,
	"external_status" text,
	"external_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"channel" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'transactional' NOT NULL,
	"locale" text DEFAULT 'en-IN' NOT NULL,
	"current_version_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whatsapp_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"template_id" uuid,
	"aisensy_name" text NOT NULL,
	"aisensy_language" text DEFAULT 'en' NOT NULL,
	"category" text NOT NULL,
	"meta_status" text NOT NULL,
	"meta_rejection_reason" text,
	"components" jsonb NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "events_outbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"meta" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ticket_no" text NOT NULL,
	"investor_id" uuid,
	"type" text NOT NULL,
	"channel" text,
	"subject" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"assigned_to_user_id" uuid,
	"sla_response_at" timestamp with time zone,
	"sla_resolution_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"sebi_category" text,
	"sebi_sub_category" text,
	"attachments" jsonb,
	"timeline" jsonb,
	"remarks" text,
	"resolution_notes" text,
	"escalated_at" timestamp with time zone,
	"escalated_to_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "amc_master" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"rta" text,
	"is_empaneled" boolean DEFAULT false,
	"empanelment_number" text,
	"empanelment_date" text,
	"contact_email" text,
	"contact_phone" text,
	"relationship_manager" text,
	"logo_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "master_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"master_type" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_system_default" boolean DEFAULT false,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scheme_master" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"amc_code" text NOT NULL,
	"scheme_code" text NOT NULL,
	"scheme_name" text NOT NULL,
	"category" text,
	"sub_category" text,
	"plan" text,
	"option" text,
	"min_investment" text,
	"min_sip" text,
	"exit_load" text,
	"risk_category" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_closed" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"monthly_price_paise" integer DEFAULT 0 NOT NULL,
	"yearly_price_paise" integer DEFAULT 0 NOT NULL,
	"setup_cost_paise" integer DEFAULT 0 NOT NULL,
	"max_users" integer DEFAULT 1 NOT NULL,
	"max_investors" integer DEFAULT 100 NOT NULL,
	"storage_limit_gb" integer DEFAULT 5 NOT NULL,
	"trial_days" integer DEFAULT 14 NOT NULL,
	"enabled_modules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"feature_flags" jsonb DEFAULT '{}'::jsonb,
	"sort_order" integer DEFAULT 0,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"badge" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscription_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"actor" text,
	"from_status" text,
	"to_status" text,
	"from_package" text,
	"to_package" text,
	"amount_paise" integer,
	"notes" text,
	"meta" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"package_key" text NOT NULL,
	"status" text DEFAULT 'trial' NOT NULL,
	"billing_cycle" text DEFAULT 'yearly',
	"license_start_at" timestamp with time zone DEFAULT now(),
	"license_end_at" timestamp with time zone,
	"trial_ends_at" timestamp with time zone,
	"next_renewal_at" timestamp with time zone,
	"seats_override" integer,
	"storage_override_gb" integer,
	"razorpay_customer_id" text,
	"razorpay_subscription_id" text,
	"last_payment_at" timestamp with time zone,
	"last_payment_paise" integer,
	"suspended_at" timestamp with time zone,
	"suspended_reason" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"raised_by_user_id" uuid,
	"subject" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'other' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"assigned_to_platform_admin" uuid,
	"resolution" text,
	"resolved_at" timestamp with time zone,
	"attachments" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"roles_to_grant" text[] NOT NULL,
	"branch_id" uuid,
	"invited_by_user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "password_resets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"request_ip" text,
	"request_user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link_url" text,
	"severity" text DEFAULT 'info' NOT NULL,
	"read_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "onboarding_pipelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"investor_id" uuid NOT NULL,
	"branch_id" uuid,
	"assigned_rm_id" uuid,
	"current_stage" text DEFAULT 'first_meeting' NOT NULL,
	"stages" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pending_documents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expected_completion_at" date,
	"actual_completion_at" date,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"on_hold_reason" text,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "risk_profile_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"investor_id" uuid NOT NULL,
	"profile_date" date DEFAULT now() NOT NULL,
	"age" integer,
	"investment_horizon" text,
	"income_stability" text,
	"risk_capacity" text,
	"risk_tolerance" text,
	"investment_objective" text,
	"mf_experience" text,
	"net_worth_band" text,
	"final_category" text NOT NULL,
	"total_score" integer NOT NULL,
	"responses" jsonb,
	"document_url" text,
	"signed_at" timestamp with time zone,
	"signed_by_name" text,
	"next_review_at" date,
	"rm_remarks" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sip_rejections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"investor_id" uuid NOT NULL,
	"transaction_id" uuid,
	"sip_id" uuid,
	"rejection_date" date NOT NULL,
	"rejection_amount" numeric(18, 2) NOT NULL,
	"rejection_reason" text,
	"scheme_name" text,
	"folio_number" text,
	"amc_name" text,
	"assigned_rm_id" uuid,
	"follow_up_date" date,
	"recovery_date" date,
	"recovery_status" text DEFAULT 'pending' NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "review_meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"investor_id" uuid NOT NULL,
	"family_id" uuid,
	"rm_id" uuid,
	"category" text DEFAULT 'review' NOT NULL,
	"parent_meeting_id" uuid,
	"meeting_type" text NOT NULL,
	"meeting_date" timestamp with time zone NOT NULL,
	"duration_minutes" text DEFAULT '30',
	"meeting_mode" text NOT NULL,
	"location_or_link" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"discussion_points" text,
	"meeting_notes" text,
	"action_items" jsonb DEFAULT '[]'::jsonb,
	"attachments" jsonb DEFAULT '[]'::jsonb,
	"next_review_date" date,
	"actual_end_at" timestamp with time zone,
	"follow_up_task_created" text DEFAULT 'false',
	"reminder_task_id" uuid,
	"notes_reminder_task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid,
	"proposal_number" text NOT NULL,
	"recipient_type" text NOT NULL,
	"investor_id" uuid,
	"lead_id" uuid,
	"family_id" uuid,
	"recipient_name" text NOT NULL,
	"recipient_email" text,
	"recipient_phone" text,
	"type" text DEFAULT 'mutual_fund' NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"cover_letter" text,
	"disclaimer" text,
	"products" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total_investment" numeric(16, 2),
	"expected_corpus" numeric(16, 2),
	"risk_rating" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"valid_until" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"viewed_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"rejection_reason" text,
	"prepared_by_user_id" uuid,
	"prepared_at" timestamp with time zone DEFAULT now(),
	"attachments" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "insurance_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid,
	"investor_id" uuid NOT NULL,
	"source_proposal_id" uuid,
	"policy_number" text,
	"insurer" text NOT NULL,
	"plan_name" text NOT NULL,
	"policy_type" text NOT NULL,
	"lives_covered" integer DEFAULT 1,
	"sum_assured" numeric(16, 2),
	"annual_premium" numeric(14, 2),
	"premium_frequency" text DEFAULT 'annual' NOT NULL,
	"premium_paying_term_years" integer,
	"policy_term_years" integer,
	"policy_start_date" date,
	"risk_cover_start_date" date,
	"maturity_date" date,
	"last_premium_date" date,
	"next_premium_due_date" date,
	"grace_period_days" integer DEFAULT 30,
	"nominee_name" text,
	"nominee_relation" text,
	"nominee_dob" date,
	"nominee_share" integer DEFAULT 100,
	"riders" jsonb DEFAULT '[]'::jsonb,
	"documents" jsonb DEFAULT '[]'::jsonb,
	"remarks" text,
	"lapse_reason" text,
	"surrender_value" numeric(14, 2),
	"commission_paisa" numeric(14, 2),
	"status" text DEFAULT 'active' NOT NULL,
	"sold_by_user_id" uuid,
	"sold_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_rule_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"triggered_by" text NOT NULL,
	"trigger_event_id" text,
	"subject_type" text,
	"subject_id" uuid,
	"context_snapshot" jsonb,
	"instant_outcomes" jsonb DEFAULT '[]'::jsonb,
	"scheduled_queued" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'succeeded' NOT NULL,
	"error" text,
	"executed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_rule_scheduled_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"execution_id" uuid,
	"action_index" integer NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"action_type" text NOT NULL,
	"action_config" jsonb NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"completed_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"module" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"trigger_type" text NOT NULL,
	"trigger_config" jsonb NOT NULL,
	"criteria_pattern" text,
	"criteria_rows" jsonb DEFAULT '[]'::jsonb,
	"instant_actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scheduled_actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"lock_reason" text,
	"locked_by" uuid,
	"locked_at" timestamp with time zone,
	"execution_order" integer DEFAULT 100 NOT NULL,
	"execution_count" integer DEFAULT 0 NOT NULL,
	"last_executed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "branches" ADD CONSTRAINT "branches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_template_version_id_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."template_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "amc_payouts" ADD CONSTRAINT "amc_payouts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "commission_records" ADD CONSTRAINT "commission_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "communications" ADD CONSTRAINT "communications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "communications" ADD CONSTRAINT "communications_investor_id_investors_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "communications" ADD CONSTRAINT "communications_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "communications" ADD CONSTRAINT "communications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "communications" ADD CONSTRAINT "communications_template_version_id_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."template_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "communications" ADD CONSTRAINT "communications_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "communications" ADD CONSTRAINT "communications_workflow_run_step_id_workflow_run_steps_id_fk" FOREIGN KEY ("workflow_run_step_id") REFERENCES "public"."workflow_run_steps"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "whatsapp_numbers" ADD CONSTRAINT "whatsapp_numbers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "compliance_documents" ADD CONSTRAINT "compliance_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ddq_scores" ADD CONSTRAINT "ddq_scores_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sop_acknowledgements" ADD CONSTRAINT "sop_acknowledgements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sop_versions" ADD CONSTRAINT "sop_versions_sop_id_sops_id_fk" FOREIGN KEY ("sop_id") REFERENCES "public"."sops"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sop_versions" ADD CONSTRAINT "sop_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sops" ADD CONSTRAINT "sops_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "consents" ADD CONSTRAINT "consents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "consents" ADD CONSTRAINT "consents_investor_id_investors_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "content_posts" ADD CONSTRAINT "content_posts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "content_posts" ADD CONSTRAINT "content_posts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "content_posts" ADD CONSTRAINT "content_posts_compliance_checked_by_user_id_users_id_fk" FOREIGN KEY ("compliance_checked_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "content_posts" ADD CONSTRAINT "content_posts_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "content_posts" ADD CONSTRAINT "content_posts_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "content_posts" ADD CONSTRAINT "content_posts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "families" ADD CONSTRAINT "families_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "families" ADD CONSTRAINT "families_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "folios" ADD CONSTRAINT "folios_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "folios" ADD CONSTRAINT "folios_investor_id_investors_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goals" ADD CONSTRAINT "goals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goals" ADD CONSTRAINT "goals_investor_id_investors_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "investors" ADD CONSTRAINT "investors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "investors" ADD CONSTRAINT "investors_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "investors" ADD CONSTRAINT "investors_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "investors" ADD CONSTRAINT "investors_rm_id_users_id_fk" FOREIGN KEY ("rm_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mandates" ADD CONSTRAINT "mandates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mandates" ADD CONSTRAINT "mandates_investor_id_investors_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sips" ADD CONSTRAINT "sips_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sips" ADD CONSTRAINT "sips_investor_id_investors_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sips" ADD CONSTRAINT "sips_folio_id_folios_id_fk" FOREIGN KEY ("folio_id") REFERENCES "public"."folios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sips" ADD CONSTRAINT "sips_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sips" ADD CONSTRAINT "sips_rm_id_users_id_fk" FOREIGN KEY ("rm_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_investor_id_investors_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_folio_id_folios_id_fk" FOREIGN KEY ("folio_id") REFERENCES "public"."folios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_executed_by_users_id_fk" FOREIGN KEY ("executed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_run_steps" ADD CONSTRAINT "workflow_run_steps_run_id_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_run_steps" ADD CONSTRAINT "workflow_run_steps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_version_id_workflow_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."workflow_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_trigger_id_workflow_triggers_id_fk" FOREIGN KEY ("trigger_id") REFERENCES "public"."workflow_triggers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_triggered_by_user_id_users_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_triggers" ADD CONSTRAINT "workflow_triggers_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_triggers" ADD CONSTRAINT "workflow_triggers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflows" ADD CONSTRAINT "workflows_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflows" ADD CONSTRAINT "workflows_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "segment_memberships" ADD CONSTRAINT "segment_memberships_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "segment_memberships" ADD CONSTRAINT "segment_memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "segments" ADD CONSTRAINT "segments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "template_approvals" ADD CONSTRAINT "template_approvals_template_version_id_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."template_versions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "template_approvals" ADD CONSTRAINT "template_approvals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "template_approvals" ADD CONSTRAINT "template_approvals_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "templates" ADD CONSTRAINT "templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "events_outbox" ADD CONSTRAINT "events_outbox_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_investor_id_investors_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "amc_master" ADD CONSTRAINT "amc_master_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "master_values" ADD CONSTRAINT "master_values_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scheme_master" ADD CONSTRAINT "scheme_master_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_invites" ADD CONSTRAINT "user_invites_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "onboarding_pipelines" ADD CONSTRAINT "onboarding_pipelines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "risk_profile_responses" ADD CONSTRAINT "risk_profile_responses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sip_rejections" ADD CONSTRAINT "sip_rejections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_meetings" ADD CONSTRAINT "review_meetings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposals" ADD CONSTRAINT "proposals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposals" ADD CONSTRAINT "proposals_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposals" ADD CONSTRAINT "proposals_investor_id_investors_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposals" ADD CONSTRAINT "proposals_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposals" ADD CONSTRAINT "proposals_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposals" ADD CONSTRAINT "proposals_prepared_by_user_id_users_id_fk" FOREIGN KEY ("prepared_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_investor_id_investors_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_sold_by_user_id_users_id_fk" FOREIGN KEY ("sold_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_rule_executions" ADD CONSTRAINT "workflow_rule_executions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_rule_executions" ADD CONSTRAINT "workflow_rule_executions_rule_id_workflow_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."workflow_rules"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_rule_scheduled_jobs" ADD CONSTRAINT "workflow_rule_scheduled_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_rule_scheduled_jobs" ADD CONSTRAINT "workflow_rule_scheduled_jobs_rule_id_workflow_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."workflow_rules"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_rule_scheduled_jobs" ADD CONSTRAINT "workflow_rule_scheduled_jobs_execution_id_workflow_rule_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."workflow_rule_executions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_rules" ADD CONSTRAINT "workflow_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_rules" ADD CONSTRAINT "workflow_rules_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_rules" ADD CONSTRAINT "workflow_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_entity_idx" ON "audit_log" USING btree ("tenant_id","entity_type","entity_id","at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_actor_idx" ON "audit_log" USING btree ("tenant_id","actor_user_id","at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_action_idx" ON "audit_log" USING btree ("tenant_id","action","at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "branches_tenant_code_unique" ON "branches" USING btree ("tenant_id","code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaigns_status_idx" ON "campaigns" USING btree ("tenant_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaigns_kind_idx" ON "campaigns" USING btree ("tenant_id","kind");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "amc_payouts_period_amc_idx" ON "amc_payouts" USING btree ("tenant_id","period","amc_code");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "commission_records_unique" ON "commission_records" USING btree ("tenant_id","period","amc_code","scheme_code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "commission_records_anomaly_idx" ON "commission_records" USING btree ("tenant_id","status","period");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comms_investor_idx" ON "communications" USING btree ("tenant_id","investor_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comms_status_idx" ON "communications" USING btree ("tenant_id","channel","status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "comms_external_unique" ON "communications" USING btree ("external_id","channel") WHERE external_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comms_workflow_run_idx" ON "communications" USING btree ("workflow_run_id") WHERE workflow_run_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comms_timeline_idx" ON "communications" USING btree ("tenant_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wa_numbers_phone_unique" ON "whatsapp_numbers" USING btree ("phone_e164");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "compliance_docs_category_idx" ON "compliance_documents" USING btree ("tenant_id","category");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "compliance_docs_expiry_idx" ON "compliance_documents" USING btree ("tenant_id","expires_on");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ddq_scores_tenant_idx" ON "ddq_scores" USING btree ("tenant_id","computed_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sops_tenant_key_unique" ON "sops" USING btree ("tenant_id","key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "consents_unique" ON "consents" USING btree ("tenant_id","investor_id","channel","scope");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cla_type_idx" ON "content_library_assets" USING btree ("type","is_active");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cla_category_idx" ON "content_library_assets" USING btree ("category","is_active");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cla_active_idx" ON "content_library_assets" USING btree ("is_active","publish_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cp_date_idx" ON "content_posts" USING btree ("tenant_id","content_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cp_platform_idx" ON "content_posts" USING btree ("tenant_id","platform","content_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cp_posting_idx" ON "content_posts" USING btree ("tenant_id","posted_status","content_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cp_approval_idx" ON "content_posts" USING btree ("tenant_id","approval_status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "folios_tenant_amc_folio_unique" ON "folios" USING btree ("tenant_id","amc_code","folio_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "folios_investor_idx" ON "folios" USING btree ("tenant_id","investor_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_arn_unique" ON "tenants" USING btree ("arn");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_tenant_email_unique" ON "users" USING btree ("tenant_id","email");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "investors_tenant_pan_unique" ON "investors" USING btree ("tenant_id","pan");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "investors_rm_idx" ON "investors" USING btree ("tenant_id","rm_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "investors_segment_idx" ON "investors" USING btree ("tenant_id","segment_tag");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "investors_last_review_idx" ON "investors" USING btree ("tenant_id","last_review_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "investors_last_tx_idx" ON "investors" USING btree ("tenant_id","last_transaction_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mandates_tenant_ref_unique" ON "mandates" USING btree ("tenant_id","mandate_ref_no");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mandates_expiry_idx" ON "mandates" USING btree ("tenant_id","expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sips_status_idx" ON "sips" USING btree ("tenant_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sips_investor_idx" ON "sips" USING btree ("tenant_id","investor_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tx_investor_idx" ON "transactions" USING btree ("tenant_id","investor_id","order_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tx_status_idx" ON "transactions" USING btree ("tenant_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tx_type_idx" ON "transactions" USING btree ("tenant_id","type","order_date");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tx_tenant_order_unique" ON "transactions" USING btree ("tenant_id","order_id") WHERE order_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_stage_idx" ON "leads" USING btree ("tenant_id","stage");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_owner_idx" ON "leads" USING btree ("tenant_id","owner_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_next_fu_idx" ON "leads" USING btree ("tenant_id","next_follow_up_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_assignee_status_idx" ON "tasks" USING btree ("tenant_id","assignee_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_due_idx" ON "tasks" USING btree ("tenant_id","due_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_sla_idx" ON "tasks" USING btree ("tenant_id","sla_due_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_subject_idx" ON "tasks" USING btree ("tenant_id","subject_type","subject_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_related_investor_idx" ON "tasks" USING btree ("tenant_id","related_investor_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_related_lead_idx" ON "tasks" USING btree ("tenant_id","related_lead_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_related_sr_idx" ON "tasks" USING btree ("tenant_id","related_service_request_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_related_meeting_idx" ON "tasks" USING btree ("tenant_id","related_meeting_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_department_idx" ON "tasks" USING btree ("tenant_id","department","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wf_steps_run_idx" ON "workflow_run_steps" USING btree ("run_id","node_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wf_steps_failed_idx" ON "workflow_run_steps" USING btree ("status","completed_at") WHERE status = 'failed';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wf_runs_workflow_status_idx" ON "workflow_runs" USING btree ("workflow_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wf_runs_subject_idx" ON "workflow_runs" USING btree ("tenant_id","subject_type","subject_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wf_runs_paused_idx" ON "workflow_runs" USING btree ("paused_until") WHERE status = 'paused';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wf_runs_active_subject_unique" ON "workflow_runs" USING btree ("workflow_id","subject_type","subject_id") WHERE status IN ('queued', 'running', 'paused');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wf_triggers_kind_idx" ON "workflow_triggers" USING btree ("kind","enabled");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wf_triggers_schedule_idx" ON "workflow_triggers" USING btree ("next_run_at") WHERE kind = 'schedule' AND enabled = true;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_versions_unique" ON "workflow_versions" USING btree ("workflow_id","version_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_versions_draft_idx" ON "workflow_versions" USING btree ("workflow_id") WHERE status = 'draft';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workflows_tenant_name_unique" ON "workflows" USING btree ("tenant_id","name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflows_enabled_idx" ON "workflows" USING btree ("tenant_id","enabled");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflows_category_idx" ON "workflows" USING btree ("tenant_id","category");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "seg_members_active_idx" ON "segment_memberships" USING btree ("tenant_id","subject_id") WHERE removed_at IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "segments_tenant_name_unique" ON "segments" USING btree ("tenant_id","name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "segments_refresh_idx" ON "segments" USING btree ("tenant_id","kind");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tpl_versions_unique" ON "template_versions" USING btree ("template_id","version_number");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "templates_tenant_key_channel_locale_unique" ON "templates" USING btree ("tenant_id","key","channel","locale");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "templates_status_idx" ON "templates" USING btree ("tenant_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wa_templates_unique" ON "whatsapp_templates" USING btree ("tenant_id","aisensy_name","aisensy_language");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wa_templates_status_idx" ON "whatsapp_templates" USING btree ("tenant_id","meta_status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbox_unprocessed_idx" ON "events_outbox" USING btree ("id") WHERE processed_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbox_tenant_kind_idx" ON "events_outbox" USING btree ("tenant_id","kind","occurred_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "svc_status_idx" ON "service_requests" USING btree ("tenant_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "svc_sla_idx" ON "service_requests" USING btree ("tenant_id","sla_resolution_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "svc_ticket_idx" ON "service_requests" USING btree ("tenant_id","ticket_no");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "amc_master_tenant_code_unique" ON "amc_master" USING btree ("tenant_id","code");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "master_values_unique" ON "master_values" USING btree ("tenant_id","master_type","key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "master_values_type_idx" ON "master_values" USING btree ("tenant_id","master_type","is_active");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "scheme_master_unique" ON "scheme_master" USING btree ("tenant_id","amc_code","scheme_code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheme_master_category_idx" ON "scheme_master" USING btree ("tenant_id","category","is_active");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "packages_key_unique" ON "packages" USING btree ("key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "packages_active_idx" ON "packages" USING btree ("is_active","sort_order");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sub_events_subscription_idx" ON "subscription_events" USING btree ("subscription_id","at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sub_events_tenant_idx" ON "subscription_events" USING btree ("tenant_id","at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_tenant_unique" ON "subscriptions" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_status_idx" ON "subscriptions" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_renewal_idx" ON "subscriptions" USING btree ("next_renewal_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_tickets_status_idx" ON "support_tickets" USING btree ("status","priority");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_tickets_tenant_idx" ON "support_tickets" USING btree ("tenant_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_invites_email_idx" ON "user_invites" USING btree ("tenant_id","email");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_invites_token_unique" ON "user_invites" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "password_resets_token_idx" ON "password_resets" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "password_resets_email_idx" ON "password_resets" USING btree ("email");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_unread_idx" ON "notifications" USING btree ("user_id","read_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_kind_idx" ON "notifications" USING btree ("tenant_id","kind","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "onboarding_investor_unique" ON "onboarding_pipelines" USING btree ("tenant_id","investor_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onboarding_stage_idx" ON "onboarding_pipelines" USING btree ("tenant_id","current_stage");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onboarding_rm_idx" ON "onboarding_pipelines" USING btree ("tenant_id","assigned_rm_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rpr_investor_signed_idx" ON "risk_profile_responses" USING btree ("tenant_id","investor_id","signed_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rpr_next_review_idx" ON "risk_profile_responses" USING btree ("tenant_id","next_review_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rpr_category_idx" ON "risk_profile_responses" USING btree ("tenant_id","final_category");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sip_rej_investor_idx" ON "sip_rejections" USING btree ("tenant_id","investor_id","rejection_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sip_rej_status_idx" ON "sip_rejections" USING btree ("tenant_id","recovery_status","status_changed_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sip_rej_rm_idx" ON "sip_rejections" USING btree ("tenant_id","assigned_rm_id","recovery_status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sip_rej_tx_unique" ON "sip_rejections" USING btree ("tenant_id","transaction_id") WHERE transaction_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rm_investor_idx" ON "review_meetings" USING btree ("tenant_id","investor_id","meeting_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rm_status_idx" ON "review_meetings" USING btree ("tenant_id","status","meeting_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rm_rm_idx" ON "review_meetings" USING btree ("tenant_id","rm_id","meeting_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rm_date_idx" ON "review_meetings" USING btree ("tenant_id","meeting_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rm_category_idx" ON "review_meetings" USING btree ("tenant_id","category","meeting_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rm_parent_idx" ON "review_meetings" USING btree ("parent_meeting_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_status_idx" ON "proposals" USING btree ("tenant_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_investor_idx" ON "proposals" USING btree ("tenant_id","investor_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_lead_idx" ON "proposals" USING btree ("tenant_id","lead_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_family_idx" ON "proposals" USING btree ("tenant_id","family_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_number_idx" ON "proposals" USING btree ("tenant_id","proposal_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ins_investor_idx" ON "insurance_policies" USING btree ("tenant_id","investor_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ins_status_idx" ON "insurance_policies" USING btree ("tenant_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ins_type_idx" ON "insurance_policies" USING btree ("tenant_id","policy_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ins_next_prem_idx" ON "insurance_policies" USING btree ("tenant_id","next_premium_due_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ins_policy_num_idx" ON "insurance_policies" USING btree ("tenant_id","policy_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wre_rule_idx" ON "workflow_rule_executions" USING btree ("rule_id","executed_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wre_subject_idx" ON "workflow_rule_executions" USING btree ("tenant_id","subject_type","subject_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wrsj_due_idx" ON "workflow_rule_scheduled_jobs" USING btree ("run_at") WHERE status = 'pending';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wrsj_rule_subject_idx" ON "workflow_rule_scheduled_jobs" USING btree ("rule_id","subject_type","subject_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wrsj_status_idx" ON "workflow_rule_scheduled_jobs" USING btree ("status","run_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wr_module_idx" ON "workflow_rules" USING btree ("tenant_id","module","enabled");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wr_trigger_idx" ON "workflow_rules" USING btree ("module","trigger_type","enabled");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wr_order_idx" ON "workflow_rules" USING btree ("tenant_id","module","execution_order");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wr_tenant_name_unique" ON "workflow_rules" USING btree ("tenant_id","module","name");
