#!/bin/bash

cd ui || exit 1
JUPYTER_CONFIG_PATH="../$1"
if [[ ! -f "$JUPYTER_CONFIG_PATH" ]]; then
    echo "Error: Config file '$1' not found."
    exit 1 # Exit the script with a non-zero status to indicate an error
fi

jupyter lab --config "$JUPYTER_CONFIG_PATH" >/dev/null 2>&1 &

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
