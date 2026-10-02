# mc_benchmark
https://github.com/se-sic/icse_model_completion/blob/main/eval_scripts/benchmark.ipynb

## Modifications

### m1 (direct assignment): cell 3
```python
# original
columns = ['dataset', 'same_class', 'same_name', 'same_concept',  'same_association']

# modified
columns = ['dataset', 'same_class', 'same_name', 'same_concept']
```

### m2 (mutation): new cell inserted after cell 3
```python
datasets[0].loc[datasets[0].index[:5], 'same_class'] = False
```
