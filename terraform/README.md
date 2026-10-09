# Terraform — Aina CRM production (ap-south-1)

**Never run `terraform apply` without an explicitly approved, reviewed plan.**
Production is the source of truth; this code describes it.

## Two stacks, two states

| Stack | Directory | State (S3 key in `aina-crm-tfstate-972971302420`) | Holds |
|---|---|---|---|
| Bootstrap | `bootstrap/` | `aina-crm/bootstrap/terraform.tfstate` | the state bucket itself |
| Production | `.` | `aina-crm/prod/terraform.tfstate` | EC2, RDS, SGs, uploads bucket, IAM, deploy path, monitoring, DLM, SES, parameter group |

The production stack never references the bootstrap stack, so it can never
change or destroy the bucket that holds its own state. Both use native S3
locking (`use_lockfile`, Terraform >= 1.11). State contains the RDS master
password: treat the bucket as a secret store, and never keep a local
`terraform.tfstate`.

## Reconciled 2026-10-09

The code had drifted from production (it would have replaced the EC2
instance, shrunk RDS to micro, reopened SSH and overwritten the uploads
lifecycle). It was changed to describe production, and the resources created
outside Terraform were imported (state only). `terraform plan` now shows:

```
Plan: 0 to add, 1 to change, 0 to destroy.
  aws_db_instance.main: skip_final_snapshot true -> false,
                        final_snapshot_identifier null -> "mfd-growth-os-db-final-89b11a"
```

Those two are **Terraform-only arguments** (what Terraform does on `destroy`:
take a final snapshot). They exist in no AWS API; the old state recorded the
unsafe values. Applying would only update the state. They are left visible on
purpose rather than hidden.

Deliberate choices:

- `aws_instance.web` pins `var.web_ami_id` (the AMI it was built from) and
  normalises `user-data.sh` line endings — either change would REPLACE the box.
- The web SG description still mentions SSH: changing a description replaces
  the group. Port 22 is closed; administration is SSM only.
- Imported resources use the `aws.as_is` provider (no `default_tags`) so the
  import did not re-tag them.
- `aws_sns_topic_subscription.alerts_email` ignores two creation-only
  arguments that AWS never returns.
- No AWS Budget exists yet: `budget_alert_email` is blank. Setting it creates
  one (an AWS change — approve it first).
- `aws_db_parameter_group.slow_log` exists but is NOT attached to the instance
  (attaching needs a reboot).

Not managed here (intentionally): the `mfd-deploy` IAM user and its keys (to be
replaced by IAM Identity Center), the account root, DNS (Hostinger), the
on-box Docker/Caddy configuration and the CloudWatch agent config on the box.
