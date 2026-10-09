# ─────────────────────────────────────────────────────────────────────────────
# Uploads bucket settings (versioning, encryption, CORS, policy, ownership)
# Created outside Terraform (Phase 1 hardening, 2026-10-07/09) and IMPORTED
# into state on 2026-10-09 exactly as they are in production. They use the
# "as_is" provider (no default_tags) so importing them does not re-tag them.
# ─────────────────────────────────────────────────────────────────────────────
resource "aws_s3_bucket_versioning" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = false
  }
}

resource "aws_s3_bucket_ownership_controls" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# Browser uploads (presigned PUT) from the CRM and local dev.
resource "aws_s3_bucket_cors_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["PUT", "GET", "HEAD"]
    allowed_origins = ["https://crm.ainatech.in", "http://localhost:3000", "http://127.0.0.1:3000"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

# SES (receipt rule set aina-rta-inbound, ses.tf) drops RTA mailback emails
# under rta-inbound/.
resource "aws_s3_bucket_policy" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  policy = jsonencode({
    "Version" : "2012-10-17",
    "Statement" : [
      {
        "Sid" : "AllowSESPutRtaInbound",
        "Effect" : "Allow",
        "Principal" : {
          "Service" : "ses.amazonaws.com"
        },
        "Action" : "s3:PutObject",
        "Resource" : "arn:aws:s3:::mfd-growth-os-uploads-89b11a/rta-inbound/*",
        "Condition" : {
          "StringEquals" : {
            "AWS:SourceAccount" : "972971302420"
          },
          "StringLike" : {
            "AWS:SourceArn" : "arn:aws:ses:ap-south-1:972971302420:receipt-rule-set/aina-rta-inbound:receipt-rule/*"
          }
        }
      }
    ]
  })
}
