# conscs_ablation
https://github.com/jinan789/ConsCS/blob/main/scripts/get_benchmark_results_ablation.ipynb

## Modifications

### m1 (direct assignment): cell 5
```python
# original
for SIMPLIFICATION_flag in ["1", "0"]:

# modified
for SIMPLIFICATION_flag in ["1"]:
```

### m2 (mutation): new cell inserted after cell 3
```python
all_circuit_stats[list(all_circuit_stats)[0]]["category"] = "large"
```
