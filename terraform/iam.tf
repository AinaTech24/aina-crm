# ─────────────────────────────────────────────────────────────────────────────
# EC2 instance role — monitoring, deploy-artifact read, SSM, CloudWatch agent
# Created outside Terraform (Phase 1 hardening, 2026-10-07/09) and IMPORTED
# into state on 2026-10-09 exactly as they are in production. They use the
# "as_is" provider (no default_tags) so importing them does not re-tag them.
# ─────────────────────────────────────────────────────────────────────────────
resource "aws_iam_role_policy" "aina_crm_monitoring_read" {
  name = "aina-crm-monitoring-read"
  role = aws_iam_role.ec2.id
  policy = jsonencode({
    "Version" : "2012-10-17",
    "Statement" : [
      {
        "Sid" : "AinaMonitoringDashboardRead",
        "Effect" : "Allow",
        "Action" : [
          "cloudwatch:GetMetricStatistics",
          "ec2:DescribeInstances",
          "ec2:DescribeInstanceStatus",
          "ec2:DescribeVolumes",
          "rds:DescribeDBInstances",
          "iam:GetAccountSummary"
        ],
        "Resource" : "*"
      }
    ]
  })
}

resource "aws_iam_role_policy" "aina_crm_deploy_artifacts_read" {
  name = "aina-crm-deploy-artifacts-read"
  role = aws_iam_role.ec2.id
  policy = jsonencode({
    "Version" : "2012-10-17",
    "Statement" : [
      {
        "Sid" : "ReadReleaseTarballs",
        "Effect" : "Allow",
        "Action" : "s3:GetObject",
        "Resource" : "arn:aws:s3:::aina-crm-deploy-artifacts-972971302420/releases/*"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ec2_ssm_core" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy_attachment" "ec2_cloudwatch_agent" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
}
