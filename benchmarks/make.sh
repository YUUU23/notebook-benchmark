#!/bin/bash

pushd "$1" || exit 1
for file in *; do
    [ -f "$file" ] || continue
    echo "file: $file"
    DIRNAME="${file%.*}"
    mkdir -p "$DIRNAME"
    mv "$file" "$DIRNAME/$file"

    MODFILENAME="m_$file"
    cp "$DIRNAME/$file" "$DIRNAME/$MODFILENAME"
done
popd
