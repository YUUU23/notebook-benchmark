#!/bin/bash
set -euxo pipefail

# pushd benchmarks/py-built-in
find $1 -type d -name ".ipynb_checkpoints" -print -exec rm -rf {} +
# popd benchmarks/py-built-in
