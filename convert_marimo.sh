#!/bin/bash

dir=$1

find "$dir" -type f -name "*.ipynb" | while read -r f; do
    marimo convert "$f" -o "$f.marimo.py"
done
