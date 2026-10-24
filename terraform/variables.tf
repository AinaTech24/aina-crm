variable "region" {
  type    = string
  default = "ap-south-1"
}

variable "project" {
  type    = string
  default = "mfd-growth-os"
}

# Web/worker box: what production runs (2 vCPU / 8 GB ARM). A smaller size is
# a deliberate, approved resize — not a default.
variable "instance_type" {
  type    = string
  default = "t4g.large"
}

# The AMI production was built from (Amazon Linux 2023, arm64). Changing it
# REPLACES the instance — see main.tf.
variable "web_ami_id" {
  type    = string
  default = "ami-067770fe0500a2d57"
}

variable "root_volume_gb" {
  type    = number
  default = 40
}

# Managed Postgres: production is db.t4g.small (resized 2026-10-08, approved).
variable "db_instance_class" {
  type    = string
  default = "db.t4g.small"
}

variable "db_allocated_storage" {
  type    = number
  default = 20
}

# Storage AUTOSCALING ceiling. RDS grows allocated storage on demand up to this
# (never shrinks) so a full disk can't fail writes / lose data — and you only
# pay for what's actually used, not the ceiling. Set comfortably above the
# baseline. 0/equal-to-allocated disables autoscaling.
variable "db_max_allocated_storage" {
  type    = number
  default = 100
}

# Monthly cost guardrail. AWS Budgets emails at 80% (actual) and 100%
# (forecast) so spend never surprises you. Budgets themselves are free.
variable "monthly_budget_usd" {
  type    = string
  default = "60"
}

# Where budget alerts go. Blank = no budget. Production has NO AWS Budget yet;
# setting this creates one (an AWS change — approve it first).
variable "budget_alert_email" {
  type    = string
  default = ""
}

variable "db_name" {
  type    = string
  default = "mfd"
}

variable "db_username" {
  type    = string
  default = "mfd_master"
}

variable "public_key_path" {
  type    = string
  default = "~/.ssh/mfd-deploy.pub"
}

# Where CloudWatch alarms are emailed (SNS subscription, monitoring.tf).
variable "alert_email" {
  type    = string
  default = "pritesh@ainatech.in"
}
