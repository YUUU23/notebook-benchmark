#!/bin/bash

config="../$1" 
export JUPYTER_CONFIG_PATH="$(pwd)/$(dirname $1)/jupyter_server_test_config.py"
pushd ui
export MOD_PATH=$mod_file
# --headed needs a real X display; on a headless machine (no $DISPLAY) run
# it under a virtual one via xvfb-run instead, so the --headed codepath
# stays exercised without requiring a physical/VNC display on the host.
if [[ -z "$DISPLAY" ]] && command -v xvfb-run >/dev/null 2>&1; then
    xvfb-run -a jlpm playwright test --config=$config --headed
else
    jlpm playwright test --config=$config --headed
fi
popd
