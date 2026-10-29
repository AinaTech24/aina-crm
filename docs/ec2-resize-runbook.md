# EC2 resize: t4g.large → t4g.medium (runbook)

Prepared 2026-10-24. **Not run yet** — it runs only on the user's go, at a time
they confirm, inside the quiet window **22:00–01:00 IST**.

| | |
|---|---|
| Server | `i-059673ee0da4f877a` (ap-south-1b), Elastic IP 13.204.102.20 — stays attached through stop/start |
| Change | t4g.large (8 GB, $0.0448/h) → t4g.medium (4 GB, $0.0224/h): **−$16.35/month** pre-tax |
| Downtime | ~2–4 minutes (stop, change type, start, containers come back) |
| Script | `scripts/resize-ec2.sh` (`check` is read-only; `run` needs `CONFIRM=yes`) |
| Rollback | the same script with `t4g.large`: another ~2–4 minutes |

## Why it is safe now (evidence, 2026-10-10 → 10-24)

- Normal memory use: 1.9 GB (p95 33% of 8 GB ≈ 2.6 GB). On 4 GB that is ~50–65%.
- Deploy peak (verified-artifact deploys, 23 and 24 Oct): **3.0–3.1 GB**, swap flat. dockerd now
  72 MB (was 1.08 GB when the 15 Oct check said NO-GO).
- CPU averages 5%; t4g.medium has the same 2 vCPUs (baseline 20%, credit mode unlimited).
- 4 GB swapfile is in `/etc/fstab`; docker, CloudWatch agent and SSM agent are enabled
  at boot; every container is `restart: unless-stopped`; Caddy points at both
  colours; the change lock lives in `$HOME` (survives the restart).
- The box has been up 120 days with a single installed kernel, so the first boot
  boots the same kernel.

Known risk: on 23 Oct 04:45 IST memory hit 83% (6.6 GB) for ~10 minutes while all
containers restarted; cause unconfirmed. On 4 GB the same event would swap and be
slow for a few minutes, not fail.

## Before the window

1. The user confirms the date and time.
2. No push to `main` for the window (a push deploys automatically; while the box is
   stopped that deploy would fail, and the lock would make it wait otherwise).
3. Sign in once: `aws sso login --profile aina-admin` (covers aina-deploy too).

## Run

```bash
bash scripts/resize-ec2.sh check
```

Go only if: instance is `t4g.large`, health `200`, lock `FREE`, no deploy in
progress, swap < 300 MB. Then:

```bash
CONFIRM=yes bash scripts/resize-ec2.sh run t4g.medium resize-medium-YYYYMMDD
```

What it does, in order: check → take the change lock → snapshot the root disk
(tagged `purpose=pre-resize`) → stop → change type → start (if the new type will
not start, e.g. no capacity, it switches back to t4g.large on its own) → wait for
`https://crm.ainatech.in/api/health` = 200 (10 min max) → start the worker if it
did not come back → print memory and containers → release the lock with `PASS`.

If health never returns 200 the lock is **kept** and the script prints the rollback.

## Rollback

Do it at once if any of these happen:

- the site is not back within 10 minutes;
- during the 7 days after: the `aina-ec2-memory-high` alarm (>85% for 15 min) or
  `aina-ec2-swap-high` (>50% swap) fires, a deploy shows swap rising by more than
  1 GB, or `dmesg` shows an OOM kill.

```bash
CONFIRM=yes bash scripts/resize-ec2.sh run t4g.large <same-session-name>
```

If the lock is still yours (failed run) it continues without re-taking it; after a
successful run it takes a fresh lock. Rolling back to t4g.large in Mumbai has never
had a capacity problem; if it did, try again a few minutes later.

## After a successful run

- [ ] Next deploy: read its `DEPLOY METRICS` block (`gh run view <id> --log | grep -A12 "DEPLOY METRICS"`):
      host RAM peak should be ≤ 3.3 GB and swap flat.
- [ ] Watch memory/swap daily for 7 days (CloudWatch alarms already email).
- [x] Set `instance_type` default to `"t4g.medium"` in `terraform/variables.tf` so
      the plan stays 0 change (never `terraform apply` without approval).
- [ ] Delete the `pre-resize` snapshot after 14 days.
- [ ] After 2–4 stable weeks: price the 1-year reservation (t4g.medium standard,
      no upfront, $0.0142/h ≈ $10.37/month).

## Attempt log

- **2026-10-24 15:32 IST** — stop → modify → start failed with
  `InsufficientInstanceCapacity` (no t4g.medium in ap-south-1b). The script put
  it back on t4g.large automatically: **97 s downtime**, all containers healthy,
  snapshot `snap-042fbaa72d5354901`.
- **2026-10-24 15:37 IST** — retried with the new capacity-reservation step: the
  reservation was refused, so **nothing was stopped** (0 downtime). Since then the
  script reserves capacity first and refuses to run while a GitHub deploy is in
  progress. Failed reservations cost nothing.
- **2026-10-24 16:00 IST** — scheduled retry: reservation refused again, nothing
  stopped (0 downtime), lock released, health 200, no reservation left active.
- **2026-10-24 16:08 IST** — refused again; a retry every 10 minutes was started.
- **2026-10-24 16:19 IST — DONE.** The reservation was granted on the first loop
  try: stopped 21 s, started as **t4g.medium**, **68 s downtime**, health 200,
  reservation cancelled, lock released (`PASS`), snapshot `snap-0e0f28eb96ca668df`.
  After start: 1.54 GB used of 3.8 GB, 2.1 GB available, swap 0, all four
  containers up, no OOM. `terraform/variables.tf` default set to `t4g.medium`.
