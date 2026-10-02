# mc_derive
https://github.com/se-sic/icse_model_completion/blob/main/eval_scripts/derive_completion_results_for_base_line.ipynb

## Modifications

### m1 (direct assignment): cell 2
```python
# original
OUTPUT_FILE = 'dataset_random_baseline_with_completions.csv'

# modified
OUTPUT_FILE = 'derived_results.csv'
```

### m2 (reassignment): cell 3
```python
# original
completion_generated = dataset[GENERATED_COMPLETION_COLUMN_NAME]

# modified
completion_generated = dataset["completion"]
```
