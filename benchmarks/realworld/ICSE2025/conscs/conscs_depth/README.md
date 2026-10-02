# conscs_depth
https://github.com/jinan789/ConsCS/blob/main/scripts/get_benchmark_results_depth.ipynb

## Modifications

### m1 (direct assignment): cell 5
```python
# original
for cur_max_depth in range(10):

# modified
for cur_max_depth in range(8):
```

### m2 (mutation): new cell inserted after cell 3
```python
all_circuit_stats[list(all_circuit_stats)[0]]["category"] = "large"
```
