variable "region" {
  type    = string
  default = "ap-south-1"
}

variable "project" {
  type    = string
  default = "mfd-growth-os"
}

# Web/worker box. t4g.medium = 2 vCPU / 4 GB ARM (Graviton) — cheap + ample
# headroom for Next.js + worker + redis + caddy on one host.
variable "instance_type" {
  type    = string
  default = "t4g.medium"
}

variable "root_volume_gb" {
  type    = number
  default = 40
}

# Managed Postgres. db.t4g.micro is free-tier-eligible for the first 12 months
# on a new account, then ~₹1k/mo. Bump to db.t4g.small when you outgrow it.
variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "db_allocated_storage" {
  type    = number
  default = 20
}

variable "db_name" {
  type    = string
  default = "mfd"
}

variable "db_username" {
  type    = string
  default = "mfd_master"
}

# Only this CIDR may SSH to the box. Set to <your-public-ip>/32 in tfvars.
variable "ssh_cidr" {
  type        = string
  description = "CIDR allowed to SSH (e.g. 49.36.117.249/32)"
}

variable "public_key_path" {
  type    = string
  default = "~/.ssh/mfd-deploy.pub"
}
