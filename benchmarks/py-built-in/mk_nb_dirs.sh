#!/bin/bash
set -euxo pipefail

# pushd benchmarks/py-built-in
for notebook in *.ipynb; do
    [ -e "$notebook" ] || continue
    notebook_name="${notebook%.*}"
    if [ ! -d "$notebook_name" ]; then 
        mkdir "$notebook_name"
        cp "$notebook" "$notebook_name"
    fi

    mod_nb_name="m_${notebook}"
    if [ ! -e "$mod_nb_name" ]; then
        cp "$notebook" "${notebook_name}/${mod_nb_name}"
    fi
done
# popd benchmarks/py-built-in
    