#!/bin/bash

pushd ui
echo "=== Executing UI script"
jlpm playwright test --headed
popd
