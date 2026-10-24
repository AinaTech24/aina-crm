# ─────────────────────────────────────────────────────────────────────────────
# SES inbound mail for RTA mailbacks → uploads bucket rta-inbound/
# Created outside Terraform (Phase 1 hardening, 2026-10-07/09) and IMPORTED
# into state on 2026-10-09 exactly as they are in production. They use the
# "as_is" provider (no default_tags) so importing them does not re-tag them.
# ─────────────────────────────────────────────────────────────────────────────
resource "aws_ses_domain_identity" "crm" {
  domain = "crm.ainatech.in"
}

resource "aws_ses_receipt_rule_set" "rta_inbound" {
  rule_set_name = "aina-rta-inbound"
}

resource "aws_ses_active_receipt_rule_set" "rta_inbound" {
  rule_set_name = aws_ses_receipt_rule_set.rta_inbound.rule_set_name
}

resource "aws_ses_receipt_rule" "crm_to_s3" {
  name          = "crm-ainatech-in-to-s3"
  rule_set_name = aws_ses_receipt_rule_set.rta_inbound.rule_set_name
  recipients    = ["crm.ainatech.in"]
  enabled       = true
  scan_enabled  = true
  tls_policy    = "Optional"

  s3_action {
    bucket_name       = aws_s3_bucket.uploads.id
    object_key_prefix = "rta-inbound/"
    position          = 1
  }
}
