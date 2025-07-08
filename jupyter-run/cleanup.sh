#!/bin/bash

jupyter notebook stop 8888
rm -rf test-results
rm -rf reactive-results
rm config/mod_config_file.json
