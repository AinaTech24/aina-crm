-- 0044a_financial_plans.sql
-- migrate:skip-if-table-exists financial_plans
--
-- financial_plans is the one table in src/db/schema that no migration ever
-- created: it reached every database through `drizzle-kit push`. On a FRESH
-- database the chain therefore died at 0045_financial_plans_status_idx.sql
-- ("relation financial_plans does not exist"). This file creates it, in its
-- current shape, just before that first reference; 0045 and 0160 are all
-- IF NOT EXISTS / guarded, so they are no-ops on top of it.
--
-- The pragma on line 2 makes scripts/migrate-all.ts record this file as applied
-- WITHOUT executing it wherever the table already exists (production, every
-- existing dev database). Only an empty database runs it.

CREATE TABLE IF NOT EXISTS "financial_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_number" text NOT NULL,
	"investor_id" uuid,
	"lead_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"client_age" integer,
	"spouse_age" integer,
	"children_details" jsonb DEFAULT '[]'::jsonb,
	"risk_profile" text,
	"monthly_income" numeric(16, 2),
	"monthly_expenses" numeric(16, 2),
	"savings_rate" numeric(5, 2),
	"emi_to_income_pct" numeric(5, 2),
	"assets" jsonb DEFAULT '[]'::jsonb,
	"liabilities" jsonb DEFAULT '[]'::jsonb,
	"emergency_fund_target_months" integer DEFAULT 6,
	"emergency_fund_current_value" numeric(16, 2) DEFAULT '0',
	"life_insurance_sum_assured" numeric(16, 2),
	"life_insurance_annual_premium" numeric(16, 2),
	"health_insurance_sum_assured" numeric(16, 2),
	"health_insurance_annual_premium" numeric(16, 2),
	"goals" jsonb DEFAULT '[]'::jsonb,
	"recommended_equity_pct" integer DEFAULT 0,
	"recommended_debt_pct" integer DEFAULT 0,
	"recommended_gold_pct" integer DEFAULT 0,
	"recommended_cash_pct" integer DEFAULT 0,
	"recommendations" jsonb DEFAULT '[]'::jsonb,
	"notes" text,
	"mfd_value_add_text" text,
	"prepared_by_user_id" uuid,
	"prepared_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financial_plans" ADD CONSTRAINT "financial_plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financial_plans" ADD CONSTRAINT "financial_plans_investor_id_investors_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financial_plans" ADD CONSTRAINT "financial_plans_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financial_plans" ADD CONSTRAINT "financial_plans_prepared_by_user_id_users_id_fk" FOREIGN KEY ("prepared_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_plans_investor_idx" ON "financial_plans" USING btree ("tenant_id","investor_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_plans_lead_idx" ON "financial_plans" USING btree ("tenant_id","lead_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_plans_number_idx" ON "financial_plans" USING btree ("tenant_id","plan_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_plans_status_idx" ON "financial_plans" USING btree ("tenant_id","status");
