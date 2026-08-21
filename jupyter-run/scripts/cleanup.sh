#!/bin/bash

# All descendant PIDs of $1 (root first), so the jupyter-lab server's own
# kernel subprocesses are included -- ui_setup.sh's `jupyter lab ... &` is
# detached (reparented to init), so this is the only way to find them.
collect_tree() {
    echo "$1"
    for child in $(pgrep -P "$1" 2>/dev/null); do
        collect_tree "$child"
    done
}

uv run jupyter notebook stop 8888
echo "Removing test-results, reactive-results, and all mod_config_file.json files"
rm -rf test-results/
rm -rf reactive-results/
find config -type f -name "mod_config_file.json" -delete

# `jupyter notebook stop` is a graceful REST shutdown request: it does
# nothing for a kernel that's wedged (e.g. stuck holding the GIL in a slow
# C-extension call) and never processes the shutdown message. Left alone,
# that server+kernel process tree keeps running and competes for CPU/port
# 8888 with the next benchmark's run -- force-kill anything still alive.
#
# Identified by who's actually bound to :8888 right now, not a PID recorded
# when ui_setup.sh started its own server: if an even-older stale server was
# already holding the port, ui_setup.sh's own `jupyter lab` fails to bind
# and exits immediately, so a recorded PID would already be dead while the
# real culprit (the older server) is left running and undetected.
if command -v fuser >/dev/null 2>&1; then
    server_pid=$(fuser 8888/tcp 2>/dev/null | tr -d ' ')
    if [[ -n "$server_pid" ]]; then
        pids=$(collect_tree "$server_pid")
        echo "=== [CleanUp] jupyter server (pid $server_pid) still bound to :8888 after graceful stop; force-killing: $pids"
        kill -TERM $pids 2>/dev/null
        sleep 2
        kill -KILL $pids 2>/dev/null
    fi
fi
