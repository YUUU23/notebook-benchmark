#!/bin/bash

config=.$1
pushd ui
export MOD_PATH=$mod_file
jlpm playwright test --config=$config --headed
popd
