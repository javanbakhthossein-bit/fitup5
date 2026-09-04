#!/usr/bin/env python3
"""Daemonized runner for long-running scripts (survives sandbox process reaping).

Usage: python3 .zscripts/run-daemon.py <logfile> <command> [args...]
"""
import os
import sys
import subprocess
import time


def daemonize(logfile: str) -> None:
    """Double-fork + reparent to init (tini) so the sandbox reaper can't kill us."""
    # redirect stdout/stderr to logfile
    logfd = os.open(logfile, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
    os.dup2(logfd, 1)
    os.dup2(logfd, 2)
    os.close(logfd)

    pid = os.fork()
    if pid > 0:
        # parent exits immediately — child reparented to init
        sys.exit(0)
    # child: new session, detached from terminal
    os.setsid()
    pid2 = os.fork()
    if pid2 > 0:
        sys.exit(0)
    # grandchild continues


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: run-daemon.py <logfile> <command> [args...]", file=sys.stderr)
        sys.exit(1)
    logfile = sys.argv[1]
    cmd = sys.argv[2:]
    daemonize(logfile)
    # small delay so the shell returns before we start writing
    time.sleep(0.2)
    proc = subprocess.run(cmd, cwd="/home/z/my-project")
    sys.exit(proc.returncode)
