#!/usr/bin/env bash
# READ-ONLY investigation of the Docker daemon's memory. Changes nothing, restarts nothing.
# Run on the box (as root or ec2-user with docker access):  bash scripts/docker-mem-report.sh
set -u
mb() { awk -v k="$1" 'BEGIN{printf "%.0f MB", k/1024}'; }
echo "=== processes (RSS / PSS / anonymous / file-backed / swapped, from /proc/<pid>/smaps_rollup)"
for name in dockerd containerd containerd-shim-runc-v2 buildkitd docker-proxy; do
  for pid in $(pgrep -x "$name" 2>/dev/null); do
    f=/proc/$pid/smaps_rollup; [ -r "$f" ] || { echo "$name[$pid] (no access)"; continue; }
    rss=$(awk '/^Rss:/{print $2}' $f); pss=$(awk '/^Pss:/{print $2}' $f); anon=$(awk '/^Anonymous:/{print $2}' $f)
    swap=$(awk '/^Swap:/{print $2}' $f); thr=$(awk '/^Threads:/{print $2}' /proc/$pid/status)
    printf "%-26s pid %-8s RSS %-9s PSS %-9s anon %-9s swapped %-8s threads %s  up %s\n" "$name" "$pid" "$(mb "$rss")" "$(mb "$pss")" "$(mb "$anon")" "$(mb "$swap")" "$thr" "$(ps -o etime= -p $pid | tr -d ' ')"
  done
done
echo; echo "=== Docker's own view"
docker info --format 'storage driver: {{.Driver}} | logging: {{.LoggingDriver}} | cgroup: {{.CgroupDriver}} {{.CgroupVersion}} | containers: {{.Containers}} (running {{.ContainersRunning}}) | images: {{.Images}} | live-restore: {{.LiveRestoreEnabled}}'
docker info 2>/dev/null | grep -iE "containerd|snapshotter|Docker Root Dir|Server Version" | sed 's/^ *//'
echo; echo "=== what the daemon is holding"
echo "image layers dirs : $(ls /var/lib/docker/overlay2 2>/dev/null | wc -l)"
echo "image metadata    : $(du -sm /var/lib/docker/image 2>/dev/null | cut -f1) MB   buildkit state: $(du -sm /var/lib/docker/buildkit 2>/dev/null | cut -f1) MB"
echo "container logs    : $(du -smc /var/lib/docker/containers/*/*-json.log 2>/dev/null | tail -1 | cut -f1) MB (json-file, rotated by compose max-size)"
docker system df 2>/dev/null
echo; echo "=== cgroup accounting: memory charged to docker.service vs containers"
for u in docker.service containerd.service; do
  f=/sys/fs/cgroup/system.slice/$u/memory.current; [ -r "$f" ] && echo "$u memory.current $(mb $(( $(cat $f) / 1024 ))) (includes page cache charged to it)"
  g=/sys/fs/cgroup/system.slice/$u/memory.stat; [ -r "$g" ] && awk '/^(anon|file|kernel|slab|sock) /{printf "   %-8s %s\n",$1,int($2/1048576)" MB"}' $g
done
echo; echo "=== system"
free -m | sed -n '1,3p'
grep -E "^(Cached|Buffers|Slab|SReclaimable|AnonPages|Mapped|Shmem):" /proc/meminfo | awk '{printf "%-14s %6.0f MB\n",$1,$2/1024}'
