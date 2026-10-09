# ─────────────────────────────────────────────────────────────────────────────
# Monitoring: alert topic, the 11 aina-* alarms, daily EBS snapshots
# Created outside Terraform (Phase 1 hardening, 2026-10-07/09) and IMPORTED
# into state on 2026-10-09 exactly as they are in production. They use the
# "as_is" provider (no default_tags) so importing them does not re-tag them.
# ─────────────────────────────────────────────────────────────────────────────
resource "aws_sns_topic" "alerts" {
  provider = aws.as_is
  name     = "aina-crm-production-alerts"
  tags = {
    "Project" = "aina-crm"
  }
}

resource "aws_sns_topic_subscription" "alerts_email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email

  # These two only steer Terraform while it CREATES a subscription (how long to
  # wait for the email confirmation); AWS never returns them, so an imported
  # subscription always shows them as changed. Nothing in AWS is ignored.
  lifecycle {
    ignore_changes = [confirmation_timeout_in_minutes, endpoint_auto_confirms]
  }
}

resource "aws_cloudwatch_metric_alarm" "ec2_cpu_high" {
  provider            = aws.as_is
  alarm_name          = "aina-ec2-cpu-high"
  alarm_description   = "EC2 CPU > 85% for 15 min (baseline 5-6%; deploy builds < 10 min)"
  namespace           = "AWS/EC2"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = 85
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions = {
    InstanceId = aws_instance.web.id
  }
  tags = {}
}

resource "aws_cloudwatch_metric_alarm" "ec2_disk_high" {
  provider            = aws.as_is
  alarm_name          = "aina-ec2-disk-high"
  alarm_description   = "EC2 root disk used > 80% for 10 min (64% before cleanup)"
  namespace           = "CWAgent"
  metric_name         = "disk_used_percent"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  comparison_operator = "GreaterThanThreshold"
  threshold           = 80
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions = {
    path       = "C:/Program Files/Git/"
    InstanceId = aws_instance.web.id
    fstype     = "xfs"
  }
  tags = {}
}

resource "aws_cloudwatch_metric_alarm" "ec2_memory_high" {
  provider            = aws.as_is
  alarm_name          = "aina-ec2-memory-high"
  alarm_description   = "EC2 memory used > 85% for 15 min (baseline ~37%)"
  namespace           = "CWAgent"
  metric_name         = "mem_used_percent"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = 85
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions = {
    InstanceId = aws_instance.web.id
  }
  tags = {}
}

resource "aws_cloudwatch_metric_alarm" "ec2_status_check_failed" {
  provider            = aws.as_is
  alarm_name          = "aina-ec2-status-check-failed"
  alarm_description   = "EC2 instance or system status check failed for 2 min, or no data (instance down)"
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions = {
    InstanceId = aws_instance.web.id
  }
  tags = {}
}

resource "aws_cloudwatch_metric_alarm" "ec2_swap_high" {
  provider            = aws.as_is
  alarm_name          = "aina-ec2-swap-high"
  alarm_description   = "EC2 swap used > 50% of 4 GB for 15 min (baseline ~8%)"
  namespace           = "CWAgent"
  metric_name         = "swap_used_percent"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = 50
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions = {
    InstanceId = aws_instance.web.id
  }
  tags = {}
}

resource "aws_cloudwatch_metric_alarm" "rds_connections_high" {
  provider            = aws.as_is
  alarm_name          = "aina-rds-connections-high"
  alarm_description   = "RDS connections > 135 (~75% of max_connections 181 on db.t4g.small)"
  namespace           = "AWS/RDS"
  metric_name         = "DatabaseConnections"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  comparison_operator = "GreaterThanThreshold"
  threshold           = 135
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.identifier
  }
  tags = {}
}

resource "aws_cloudwatch_metric_alarm" "rds_cpu_credits_low" {
  provider            = aws.as_is
  alarm_name          = "aina-rds-cpu-credits-low"
  alarm_description   = "RDS CPU credits < 30 for 10 min (t4g.micro max 288; hit 0 in Sep)"
  namespace           = "AWS/RDS"
  metric_name         = "CPUCreditBalance"
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  comparison_operator = "LessThanThreshold"
  threshold           = 30
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.identifier
  }
  tags = {}
}

resource "aws_cloudwatch_metric_alarm" "rds_cpu_high" {
  provider            = aws.as_is
  alarm_name          = "aina-rds-cpu-high"
  alarm_description   = "RDS CPU > 80% for 15 min (baseline 6-7%)"
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = 80
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.identifier
  }
  tags = {}
}

resource "aws_cloudwatch_metric_alarm" "rds_free_storage_low" {
  provider            = aws.as_is
  alarm_name          = "aina-rds-free-storage-low"
  alarm_description   = "RDS FreeStorageSpace < 4 GB for 10 min (autoscaling max 100 GB)"
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  comparison_operator = "LessThanThreshold"
  threshold           = 4294967296
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.identifier
  }
  tags = {}
}

resource "aws_cloudwatch_metric_alarm" "rds_freeable_memory_low" {
  provider            = aws.as_is
  alarm_name          = "aina-rds-freeable-memory-low"
  alarm_description   = "RDS FreeableMemory < 200 MB (db.t4g.small 2 GB; post-resize normal 460-750 MB)"
  namespace           = "AWS/RDS"
  metric_name         = "FreeableMemory"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  comparison_operator = "LessThanThreshold"
  threshold           = 209715200
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.identifier
  }
  tags = {}
}

resource "aws_cloudwatch_metric_alarm" "rds_swap_high" {
  provider            = aws.as_is
  alarm_name          = "aina-rds-swap-high"
  alarm_description   = "RDS SwapUsage > 128 MB (db.t4g.small; post-resize normal ~10 MB)"
  namespace           = "AWS/RDS"
  metric_name         = "SwapUsage"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = 134217728
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.identifier
  }
  tags = {}
}

# DLM's own role (created by "create default role").
resource "aws_iam_role" "dlm" {
  provider = aws.as_is
  name     = "AWSDataLifecycleManagerDefaultRole"
  assume_role_policy = jsonencode({
    "Version" : "2012-10-17",
    "Statement" : [
      {
        "Sid" : "",
        "Effect" : "Allow",
        "Principal" : {
          "Service" : "dlm.amazonaws.com"
        },
        "Action" : "sts:AssumeRole"
      }
    ]
  })
  tags = {}
}

resource "aws_iam_role_policy_attachment" "dlm" {
  role       = aws_iam_role.dlm.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole"
}

# Daily snapshot of every volume tagged aina-backup=daily (the root volume,
# main.tf) at 20:30 UTC (02:00 IST); keep 7.
resource "aws_dlm_lifecycle_policy" "daily" {
  provider           = aws.as_is
  description        = "Aina CRM EC2 root volume daily snapshot keep 7"
  execution_role_arn = aws_iam_role.dlm.arn
  state              = "ENABLED"

  policy_details {
    policy_type    = "EBS_SNAPSHOT_MANAGEMENT"
    resource_types = ["VOLUME"]
    target_tags = {
      "aina-backup" = "daily"
    }

    schedule {
      name      = "daily-0200-IST-keep-7"
      copy_tags = true
      tags_to_add = {
        "created-by" = "dlm-aina-daily"
      }
      create_rule {
        interval      = 24
        interval_unit = "HOURS"
        times         = ["20:30"]
      }
      retain_rule {
        count = 7
      }
    }
  }
  tags = {
    "Name" = "aina-crm-ec2-daily"
  }
}
