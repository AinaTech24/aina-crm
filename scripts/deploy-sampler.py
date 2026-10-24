#!/usr/bin/env python3
"""Self-measuring deploys. Runs ON THE PRODUCTION HOST (python3 stdlib only; the host has no node).

  deploy-sampler.py run <flagfile> <out.json>        sample until <flagfile> disappears, then write out.json
  deploy-sampler.py report <out.json> [name=secs ...] print the DEPLOY METRICS block (durations merged in)

Every 2 s: host RAM used (MemTotal - MemAvailable, the same definition the CloudWatch agent uses),
swap used, RSS of dockerd / containerd / containerd-shim / buildkitd, whole-host CPU %, free disk on /.
Every ~6 s: `docker stats` for the app containers (web blue/green, worker).
"Before" = the first sample, "after" = the last, "peak"/"lowest" = the extreme in between.
Read-only: it never touches Docker, the app or the database.
"""
import json, os, subprocess, sys, time

MB = 1024 * 1024


def meminfo():
    d = {}
    with open("/proc/meminfo") as f:
        for line in f:
            k, v = line.split(":", 1)
            d[k] = int(v.split()[0]) // 1024  # kB -> MB
    return d


def cpu_times():
    with open("/proc/stat") as f:
        p = [int(x) for x in f.readline().split()[1:]]
    idle = p[3] + (p[4] if len(p) > 4 else 0)
    return idle, sum(p)


def proc_rss():
    """RSS in MB summed per process name we care about."""
    want = {"dockerd": 0, "containerd": 0, "containerd-shim": 0, "buildkitd": 0, "docker-proxy": 0}
    for pid in os.listdir("/proc"):
        if not pid.isdigit():
            continue
        try:
            with open(f"/proc/{pid}/comm") as f:
                comm = f.read().strip()
            key = None
            if comm in want:
                key = comm
            elif comm.startswith("containerd-shim"):
                key = "containerd-shim"
            if key is None:
                continue
            with open(f"/proc/{pid}/status") as f:
                for line in f:
                    if line.startswith("VmRSS:"):
                        want[key] += int(line.split()[1]) // 1024
                        break
        except OSError:
            continue
    return want


def to_mb(s):
    s = s.strip()
    num = float("".join(c for c in s if c.isdigit() or c == "."))
    if s.endswith("GiB"):
        return num * 1024
    if s.endswith("MiB"):
        return num
    if s.endswith("KiB"):
        return num / 1024
    if s.endswith("B"):
        return num / MB
    return num


def docker_stats():
    out = {}
    try:
        r = subprocess.run(["docker", "stats", "--no-stream", "--format", "{{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}"],
                           capture_output=True, text=True, timeout=20)
        for line in r.stdout.splitlines():
            name, mem, cpu = (line.split("\t") + ["", "", ""])[:3]
            out[name] = {"mb": to_mb(mem.split("/")[0]), "cpu": float(cpu.strip("%") or 0)}
    except Exception:
        pass
    return out


def run(flag, out):
    s = {"host_ram_mb": [], "swap_mb": [], "dockerd_mb": [], "containerd_mb": [], "shim_mb": [], "buildkit_mb": [],
         "cpu_pct": [], "disk_free_gb": [], "containers": {}, "samples": 0, "start": time.time()}
    prev = cpu_times()
    last_docker = 0
    while os.path.exists(flag):
        mi = meminfo()
        s["host_ram_mb"].append(mi["MemTotal"] - mi["MemAvailable"])
        s["swap_mb"].append(mi.get("SwapTotal", 0) - mi.get("SwapFree", 0))
        rss = proc_rss()
        s["dockerd_mb"].append(rss["dockerd"]); s["containerd_mb"].append(rss["containerd"])
        s["shim_mb"].append(rss["containerd-shim"]); s["buildkit_mb"].append(rss["buildkitd"])
        cur = cpu_times()
        di, dt = cur[0] - prev[0], cur[1] - prev[1]
        s["cpu_pct"].append(round(100.0 * (1 - di / dt), 1) if dt > 0 else 0.0)
        prev = cur
        st = os.statvfs("/")
        s["disk_free_gb"].append(round(st.f_bavail * st.f_frsize / 1024 ** 3, 2))
        if time.time() - last_docker > 6:
            for name, v in docker_stats().items():
                s["containers"].setdefault(name, []).append(v["mb"])
            last_docker = time.time()
        s["samples"] += 1
        time.sleep(2)
    s["end"] = time.time()
    with open(out, "w") as f:
        json.dump(s, f)


def triple(a, low=False):
    if not a:
        return None
    return {"before": round(a[0], 1), ("lowest" if low else "peak"): round(min(a) if low else max(a), 1), "after": round(a[-1], 1)}


def report(out, marks):
    with open(out) as f:
        s = json.load(f)
    m = {
        "samples": s["samples"], "seconds": round(s["end"] - s["start"]),
        "host_ram_used_mb": triple(s["host_ram_mb"]), "swap_used_mb": triple(s["swap_mb"]),
        "dockerd_rss_mb": triple(s["dockerd_mb"]), "containerd_rss_mb": triple(s["containerd_mb"]),
        "containerd_shim_rss_mb": triple(s["shim_mb"]), "buildkit_rss_mb": triple(s["buildkit_mb"]),
        "cpu_peak_pct": round(max(s["cpu_pct"]), 1) if s["cpu_pct"] else None,
        "disk_free_gb": triple(s["disk_free_gb"], low=True),
        "container_peak_mb": {k: round(max(v), 1) for k, v in s["containers"].items()},
        "durations_s": marks,
    }
    with open(out.replace(".json", ".metrics.json"), "w") as f:
        json.dump(m, f, indent=1)
    def t(x, unit):
        return "n/a" if not x else " | ".join(f"{k} {v}{unit}" for k, v in x.items())
    print("=== DEPLOY METRICS ===")
    print(f"HOST RAM used     : {t(m['host_ram_used_mb'], ' MB')}")
    print(f"SWAP used         : {t(m['swap_used_mb'], ' MB')}")
    print(f"DOCKERD RSS       : {t(m['dockerd_rss_mb'], ' MB')}")
    print(f"CONTAINERD RSS    : {t(m['containerd_rss_mb'], ' MB')} | shims {t(m['containerd_shim_rss_mb'], ' MB')} | buildkitd {t(m['buildkit_rss_mb'], ' MB')}")
    for k, v in sorted(m["container_peak_mb"].items()):
        print(f"CONTAINER {k:<14}: peak {v} MB")
    print(f"CPU PEAK          : {m['cpu_peak_pct']} %")
    print(f"DISK FREE         : {t(m['disk_free_gb'], ' GB')}")
    print("DURATIONS (s)     : " + ", ".join(f"{k}={v}" for k, v in marks.items()))
    print("=== END DEPLOY METRICS ===")


if __name__ == "__main__":
    if sys.argv[1] == "run":
        run(sys.argv[2], sys.argv[3])
    elif sys.argv[1] == "report":
        marks = {}
        for a in sys.argv[3:]:
            k, _, v = a.partition("=")
            try:
                marks[k] = int(float(v))
            except ValueError:
                pass
        report(sys.argv[2], marks)
