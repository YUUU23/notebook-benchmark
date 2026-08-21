#!/bin/bash

cd ui || exit 1
JUPYTER_CONFIG_PATH="../$1"
if [[ ! -f "$JUPYTER_CONFIG_PATH" ]]; then
    echo "Error: Config file '$1' not found."
    exit 1 # Exit the script with a non-zero status to indicate an error
fi

# If a previous run's server is still bound to 8888 (scripts/cleanup.sh
# force-kills whatever's actually listening on the port at the end of a run,
# but a run invoked without --auto_cleanup, or one that crashed before
# cleanup, can still leave one behind), starting a new server here would
# just fail to bind and exit immediately -- silently, since stderr is
# thrown away below -- leaving the stale server as the one Playwright's
# reuseExistingServer then reuses for the whole test, with no error to
# indicate that's what happened. Clearing the port first guarantees this
# run always gets its own fresh server.
if command -v fuser >/dev/null 2>&1; then
    fuser -k 8888/tcp >/dev/null 2>&1
fi

uv run jupyter lab --config "$JUPYTER_CONFIG_PATH" >/dev/null 2>&1 &

# Wait for server to be ready (up to 60s)
echo "Waiting for JupyterLab to start..."
for i in $(seq 1 30); do
    if curl -s "http://localhost:8888/api" >/dev/null 2>&1; then
        echo "JupyterLab ready."
        break
    fi
    sleep 2
done

cd .. || exit 1
