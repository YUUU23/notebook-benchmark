#!/bin/bash
set -euxo pipefail

# pushd benchmarks/py-built-in
for dir in */; do
    if [[ -d "$dir" ]]; then
        echo "Processing directory: $dir"
        cd $dir
        rm -rf ".ipynb_checkpoints"
        cd ..
    fi
done
# popd benchmarks/py-built-in
