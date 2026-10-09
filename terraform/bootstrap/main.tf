# ─────────────────────────────────────────────────────────────────────────────
# BOOTSTRAP stack — the Terraform state bucket itself.
#
# Kept OUT of the production stack (../) on purpose: the production state lives
# in this bucket, so the production stack must never be able to change or
# destroy it. This stack keeps its own state under a separate key in the same
# bucket. Nothing in ../ references anything here, so there is no circular
# dependency between the two.
#
# Lock-out safety:
#  - prevent_destroy on the bucket; versioning keeps every state version
#    (NoncurrentDays 90, newest 20) for recovery;
#  - the bucket policy denies everyone except the account root, mfd-deploy and
#    the infrastructure-admin roles. The ROOT user can always delete a bucket
#    policy that locks others out, so a bad policy is recoverable.
#  - When IAM Identity Center replaces mfd-deploy, ADD the new admin role here
#    and verify init / state pull / plan / locking BEFORE removing mfd-deploy.
#
# State holds secrets (the DB master password, in ../). Treat this bucket as a
# secret store. Imported 2026-10-09 exactly as created; DO NOT apply without
# review.
# ─────────────────────────────────────────────────────────────────────────────

terraform {
  required_version = ">= 1.11"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.60" }
  }
  backend "s3" {
    bucket       = "aina-crm-tfstate-972971302420"
    key          = "aina-crm/bootstrap/terraform.tfstate"
    region       = "ap-south-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = "ap-south-1"
}

resource "aws_s3_bucket" "tfstate" {
  bucket = "aina-crm-tfstate-972971302420"
  tags = {
    "project"     = "aina-crm"
    "purpose"     = "terraform-state"
    "sensitivity" = "secret-bearing"
  }
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket                  = aws_s3_bucket.tfstate.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    id     = "state-history-90d"
    status = "Enabled"
    # No filter: applies to the whole bucket (production has an empty filter,
    # which the provider records as none).
    noncurrent_version_expiration {
      noncurrent_days           = 90
      newer_noncurrent_versions = 20
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# TLS only; nobody but the account root and the infrastructure admins.
resource "aws_s3_bucket_policy" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  policy = jsonencode({
    "Version" : "2012-10-17",
    "Statement" : [
      {
        "Sid" : "DenyInsecureTransport",
        "Effect" : "Deny",
        "Principal" : "*",
        "Action" : "s3:*",
        "Resource" : [
          "arn:aws:s3:::aina-crm-tfstate-972971302420",
          "arn:aws:s3:::aina-crm-tfstate-972971302420/*"
        ],
        "Condition" : {
          "Bool" : {
            "aws:SecureTransport" : "false"
          }
        }
      },
      {
        "Sid" : "OnlyInfrastructureAdmins",
        "Effect" : "Deny",
        "Principal" : "*",
        "Action" : "s3:*",
        "Resource" : [
          "arn:aws:s3:::aina-crm-tfstate-972971302420",
          "arn:aws:s3:::aina-crm-tfstate-972971302420/*"
        ],
        "Condition" : {
          "ArnNotLike" : {
            "aws:PrincipalArn" : [
              "arn:aws:iam::972971302420:root",
              "arn:aws:iam::972971302420:user/mfd-deploy",
              "arn:aws:iam::972971302420:role/aina-crm-admin",
              "arn:aws:iam::972971302420:role/aws-reserved/sso.amazonaws.com/*/AWSReservedSSO_AinaInfraAdmin_*"
            ]
          }
        }
      }
    ]
  })
}
