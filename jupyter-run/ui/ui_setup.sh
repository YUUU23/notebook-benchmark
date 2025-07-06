#!/bin/bash

pushd ui
echo "=== Executing UI SETUP script"
JUPYTER_CONFIG_PATH="../$1"
if [[ ! -f "$JUPYTER_CONFIG_PATH" ]]; then
    echo "Error: Config file '$1' not found."
    exit 1 # Exit the script with a non-zero status to indicate an error
fi

jupyter lab --config "$JUPYTER_CONFIG_PATH"
popd
