#!/bin/bash

pushd ui
jlpm playwright test --headed
popd
