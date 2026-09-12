#!/usr/bin/env python3
"""Supervisor daemon for the FitUp dev server (with auto-restart).

Runs `bun next dev` as a true daemon (double-fork, reparented to PID 1/tini)
AND keeps watching it: if the dev server dies (sandbox OOM-kill, crash...),
it is automatically restarted after a short cooldown. stdout/stderr of every
run are appended to dev.log with a separator line.

Usage:
    python3 .zscripts/daemon-start.py          # start (or reuse running) supervisor
    python3 .zscripts/daemon-start.py --stop   # stop supervisor + server
"""
import os
import sys
import time
import signal
import subprocess

DEV_LOG = "/home/z/my-project/dev.log"
PID_FILE = "/home/z/my-project/dev.pid"
WORKDIR = "/home/z/my-project"
COOLDOWN_SEC = 4


def _is_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def _cleanup_existing() -> bool:
    """Return True if a healthy supervisor is already running."""
    try:
        with open(PID_FILE) as f:
            old = f.read().strip()
        if old and old.isdigit():
            pid = int(old)
            if _is_alive(pid):
                # Check it is our supervisor (cmdline contains this script name)
                try:
                    with open(f"/proc/{pid}/cmdline", "rb") as f:
                        cmd = f.read().decode(errors="ignore")
                    if "daemon-start" in cmd:
                        return True
                except Exception:
                    pass
            # stale or foreign pid — kill politely
            try:
                os.kill(pid, signal.SIGTERM)
                time.sleep(1.5)
            except Exception:
                pass
            # kill any leftover next dev on port 3000
            subprocess.run(
                ["pkill", "-f", "next dev -p 3000"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            time.sleep(0.5)
    except FileNotFoundError:
        pass
    except Exception:
        pass
    return False


def main():
    stop_mode = "--stop" in sys.argv
    if stop_mode:
        try:
            with open(PID_FILE) as f:
                old = int(f.read().strip())
            os.kill(old, signal.SIGTERM)
        except Exception:
            pass
        subprocess.run(["pkill", "-f", "next dev -p 3000"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            os.remove(PID_FILE)
        except Exception:
            pass
        print("stopped")
        return

    if _cleanup_existing():
        print("already running")
        return

    # First fork — parent returns immediately
    if os.fork() > 0:
        os._exit(0)

    # First child: become session leader
    os.setsid()
    os.umask(0o022)

    # Second fork — grandchild is reparented to PID 1
    if os.fork() > 0:
        os._exit(0)

    # Grandchild = supervisor daemon
    os.chdir(WORKDIR)

    sys.stdout.flush()
    sys.stderr.flush()
    devnull = os.open("/dev/null", os.O_RDONLY)
    logfd = os.open(DEV_LOG, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
    os.dup2(devnull, 0)
    os.dup2(logfd, 1)
    os.dup2(logfd, 2)
    os.close(devnull)
    os.close(logfd)

    try:
        with open(PID_FILE, "w") as f:
            f.write(str(os.getpid()))
    except Exception:
        pass

    env = dict(os.environ)
    # Cap heap (project uses ~2GB; container is 4GB) to reduce OOM kills
    env["NODE_OPTIONS"] = "--max-old-space-size=1280"

    # ─── Supervisor loop: restart the dev server whenever it dies ───
    while True:
        print(f"\n=== [daemon-start] starting dev server @ {time.strftime('%H:%M:%S')} ===", flush=True)
        try:
            proc = subprocess.Popen(
                ["bun", "next", "dev", "-p", "3000", "--webpack"],
                cwd=WORKDIR,
                env=env,
                stdout=None,  # inherits our redirected fds → dev.log
                stderr=None,
            )
        except Exception as e:
            print(f"[daemon-start] spawn failed: {e}", flush=True)
            time.sleep(10)
            continue

        # Wait for the child; if it exits for ANY reason, restart after cooldown
        rc = proc.wait()
        print(f"[daemon-start] dev server exited (rc={rc}) — restarting in {COOLDOWN_SEC}s", flush=True)
        time.sleep(COOLDOWN_SEC)


if __name__ == "__main__":
    main()
