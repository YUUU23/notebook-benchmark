#!/bin/bash

config="../$1" 
export JUPYTER_CONFIG_PATH="$(pwd)/$(dirname $1)/jupyter_server_test_config.py"
pushd ui
export MOD_PATH=$mod_file
jlpm playwright test --config=$config --headed
popd
