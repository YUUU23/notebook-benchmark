# ICSE'25 benchmark data setup

Data folders are untracked. Recreate them from the artifact repos:

```sh
git clone https://github.com/xlab-uiuc/cloudtest.git
git clone https://github.com/20001LastOrder/icse2025-type4py type4py
git clone https://github.com/niMgnoeSeeL/ChaoMI
git clone https://github.com/UTD-FAST-Lab/NDSAStudy
git clone https://github.com/enriquebarba97/EnergyDebug
git clone https://github.com/squaresLab/entropy-apr-replication
git clone https://github.com/cmu-soda/FairSense.git
git clone https://github.com/UCLA-SEAL/SynthFuzz.git
git clone https://github.com/jinan789/ConsCS.git
git clone https://github.com/se-sic/icse_model_completion.git
```

Run everything from `benchmarks/realworld/ICSE2025/`. `$CLOUDTEST`, `$TYPE4PY`,
`$CHAOMI`, `$NSDA`, `$ENERGY`, `$ENTROPY`, `$FAIRSENSE`, `$SYNTHFUZZ`,
`$CONSCS`, `$MODELCOMP` point at the clones.

## proj_statistics

```sh
mkdir -p proj_statistics_data
cp "$CLOUDTEST/projects_statistics/discrepantApisEmulator.txt"        proj_statistics_data/
cp "$CLOUDTEST/projects_statistics/discrepant_result_testnames.json"  proj_statistics_data/
cp -R "$CLOUDTEST/projects_statistics/application_sdk_methods"        proj_statistics_data/
```

## cost_savings

```sh
mkdir -p cost_savings_data
cp "$CLOUDTEST/cost_savings/discrepant_apis.txt"    cost_savings_data/
cp -R "$CLOUDTEST/cost_savings/projects_api_calls"  cost_savings_data/
for p in durabletask identityazuretable insights orleans streamstone; do
  cp -R "$CLOUDTEST/cost_savings/$p" cost_savings_data/
done
```

## azure_plot

```sh
mkdir -p azure_plot_data
cp "$CLOUDTEST/miscellaneous/cost_savings/Azure/discrepantApisEmulator.txt" azure_plot_data/
cp -R "$CLOUDTEST/miscellaneous/cost_savings/Azure/application_sdk_methods"  azure_plot_data/
```

## antipatterns

No data folder, run without `-d`.

## type4py_rq1 - type4py_rq4

Shared data folder (~205 MB):

```sh
mkdir -p type4py/type4py_data
cp -R "$TYPE4PY/measurements/results/." type4py/type4py_data/
```

## chaomi_*

All seven share one folder (~2 MB). `HyLeak-data/` is not needed. The local
modules for chaomi_rq4_epassport are committed inside its benchmark folder.
`LocPrivacyProbgen.ipynb` is not a benchmark: its Gowalla input is gitignored.

```sh
mkdir -p chaomi/chaomi_data
cp -R "$CHAOMI/result"          chaomi/chaomi_data/
cp -R "$CHAOMI/data1M"          chaomi/chaomi_data/
cp -R "$CHAOMI/data-LocPrivacy" chaomi/chaomi_data/
cp -R "$CHAOMI/data-epassport"  chaomi/chaomi_data/
```

## nsda_study

```sh
mkdir -p nsda_study_data
cp "$NSDA/code/NDDetector/scripts/notebooks/ICSE2025_AGGREGATE_DATA.csv" nsda_study_data/
```

## energydebug

Only the three workloads the notebook uses (~850 MB). The `tracing/` data is
Zenodo-only; the cells that need it were removed, so skip it.

```sh
mkdir -p energydebug_data
for w in redis-server memcpy-benchmark-cached postgres-server; do
  cp -R "$ENERGY/data/$w" energydebug_data/
done
```

## entropy_apr

```sh
mkdir -p entropy_apr_data/patches
for d in patches_entropy_TBar patches_entropy_shibboleth patches_entropy_panther; do
  cp -R "$ENTROPY/patches/$d" entropy_apr_data/patches/
done
cp "$ENTROPY/patches/time_entropy_testcache.csv" \
   "$ENTROPY/patches/time_tbar_testcache.csv" \
   "$ENTROPY/patches/time_tbar_vanilla.csv" entropy_apr_data/patches/
```

`TBar/` is an empty submodule. The cells that read it are guarded by
`os.path.exists` and no-op without it.

## fairsense

One CSV per regression benchmark, plus shared `mimic_data/` for the two model
benchmarks. The Simulation notebooks are excluded (missing pkl inputs, slow
Monte Carlo); mimic-preprocess needs access-restricted raw MIMIC files.

