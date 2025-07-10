#!/bin/bash

jupyter notebook stop 8888
echo "Removing test-results, reactive-results, and all mod_config_file.json files"
rm -rf test-results/
rm -rf reactive-results/
find config -type f -name "mod_config_file.json" -delete
