# ─────────────────────────────────────────────────────────────────────────────
# MFD Growth OS — Tier 1 stack (1 EC2 + managed RDS) in the default VPC.
# Deliberately minimal: no NAT gateway, no load balancer, no ECS. Caddy on the
# box does TLS; RDS is private (no public IP) and only reachable from the web SG.
# ─────────────────────────────────────────────────────────────────────────────

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# Amazon Linux 2023, ARM64 (matches the t4g Graviton instance).
data "aws_ssm_parameter" "al2023" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

resource "random_id" "suffix" {
  byte_length = 3
}

# RDS master password — generated, never typed or committed. Read it later with
# `terraform output -raw database_url`.
resource "random_password" "db" {
  length           = 28
  special          = true
  override_special = "_-" # RDS-safe set (no / @ " or space)
}

resource "aws_key_pair" "deploy" {
  key_name   = "${var.project}-deploy"
  public_key = file(pathexpand(var.public_key_path))
}

# ── Security groups ─────────────────────────────────────────────────────────
resource "aws_security_group" "web" {
  name        = "${var.project}-web"
  description = "web: 80/443 public, SSH from operator IP only"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "SSH (operator only)"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.ssh_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "db" {
  name        = "${var.project}-db"
  description = "postgres reachable from the web SG only"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description     = "Postgres from web"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.web.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# ── S3 uploads bucket + instance role (no static keys — SDK uses the role) ────
resource "aws_s3_bucket" "uploads" {
  bucket = "${var.project}-uploads-${random_id.suffix.hex}"
}

resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket                  = aws_s3_bucket.uploads.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_iam_role" "ec2" {
  name = "${var.project}-ec2"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "s3" {
  name = "${var.project}-s3"
  role = aws_iam_role.ec2.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
      Resource = [aws_s3_bucket.uploads.arn, "${aws_s3_bucket.uploads.arn}/*"]
    }]
  })
}

resource "aws_iam_instance_profile" "ec2" {
  name = "${var.project}-ec2"
  role = aws_iam_role.ec2.name
}

# ── Managed Postgres ─────────────────────────────────────────────────────────
resource "aws_db_subnet_group" "main" {
  name       = "${var.project}-db"
  subnet_ids = data.aws_subnets.default.ids
}

resource "aws_db_instance" "main" {
  identifier                  = "${var.project}-db"
  engine                      = "postgres"
  engine_version              = "16"
  instance_class              = var.db_instance_class
  allocated_storage           = var.db_allocated_storage
  storage_type                = "gp3"
  storage_encrypted           = true
  db_name                     = var.db_name
  username                    = var.db_username
  password                    = random_password.db.result
  db_subnet_group_name        = aws_db_subnet_group.main.name
  vpc_security_group_ids      = [aws_security_group.db.id]
  publicly_accessible         = false
  multi_az                    = false
  backup_retention_period     = 7
  auto_minor_version_upgrade  = true
  skip_final_snapshot         = true
  deletion_protection         = false
  apply_immediately           = true
}

# ── Web/worker box + stable public IP ────────────────────────────────────────
resource "aws_instance" "web" {
  ami                    = data.aws_ssm_parameter.al2023.value
  instance_type          = var.instance_type
  subnet_id              = data.aws_subnets.default.ids[0]
  vpc_security_group_ids = [aws_security_group.web.id]
  key_name               = aws_key_pair.deploy.key_name
  iam_instance_profile   = aws_iam_instance_profile.ec2.name
  user_data              = file("${path.module}/user-data.sh")

  root_block_device {
    volume_size = var.root_volume_gb
    volume_type = "gp3"
    encrypted   = true
  }

  tags = { Name = "${var.project}-web" }
}

resource "aws_eip" "web" {
  instance = aws_instance.web.id
  domain   = "vpc"
}