```sh
mkdir -p fairsense/loan_regression_data fairsense/opioid_regression_data \
         fairsense/police_regression_data fairsense/mimic_data
cp "$FAIRSENSE/SensitivityAnalysis/LoanLending/all_params_w_utility768.csv"       fairsense/loan_regression_data/
cp "$FAIRSENSE/SensitivityAnalysis/OpioidRisk/all_params_168_w_utility.csv"       fairsense/opioid_regression_data/
cp "$FAIRSENSE/SensitivityAnalysis/PredictivePolicing/all_params_w_utility105.csv" fairsense/police_regression_data/
cp "$FAIRSENSE/Simulation/OpioidRisk/mimic_data_after_preprocess/training_set_smote25.csv" \
   "$FAIRSENSE/Simulation/OpioidRisk/mimic_data_after_preprocess/testing_set25.csv" \
   "$FAIRSENSE/Simulation/OpioidRisk/mimic_data_after_preprocess/simulation_set25.csv" fairsense/mimic_data/
```

## synthfuzz_quantifiers

One pickle. The `mlirmut` package is committed in the benchmark folder. The
other four notebooks read docker-volume data that is not in the repo.

```sh
mkdir -p synthfuzz_quantifiers_data
cp "$SYNTHFUZZ/eval/mlir/mlirgen/graph.pkl" synthfuzz_quantifiers_data/
```

Needs `grammarinator==23.7` (newer versions removed the `DefaultTree` API),
`antlr4-python3-runtime`, `dill`, `autopep8`. Do not install mlirmut's own
dependency list, it pins `pandas<3`.

## conscs

Shared data folder (~185 MB). Local modules are committed in the benchmark
folders. `utils.py` needs `z3-solver`. Delete `.DS_Store` files: poly_counts
asserts on duplicate filenames and stray Finder files trip it.

```sh
mkdir -p conscs/conscs_data
cp -R "$CONSCS/logs"       conscs/conscs_data/
cp -R "$CONSCS/benchmarks" conscs/conscs_data/
find conscs/conscs_data -name ".DS_Store" -delete
```

## model_completion

```sh
mkdir -p model_completion/mc_data
cp "$MODELCOMP/datasets_reduced/revision/results/"*.csv model_completion/mc_data/
```

## Notebook modifications

Applied to every benchmark:

- markdown cells removed (the runner indexes cells by position)
- `%flow mode reactive` added as cell 0, kernelspec set to `ipyflow`
- data paths rewritten to `../<benchmark>_data/...`
- trailing empty cells dropped

Benchmark-specific fixes (mostly pandas 3 / environment compat):

- **antipatterns**: `!pip install scikit-posthocs` cell removed, package
  installed in the venv instead
- **type4py_rq1**: `utils.py` patched, `df.append` -> `pd.concat`
- **type4py_rq2/rq3**: final `get_performance` cells dropped (read gitignored
  `../data/eval_real*`)
- **type4py_rq2/rq3/rq4**: `df.fillna(False)` fills only non-string columns
- **type4py_rq2**: plot style changed to `['science','ieee','no-latex']`
- **chaomi (all)**: `os.chdir("../")` and `sys.path.append('../')` removed,
  figures write to cwd
- **chaomi_rq1rq2 / _norm**: `["SE"].values.astype(float)` in `sttest`
  (wilcoxon rejects object arrays)
- **chaomi_rq4_epassport**: `np.random.seed(0)` in the two sampling cells;
  `import chao, estimate, util` added because the runner only uploads modules
  the notebook imports directly
- **nsda_study**: path rewrite only
- **energydebug**: 11 trace-analysis cells dropped (Zenodo-only data)
- **entropy_apr**: `groupby.apply(sort_values)` -> two-key `sort_values`
  (pandas 3 drops group keys in apply); outputs write to cwd
- **fairsense loan_regression**: `lm_stan.predict` -> `lm.predict` (typo in the
  artifact, `lm_stan` is never defined)
- **fairsense police_regression**: dead `ranked_features_2` display cell removed
- **fairsense mimic_xgboost / mimic_mlp**: `random_state=0` on the splits,
  model files write to cwd
- **fairsense mimic_mlp**: grid-search cell dropped (too slow); torch/numpy
  seeds added; unused `import xgboost` removed (its OpenMP clashes with
  torch's and kills the kernel on macOS)
- **synthfuzz_quantifiers**: absolute docker paths rewritten, output pickle
  writes to cwd
- **conscs (all)**: `sys.path.append('../')` removed, paths rewritten,
  transitive-import lines added where needed
- **conscs_contrib**: two prose-in-code cells removed (SyntaxErrors in the
  original artifact too)
- **mc_benchmark / mc_derive**: `os.chdir` removed, reads prefixed with
  `RESULTS_DIR`, outputs write to cwd
- **mc_benchmark**: `binom_test` shimmed with `binomtest(...).pvalue` (removed
  in scipy 1.12)
