terraform {
  # Native S3 state locking (use_lockfile) needs Terraform >= 1.11.
  required_version = ">= 1.11"

  # State holds the DB master password and other secrets: it lives ONLY in
  # this bucket (versioned, encrypted, public access blocked, a bucket policy
  # that denies everyone but the infrastructure admins). Never keep a local
  # terraform.tfstate. (Migrated 2026-10-09.)
  backend "s3" {
    bucket       = "aina-crm-tfstate-972971302420"
    key          = "aina-crm/prod/terraform.tfstate"
    region       = "ap-south-1"
    encrypt      = true
    use_lockfile = true
  }
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.60" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project   = var.project
      ManagedBy = "terraform"
    }
  }
}
