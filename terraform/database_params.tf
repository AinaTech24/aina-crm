# ─────────────────────────────────────────────────────────────────────────────
# RDS parameter group aina-crm-postgres16 — prepared, NOT attached
# Created outside Terraform (Phase 1 hardening, 2026-10-07/09) and IMPORTED
# into state on 2026-10-09 exactly as they are in production. They use the
# "as_is" provider (no default_tags) so importing them does not re-tag them.
# ─────────────────────────────────────────────────────────────────────────────
# Slow-query log at 1000 ms with parameter values masked. Attaching it to
# aws_db_instance.main needs a reboot: a separate, approved change.
resource "aws_db_parameter_group" "slow_log" {
  provider    = aws.as_is
  name        = "aina-crm-postgres16"
  family      = "postgres16"
  description = "Aina CRM prod: default.postgres16 + slow-query log 1000 ms"

  parameter {
    name         = "log_min_duration_statement"
    value        = "1000"
    apply_method = "immediate"
  }

  parameter {
    name         = "log_parameter_max_length"
    value        = "0"
    apply_method = "immediate"
  }

  parameter {
    name         = "log_parameter_max_length_on_error"
    value        = "0"
    apply_method = "immediate"
  }

  parameter {
    name         = "log_statement"
    value        = "none"
    apply_method = "immediate"
  }

  parameter {
    name         = "pg_stat_statements.track"
    value        = "top"
    apply_method = "immediate"
  }

  tags = {
    "Project" = "aina-crm"
  }
}
