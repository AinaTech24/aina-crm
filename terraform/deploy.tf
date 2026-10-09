# ─────────────────────────────────────────────────────────────────────────────
# Deploy path: GitHub OIDC role, laptop manual-deploy role, release bucket
# Created outside Terraform (Phase 1 hardening, 2026-10-07/09) and IMPORTED
# into state on 2026-10-09 exactly as they are in production. They use the
# "as_is" provider (no default_tags) so importing them does not re-tag them.
# ─────────────────────────────────────────────────────────────────────────────
resource "aws_iam_openid_connect_provider" "github" {
  provider        = aws.as_is
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
  tags = {
    "Project" = "aina-crm"
  }
}

# GitHub Actions, environment "production" of AinaTech24/aina-crm only.
resource "aws_iam_role" "github_deploy" {
  provider             = aws.as_is
  name                 = "aina-crm-github-deploy"
  description          = "GitHub Actions (AinaTech24/aina-crm, environment production) deploys via SSM"
  max_session_duration = 3600
  assume_role_policy = jsonencode({
    "Version" : "2012-10-17",
    "Statement" : [
      {
        "Sid" : "GitHubActionsProductionEnvironmentOnly",
        "Effect" : "Allow",
        "Principal" : {
          "Federated" : "arn:aws:iam::972971302420:oidc-provider/token.actions.githubusercontent.com"
        },
        "Action" : "sts:AssumeRoleWithWebIdentity",
        "Condition" : {
          "StringEquals" : {
            "token.actions.githubusercontent.com:sub" : "repo:AinaTech24/aina-crm:environment:production",
            "token.actions.githubusercontent.com:aud" : "sts.amazonaws.com"
          }
        }
      }
    ]
  })
  tags = {
    "Project" = "aina-crm"
  }
}

# The laptop path while Actions is unavailable: short-lived credentials only
# (scripts/aws-deploy-role.sh).
resource "aws_iam_role" "manual_deploy" {
  provider             = aws.as_is
  name                 = "aina-crm-manual-deploy"
  description          = "Temporary manual deploy path while GitHub Actions is billing-blocked: SSM blue-green deploy of the prod EC2 only. Assumed with short-lived credentials."
  max_session_duration = 3600
  assume_role_policy = jsonencode({
    "Version" : "2012-10-17",
    "Statement" : [
      {
        "Sid" : "LaptopDeployerAssumes",
        "Effect" : "Allow",
        "Principal" : {
          "AWS" : "arn:aws:iam::972971302420:user/mfd-deploy"
        },
        "Action" : "sts:AssumeRole"
      }
    ]
  })
  tags = {
    "project" = "aina-crm"
    "purpose" = "manual-deploy"
    "created" = "2026-10-09"
  }
}

locals {
  # Upload a release; run commands on the production instance only; read results.
  deploy_via_ssm_policy = jsonencode({
    "Version" : "2012-10-17",
    "Statement" : [
      {
        "Sid" : "UploadReleaseTarball",
        "Effect" : "Allow",
        "Action" : "s3:PutObject",
        "Resource" : "arn:aws:s3:::aina-crm-deploy-artifacts-972971302420/releases/*"
      },
      {
        "Sid" : "RunDeployOnProdInstanceOnly",
        "Effect" : "Allow",
        "Action" : "ssm:SendCommand",
        "Resource" : [
          "arn:aws:ec2:ap-south-1:972971302420:instance/i-059673ee0da4f877a",
          "arn:aws:ssm:ap-south-1::document/AWS-RunShellScript"
        ]
      },
      {
        "Sid" : "ReadCommandResults",
        "Effect" : "Allow",
        "Action" : [
          "ssm:GetCommandInvocation",
          "ssm:ListCommandInvocations"
        ],
        "Resource" : "*"
      }
    ]
  })
}

resource "aws_iam_role_policy" "github_deploy" {
  name   = "aina-crm-deploy-via-ssm"
  role   = aws_iam_role.github_deploy.id
  policy = local.deploy_via_ssm_policy
}

resource "aws_iam_role_policy" "manual_deploy" {
  name   = "aina-crm-deploy-via-ssm"
  role   = aws_iam_role.manual_deploy.id
  policy = local.deploy_via_ssm_policy
}

resource "aws_s3_bucket" "deploy_artifacts" {
  provider = aws.as_is
  bucket   = "aina-crm-deploy-artifacts-972971302420"
  tags = {
    "Project" = "aina-crm"
    "Purpose" = "deploy-artifacts"
  }
}

resource "aws_s3_bucket_public_access_block" "deploy_artifacts" {
  bucket                  = aws_s3_bucket.deploy_artifacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "deploy_artifacts" {
  bucket = aws_s3_bucket.deploy_artifacts.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "deploy_artifacts" {
  bucket = aws_s3_bucket.deploy_artifacts.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = false
  }
}

# Releases are disposable: kept 14 days.
resource "aws_s3_bucket_lifecycle_configuration" "deploy_artifacts" {
  bucket = aws_s3_bucket.deploy_artifacts.id
  rule {
    id     = "expire-releases-14d"
    status = "Enabled"
    filter {
      prefix = "releases/"
    }
    expiration {
      days = 14
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

resource "aws_s3_bucket_policy" "deploy_artifacts" {
  bucket = aws_s3_bucket.deploy_artifacts.id
  policy = jsonencode({
    "Version" : "2012-10-17",
    "Statement" : [
      {
        "Sid" : "DenyInsecureTransport",
        "Effect" : "Deny",
        "Principal" : "*",
        "Action" : "s3:*",
        "Resource" : [
          "arn:aws:s3:::aina-crm-deploy-artifacts-972971302420",
          "arn:aws:s3:::aina-crm-deploy-artifacts-972971302420/*"
        ],
        "Condition" : {
          "Bool" : {
            "aws:SecureTransport" : "false"
          }
        }
      }
    ]
  })
}
